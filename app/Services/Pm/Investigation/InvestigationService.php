<?php

namespace App\Services\Pm\Investigation;

use App\Models\PmCard;
use App\Models\PmInvestigation;
use App\Models\PmInvestigationEvent;
// dates helper lives alongside this service
use App\Services\Pm\QaCenterService;
use App\Services\Pm\TaskmanduSync;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * Project investigations: assignments, lifecycle, findings and coverage.
 *
 * Lifecycle (one place, enforced here):
 *   not_started ──start──▶ in_progress ──submit──▶ awaiting_review ──review──▶ reviewed ──close──▶ completed
 *        ▲                      ▲                        │  └─────────close────────────────▶ completed
 *        └──────────────────────┴──── returned ◀──return┘ (also from reviewed)      completed ──reopen──▶ returned
 * Submitting findings never completes an assignment; only an explicit close does.
 */
class InvestigationService
{
    public const LABELS = [
        'not_started' => 'Not started', 'in_progress' => 'In progress', 'awaiting_review' => 'Awaiting review',
        'reviewed' => 'Reviewed', 'completed' => 'Completed', 'returned' => 'Returned for further investigation',
    ];

    public const TRANSITIONS = [
        'not_started' => ['start' => 'in_progress'],
        'returned' => ['start' => 'in_progress'],
        'in_progress' => ['submit' => 'awaiting_review'],
        'awaiting_review' => ['review' => 'reviewed', 'return' => 'returned', 'close' => 'completed'],
        'reviewed' => ['return' => 'returned', 'close' => 'completed'],
        'completed' => ['reopen' => 'returned'],
    ];

    public const DEFAULT_CHECKLIST = [
        'Review important website/app pages',
        'Check navigation and user journeys',
        'Test important functionality',
        'Test forms and customer flows',
        'Review mobile responsiveness',
        'Identify broken features and bugs',
        'Identify usability problems',
        'Review performance or technical issues where relevant',
        'Identify improvement opportunities',
        'Review competitors or industry features where appropriate',
        'Record evidence, findings and recommendations',
    ];

    public function __construct(private InvestigationDates $dates, private QaCenterService $qa) {}

    // ------------------------------------------------------------ sources

    /** Developers: everyone in Taskmandu (cached, same list the workload uses) plus anyone who has tasks. */
    public function developers(array &$warnings = []): array
    {
        $staff = [];
        $sync = app(TaskmanduSync::class);
        if ($sync->configured()) {
            $staff = Cache::get('pm.employees');
            if ($staff === null) {
                try {
                    $staff = $sync->listEmployees();
                    Cache::put('pm.employees', $staff, 600);
                } catch (\Throwable $e) {
                    report($e);
                    $staff = [];
                    Cache::put('pm.employees', $staff, 60);
                }
            }
        }
        $byName = collect($staff)->filter(fn ($e) => filled(trim((string) ($e['name'] ?? ''))))
            ->mapWithKeys(fn ($e) => [mb_strtolower(trim($e['name'])) => ['name' => trim($e['name']), 'employee_id' => $e['employeeId'] ?? null, 'designation' => $e['designation'] ?? null]]);

        PmCard::query()->whereNotNull('assignee')->distinct()->pluck('assignee')->each(function ($n) use ($byName) {
            $n = trim((string) $n);
            if ($n !== '' && ! $byName->has(mb_strtolower($n))) {
                $byName->put(mb_strtolower($n), ['name' => $n, 'employee_id' => null, 'designation' => null]);
            }
        });
        if ($byName->isEmpty()) {
            $warnings[] = "Taskmandu staff couldn't be loaded, so no developers are listed.";
        }

        return $byName->sortBy('name', SORT_NATURAL | SORT_FLAG_CASE)->values()->all();
    }

    /** @return Collection<int, array{id:string,name:string,business:?string}> */
    public function projects(array &$warnings = []): Collection
    {
        return $this->qa->projectList($warnings);
    }

    // ------------------------------------------------------------ presenting

    public function present(PmInvestigation $i, bool $full = false): array
    {
        $today = $this->dates->today();
        $open = $i->status !== 'completed';
        $days = $i->due_date ? $this->dates->daysLeft($i->due_date->format('Y-m-d'), $today) : null;

        $row = [
            'id' => $i->id,
            'project_id' => $i->project_id,
            'project_name' => $i->project_name,
            'developer_name' => $i->developer_name,
            'developer_employee_id' => $i->developer_employee_id,
            'assigned_on' => $i->assigned_on?->format('Y-m-d'),
            'due_date' => $i->due_date?->format('Y-m-d'),
            'overdue' => $open && $days !== null && $days < 0 && $i->status !== 'awaiting_review' && $i->status !== 'reviewed',
            'days_left' => $open ? $days : null,
            'priority' => $i->priority,
            'status' => $i->status,
            'status_label' => self::LABELS[$i->status] ?? $i->status,
            'last_investigated_on' => $i->last_investigated_on?->format('Y-m-d'),
            'submitted_at' => $i->submitted_at?->toIso8601String(),
            'reviewed_at' => $i->reviewed_at?->toIso8601String(),
            'completed_at' => $i->completed_at?->toIso8601String(),
            'actions' => array_keys(self::TRANSITIONS[$i->status] ?? []),
            'findings_editable' => $i->findingsEditable(),
            'created_at' => $i->created_at?->toIso8601String(),
        ];
        if (! $full) {
            return $row;
        }

        return $row + [
            'scope' => $i->scope, 'instructions' => $i->instructions, 'deliverables' => $i->deliverables,
            'checklist' => $i->checklist ?? [], 'areas_reviewed' => $i->areas_reviewed, 'findings' => $i->findings,
            'issues' => $i->issues, 'recommendations' => $i->recommendations, 'evidence' => $i->evidence ?? [],
            'notes' => $i->notes, 'followups' => $i->followups ?? [], 'effort_estimate' => $i->effort_estimate,
            'review_comments' => $i->review_comments, 'reviewer_name' => $i->reviewer_name,
            'events' => $i->events->map(fn ($e) => [
                'id' => $e->id, 'event' => $e->event, 'from' => $e->from_status, 'to' => $e->to_status,
                'actor' => $e->actor_name, 'detail' => $e->detail, 'at' => $e->created_at?->toIso8601String(),
            ])->reverse()->values()->all(),
        ];
    }

    // ------------------------------------------------------------ listing

    /** @param array<string,mixed> $f developer, project_id, status, priority, date_from, date_to, search, page, per_page */
    public function list(array $f): array
    {
        $q = PmInvestigation::query();
        if (! empty($f['developer'])) {
            $q->where('developer_name', $f['developer']);
        }
        if (! empty($f['project_id'])) {
            $q->where('project_id', $f['project_id']);
        }
        if (! empty($f['status'])) {
            $q->whereIn('status', array_filter(explode(',', $f['status'])));
        }
        if (! empty($f['priority'])) {
            $q->where('priority', $f['priority']);
        }
        if (! empty($f['date_from'])) {
            $q->where('assigned_on', '>=', $f['date_from']);
        }
        if (! empty($f['date_to'])) {
            $q->where('assigned_on', '<=', $f['date_to']);
        }
        if ($s = trim((string) ($f['search'] ?? ''))) {
            $like = '%'.str_replace(['%', '_'], ['\%', '\_'], $s).'%';
            $q->where(fn ($w) => $w->where('project_name', 'like', $like)->orWhere('developer_name', 'like', $like)
                ->orWhere('scope', 'like', $like)->orWhere('findings', 'like', $like)->orWhere('issues', 'like', $like));
        }

        $per = max(5, min(100, (int) ($f['per_page'] ?? 20)));
        $page = $q->orderByRaw("case status when 'awaiting_review' then 0 when 'in_progress' then 1 when 'returned' then 2 when 'not_started' then 3 when 'reviewed' then 4 else 5 end")
            ->orderByRaw('due_date is null')->orderBy('due_date')->orderByDesc('id')
            ->paginate($per, ['*'], 'page', max(1, (int) ($f['page'] ?? 1)));

        return [
            'investigations' => collect($page->items())->map(fn ($i) => $this->present($i))->all(),
            'meta' => ['page' => $page->currentPage(), 'last_page' => $page->lastPage(), 'total' => $page->total(), 'per_page' => $per],
        ];
    }

    /** All figures come straight from the stored records. */
    public function summary(?int $projectsNeeding): array
    {
        $by = PmInvestigation::query()->select('status', DB::raw('count(*) as n'))->groupBy('status')->pluck('n', 'status');
        $weekStart = \Carbon\Carbon::now($this->dates->timezone())->startOfWeek()->utc();

        return [
            'active' => (int) $by->except('completed')->sum(),
            'not_started' => (int) ($by['not_started'] ?? 0),
            'in_progress' => (int) ($by['in_progress'] ?? 0),
            'awaiting_review' => (int) ($by['awaiting_review'] ?? 0),
            'completed_this_week' => PmInvestigation::where('status', 'completed')->where('completed_at', '>=', $weekStart)->count(),
            'projects_needing' => $projectsNeeding,
        ];
    }

    /** Per developer: active investigations, so the Workload view can show them without counting them as task hours. */
    public function byDeveloper(): array
    {
        return PmInvestigation::query()->where('status', '!=', 'completed')->get()
            ->groupBy('developer_name')
            ->map(fn ($rows, $name) => [
                'name' => $name,
                'active' => $rows->count(),
                'awaiting_review' => $rows->where('status', 'awaiting_review')->count(),
                'projects' => $rows->pluck('project_name')->unique()->values()->all(),
            ])->values()->all();
    }

    // ------------------------------------------------------------ coverage

    /**
     * One row per project: when it was last investigated, by whom, what is active now and whether it is due.
     * `projects_known` is false when no project list could be built; "needing investigation" is then unknown (null).
     *
     * @return array{rows: array<int,array<string,mixed>>, needing: ?int, interval_days:int}
     */
    public function coverage(array &$warnings = []): array
    {
        $interval = (int) config('pm.investigation.review_every_days', 90);
        $today = $this->dates->today();
        $projects = $this->projects($warnings);
        $all = PmInvestigation::query()->orderBy('id')->get()->groupBy('project_id');

        $known = $projects->pluck('id')->all();
        // Projects with history that Taskmandu no longer lists stay visible (history is never erased).
        $extra = $all->keys()->diff($known)->map(fn ($id) => ['id' => (string) $id, 'name' => $all[$id]->last()->project_name, 'business' => null, 'missing' => true]);
        $projects = $projects->map(fn ($p) => $p + ['missing' => false])->concat($extra);

        $rows = $projects->map(function ($p) use ($all, $interval, $today) {
            $hist = $all->get($p['id'], collect());
            $done = $hist->filter(fn ($i) => $i->last_investigated_on !== null)->sortByDesc(fn ($i) => $i->last_investigated_on->format('Y-m-d').str_pad((string) $i->id, 9, '0', STR_PAD_LEFT))->first();
            $active = $hist->where('status', '!=', 'completed');
            $last = $done?->last_investigated_on?->format('Y-m-d');
            $age = $last ? -$this->dates->daysLeft($last, $today) : null;

            return [
                'project_id' => $p['id'], 'project_name' => $p['name'], 'business' => $p['business'] ?? null, 'unavailable' => $p['missing'],
                'last_investigated_on' => $last, 'last_investigator' => $done?->developer_name, 'days_since' => $age,
                'investigated_count' => $hist->filter(fn ($i) => $i->last_investigated_on !== null)->count(),
                'active' => $active->map(fn ($i) => ['id' => $i->id, 'developer_name' => $i->developer_name, 'status' => $i->status, 'status_label' => self::LABELS[$i->status]])->values()->all(),
                'due_for_review' => ! $p['missing'] && $active->isEmpty() && ($last === null || $age >= $interval),
                'history' => $hist->filter(fn ($i) => $i->last_investigated_on !== null)->sortByDesc('id')->take(5)
                    ->map(fn ($i) => ['id' => $i->id, 'developer_name' => $i->developer_name, 'date' => $i->last_investigated_on->format('Y-m-d'), 'status' => $i->status])->values()->all(),
            ];
        })->sortBy(fn ($r) => [$r['due_for_review'] ? 0 : 1, $r['last_investigated_on'] ?? '0000', $r['project_name']])->values();

        $listKnown = $projects->contains(fn ($p) => ! $p['missing']);

        return ['rows' => $rows->all(), 'needing' => $listKnown ? $rows->where('due_for_review', true)->count() : null, 'interval_days' => $interval];
    }

    // ------------------------------------------------------------ writing

    /** @param array<string,mixed> $d */
    public function assign(array $d, ?int $userId, ?string $actor): PmInvestigation
    {
        $this->assertProject($d['project_id'], $d['project_name'] ?? null);
        $this->assertDeveloper($d['developer_name']);

        $checklist = $this->cleanChecklist($d['checklist'] ?? null) ?? $this->cleanChecklist(self::DEFAULT_CHECKLIST);

        return DB::transaction(function () use ($d, $userId, $actor, $checklist) {
            $i = PmInvestigation::create([
                'project_id' => $d['project_id'],
                'project_name' => $this->projectName($d['project_id']) ?? $d['project_name'],
                'developer_name' => trim($d['developer_name']),
                'developer_employee_id' => $d['developer_employee_id'] ?? null,
                'assigned_on' => $d['assigned_on'] ?? $this->dates->today(),
                'due_date' => $d['due_date'] ?? null,
                'priority' => $d['priority'] ?? 'medium',
                'status' => 'not_started',
                'scope' => $d['scope'] ?? null, 'instructions' => $d['instructions'] ?? null, 'deliverables' => $d['deliverables'] ?? null,
                'checklist' => $checklist,
                'created_by' => $userId,
            ]);
            $this->log($i, 'assigned', $actor, "Assigned to {$i->developer_name}", null, 'not_started');

            return $i;
        });
    }

    /** Edit the assignment itself (not the findings). */
    public function updateAssignment(PmInvestigation $i, array $d, ?string $actor): PmInvestigation
    {
        if ($i->status === 'completed') {
            throw ValidationException::withMessages(['status' => 'This investigation is closed. Reopen it to change it.']);
        }
        if (array_key_exists('developer_name', $d) && trim($d['developer_name']) !== $i->developer_name) {
            throw ValidationException::withMessages(['developer_name' => 'Use Reassign to change the developer, so it is recorded in the history.']);
        }
        unset($d['developer_name'], $d['developer_employee_id'], $d['project_id'], $d['project_name']);
        $i->fill($d);
        if (isset($d['checklist'])) {
            $i->checklist = $this->cleanChecklist($d['checklist'], $i->checklist ?? []);
        }
        $this->assertDates($i);
        if ($i->isDirty()) {
            $i->save();
            $this->log($i, 'edited', $actor, 'Assignment details edited');
        }

        return $i;
    }

    public function reassign(PmInvestigation $i, string $name, ?string $employeeId, ?string $note, ?string $actor): PmInvestigation
    {
        if ($i->status === 'completed') {
            throw ValidationException::withMessages(['status' => 'This investigation is closed. Reopen it first.']);
        }
        $name = trim($name);
        if ($name === $i->developer_name) {
            throw ValidationException::withMessages(['developer_name' => 'It is already assigned to '.$name.'.']);
        }
        $this->assertDeveloper($name);
        $from = $i->developer_name;
        $i->update(['developer_name' => $name, 'developer_employee_id' => $employeeId]);
        $this->log($i, 'reassigned', $actor, "Reassigned from {$from} to {$name}".($note ? ": {$note}" : ''));

        return $i;
    }

    /** Save (or update) the findings. Allowed only while the work is with the developer. */
    public function saveFindings(PmInvestigation $i, array $d, ?string $actor): PmInvestigation
    {
        if (! $i->findingsEditable()) {
            throw ValidationException::withMessages(['status' => 'These findings are '.strtolower(self::LABELS[$i->status]).' and can no longer be edited. Return it for further investigation to change them.']);
        }
        $i->fill(array_intersect_key($d, array_flip(['areas_reviewed', 'findings', 'issues', 'recommendations', 'notes', 'effort_estimate'])));
        if (array_key_exists('checklist', $d)) {
            $i->checklist = $this->cleanChecklist($d['checklist'], $i->checklist ?? []);
        }
        if (array_key_exists('evidence', $d)) {
            $i->evidence = collect($d['evidence'] ?? [])->map(fn ($e) => array_filter(['label' => trim((string) ($e['label'] ?? '')), 'url' => trim((string) ($e['url'] ?? ''))], fn ($v) => $v !== ''))->filter(fn ($e) => ! empty($e['url']) || ! empty($e['label']))->values()->all();
        }
        if (array_key_exists('followups', $d)) {
            $i->followups = $this->cleanFollowups($d['followups'] ?? [], $i->followups ?? []);
        }
        if ($i->isDirty()) {
            $i->save();
            $this->log($i, 'draft_saved', $actor, 'Findings saved');
        }

        return $i;
    }

    /** Reviewer's notes and which recommendations should become tasks. Allowed while awaiting review or reviewed. */
    public function saveReview(PmInvestigation $i, array $d, ?string $actor): PmInvestigation
    {
        if (! in_array($i->status, ['awaiting_review', 'reviewed'], true)) {
            throw ValidationException::withMessages(['status' => 'Review notes can be added once findings are submitted.']);
        }
        if (array_key_exists('review_comments', $d)) {
            $i->review_comments = $d['review_comments'];
        }
        if (array_key_exists('followups', $d)) {
            // Reviewer can only flag/annotate; the developer's follow-up text is preserved.
            $mark = collect($d['followups'])->keyBy('uid');
            $i->followups = collect($i->followups ?? [])->map(function ($f) use ($mark) {
                $m = $mark->get($f['uid'] ?? null);
                if ($m) {
                    $f['convert'] = (bool) ($m['convert'] ?? false);
                    $f['reference'] = trim((string) ($m['reference'] ?? '')) ?: null;
                    $f = array_filter($f, fn ($v) => $v !== null && $v !== '');
                }

                return $f;
            })->all();
        }
        $i->reviewer_name = $actor;
        if ($i->isDirty()) {
            $i->save();
            $this->log($i, 'review_notes', $actor, 'Review notes saved');
        }

        return $i;
    }

    public function transition(PmInvestigation $i, string $action, ?string $actor, ?string $comments = null): PmInvestigation
    {
        $to = self::TRANSITIONS[$i->status][$action] ?? null;
        if (! $to) {
            throw ValidationException::withMessages(['action' => "You can't {$action} an investigation that is ".strtolower(self::LABELS[$i->status]).'.']);
        }
        if ($action === 'submit') {
            $this->assertReadyToSubmit($i);
        }
        if ($action === 'return' && ! trim((string) ($comments ?? $i->review_comments))) {
            throw ValidationException::withMessages(['comments' => 'Say what needs more investigation, so the developer knows what to do.']);
        }

        return DB::transaction(function () use ($i, $action, $to, $actor, $comments) {
            $from = $i->status;
            $now = now();
            $i->status = $to;
            if ($comments !== null && trim($comments) !== '') {
                $i->review_comments = $comments;
            }
            match ($action) {
                'submit' => [$i->submitted_at = $now, $i->last_investigated_on = $this->dates->today()],
                'review' => [$i->reviewed_at = $now, $i->reviewer_name = $actor],
                'return' => [$i->reviewed_at = $now, $i->reviewer_name = $actor],
                'close' => [$i->completed_at = $now, $i->reviewer_name = $i->reviewer_name ?: $actor, $i->reviewed_at ??= $now],
                'reopen' => $i->completed_at = null,
                default => null,
            };
            $i->save();
            $this->log($i, $action, $actor, $comments, $from, $to);

            return $i;
        });
    }

    // ------------------------------------------------------------ helpers

    private function assertReadyToSubmit(PmInvestigation $i): void
    {
        if (! trim((string) $i->findings) && ! trim((string) $i->issues) && ! trim((string) $i->recommendations)) {
            throw ValidationException::withMessages(['findings' => 'Record your findings, issues or recommendations before submitting.']);
        }
    }

    private function assertDates(PmInvestigation $i): void
    {
        if ($i->due_date && $i->assigned_on && $i->due_date->lt($i->assigned_on)) {
            throw ValidationException::withMessages(['due_date' => 'The due date can\'t be before the assignment date.']);
        }
    }

    /** The project must be one the dashboard knows (live Taskmandu list, or already synced from it). */
    private function assertProject(string $id, ?string $name): void
    {
        if ($this->projectName($id) === null) {
            throw ValidationException::withMessages(['project_id' => 'Choose an existing Taskmandu project from the list.']);
        }
    }

    private function projectName(string $id): ?string
    {
        $w = [];

        return $this->projects($w)->firstWhere('id', $id)['name'] ?? null;
    }

    /** Names must come from Taskmandu staff or task assignees. If neither could be loaded a typed name is accepted. */
    private function assertDeveloper(string $name): void
    {
        $w = [];
        $known = collect($this->developers($w))->pluck('name')->map(fn ($n) => mb_strtolower($n));
        if ($known->isNotEmpty() && ! $known->contains(mb_strtolower(trim($name)))) {
            throw ValidationException::withMessages(['developer_name' => 'Choose a developer from the list.']);
        }
    }

    /** @param array<int,mixed>|null $in */
    private function cleanChecklist(?array $in, array $existing = []): ?array
    {
        if ($in === null) {
            return null;
        }
        return collect($in)->map(function ($c) {
            $label = trim(is_array($c) ? (string) ($c['label'] ?? '') : (string) $c);
            $id = is_array($c) ? ($c['id'] ?? null) : null;

            return $label === '' ? null : ['id' => $id ?: (string) Str::uuid(), 'label' => Str::limit($label, 200, ''), 'done' => is_array($c) && ! empty($c['done'])];
        })->filter()->values()->all();
    }

    private function cleanFollowups(array $in, array $existing): array
    {
        $keep = collect($existing)->keyBy('uid');

        return collect($in)->map(function ($f) use ($keep) {
            $title = trim((string) ($f['title'] ?? ''));
            if ($title === '') {
                return null;
            }
            $old = $keep->get($f['uid'] ?? null, []);

            return array_filter([
                'uid' => $old['uid'] ?? (string) Str::uuid(),
                'title' => Str::limit($title, 200, ''),
                'description' => $f['description'] ?? null,
                'effort' => $f['effort'] ?? null,
                'priority' => $f['priority'] ?? 'medium',
                // Reviewer decisions survive a developer edit of the same follow-up.
                'convert' => $old['convert'] ?? null,
                'reference' => $old['reference'] ?? null,
            ], fn ($v) => $v !== null && $v !== '');
        })->filter()->values()->all();
    }

    private function log(PmInvestigation $i, string $event, ?string $actor, ?string $detail = null, ?string $from = null, ?string $to = null): void
    {
        PmInvestigationEvent::create(['investigation_id' => $i->id, 'event' => $event, 'from_status' => $from, 'to_status' => $to, 'actor_name' => $actor, 'detail' => $detail]);
    }
}
