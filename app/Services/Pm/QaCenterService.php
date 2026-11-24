<?php

namespace App\Services\Pm;

use App\Models\PmBusiness;
use App\Models\PmBusinessProjectLink;
use App\Models\PmCard;
use App\Models\PmQaCheck;
use App\Models\PmSubtask;
use App\Models\PmQaIssue;
use App\Models\PmQaTaskReview;
use App\Models\PmQaWebsite;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * Everything behind the QA Center tab.
 *
 * A QA item is either a finding / site check (pm_qa_issues) or a Taskmandu task review
 * (pm_qa_task_reviews). Both are presented in one shape so the screen treats them the same:
 * a code (RBH-QA3), a pipeline stage, a checklist, screenshots, a failure note and remarks.
 */
class QaCenterService
{
    public const ISSUE = 'issue';
    public const TASK = 'task';
    public const MAX_CHECKS = 40;
    public const DEFAULT_SITE_CHECKS = ['Works on desktop', 'Works on mobile'];

    public function __construct(private QaCodeService $codes) {}

    // ---------------------------------------------------------------- reading

    public function payload(User $user): array
    {
        $websites = $this->websitesFor($user->id);
        $projectBusinesses = $this->projectBusinesses();
        $issues = PmQaIssue::query()->where('created_by', $user->id)->latest()->limit(300)->get();
        $reviews = PmQaTaskReview::query()->orderByDesc('triggered_at')->orderByDesc('id')->limit(500)->get();
        $checks = $this->checksFor($issues->pluck('id'), $reviews->pluck('id'));
        $siteByProject = $websites->filter(fn (PmQaWebsite $w) => filled($w->project_id))->unique('project_id')->keyBy('project_id');

        return [
            'items' => $issues->map(fn (PmQaIssue $i) => $this->presentIssue($i, $checks, $websites, $projectBusinesses))
                ->concat($reviews->map(fn (PmQaTaskReview $r) => $this->presentReview($r, $checks, $siteByProject)))
                ->values(),
            'sites' => $websites->values(),
            'members' => $this->members($issues, $reviews),
            'businesses' => $this->businessNames($websites, $issues, $projectBusinesses),
            'projects' => PmCard::query()->whereNotNull('project_id')->select('project_id', 'project_name')->distinct()
                ->orderBy('project_name')->get()
                ->map(fn ($p) => ['id' => $p->project_id, 'name' => $p->project_name])->values(),
        ];
    }

    // ------------------------------------------------------------ taskmandu imports

    /**
     * Every Taskmandu project becomes a business (project = business). A project already linked to a
     * business is left alone; otherwise it joins the business with the same name, or a new one.
     *
     * @return array{created:int,linked:int,total:int}
     */
    public function importProjects(): array
    {
        $projects = PmCard::query()->whereNotNull('project_id')->whereNotNull('project_name')
            ->select('project_id', 'project_name')->distinct()->get()->unique('project_id');
        $linked = PmBusinessProjectLink::query()->pluck('taskmandu_project_id')->map(fn ($id) => (string) $id)->all();
        $created = 0;
        $links = 0;

        DB::transaction(function () use ($projects, $linked, &$created, &$links) {
            foreach ($projects as $project) {
                if (in_array((string) $project->project_id, $linked, true)) {
                    continue;
                }
                $name = trim((string) $project->project_name);
                $business = PmBusiness::query()->whereRaw('lower(name) = ?', [mb_strtolower($name)])->first();
                if (! $business) {
                    $business = $this->createBusiness($name);
                    $created++;
                }
                PmBusinessProjectLink::create([
                    'business_id' => $business->id,
                    'taskmandu_project_id' => (string) $project->project_id,
                    'taskmandu_project_name' => mb_substr($name, 0, 200),
                    'is_primary' => ! $business->projectLinks()->exists(),
                ]);
                $links++;
            }

            // Reviews that arrived before their project had a business pick it up now.
            $byProject = PmBusinessProjectLink::query()->with('business:id,name')->get()
                ->mapWithKeys(fn ($l) => [(string) $l->taskmandu_project_id => $l->business?->name])->filter();
            foreach ($byProject as $projectId => $businessName) {
                PmQaTaskReview::query()->where('project_id', $projectId)->whereNull('business')->update(['business' => $businessName]);
            }
        });

        return ['created' => $created, 'linked' => $links, 'total' => $projects->count()];
    }

    /** Team member names for the assignee pickers: Taskmandu employees plus anyone already assigned in QA. */
    public function members(Collection $issues, Collection $reviews): array
    {
        $names = collect();
        if (app(\App\Services\Pm\TaskmanduSync::class)->configured()) {
            $staff = Cache::get('pm.employees');
            if ($staff === null) {
                try {
                    $staff = app(\App\Services\Pm\TaskmanduSync::class)->listEmployees();
                    Cache::put('pm.employees', $staff, 600);
                } catch (\Throwable $e) {
                    report($e);
                    $staff = [];
                    Cache::put('pm.employees', $staff, 60);
                }
            }
            $names = $names->concat(collect($staff)->pluck('name'));
        }

        return $names
            ->concat($issues->pluck('assignee'))
            ->concat($reviews->pluck('assignee')->flatMap(fn ($a) => preg_split('/\s*,\s*/', (string) $a)))
            ->map(fn ($n) => trim((string) $n))->filter()
            ->unique(fn ($n) => mb_strtolower($n))->sort(SORT_NATURAL | SORT_FLAG_CASE)->values()->all();
    }

    /** Subtasks of the Taskmandu task become checks (matched by title, so running it again adds nothing twice). */
    public function importSubtasks(Model $review): int
    {
        if (! $review instanceof PmQaTaskReview || blank($review->project_id) || blank($review->task_id)) {
            return 0;
        }
        $titles = PmSubtask::query()->where('project_id', $review->project_id)->where('task_id', $review->task_id)
            ->orderBy('id')->pluck('title')->map(fn ($t) => trim((string) $t))->filter()->all();
        $have = PmQaCheck::query()->where('item_type', self::TASK)->where('item_id', $review->id)->pluck('label')
            ->map(fn ($l) => mb_strtolower(trim($l)))->all();
        $sort = (int) (PmQaCheck::query()->where('item_type', self::TASK)->where('item_id', $review->id)->max('sort') ?? -1);
        $added = 0;
        foreach ($titles as $title) {
            if (in_array(mb_strtolower($title), $have, true) || $sort + 1 >= self::MAX_CHECKS) {
                continue;
            }
            PmQaCheck::create(['item_type' => self::TASK, 'item_id' => $review->id, 'label' => mb_substr($title, 0, 300), 'sort' => ++$sort]);
            $have[] = mb_strtolower($title);
            $added++;
        }

        return $added;
    }

    public function renameCheck(Model $item, PmQaCheck $check, string $label): void
    {
        $this->assertChecklistOpen($item);
        $label = trim($label);
        if ($label === '') {
            throw ValidationException::withMessages(['label' => 'A check needs some text.']);
        }
        $check->update(['label' => mb_substr($label, 0, 300)]);
    }

    // ------------------------------------------------------------ businesses

    public function createBusiness(string $name): PmBusiness
    {
        $name = trim($name);
        if ($this->businessExists($name)) {
            throw ValidationException::withMessages(['name' => 'That business already exists.']);
        }
        $slug = $base = Str::slug($name) ?: 'business';
        for ($n = 2; PmBusiness::query()->where('slug', $slug)->exists(); $n++) {
            $slug = $base.'-'.$n;
        }

        return PmBusiness::create(['name' => $name, 'slug' => $slug, 'status' => 'active']);
    }

    /** Rename everywhere the name is stored. QA codes keep their old prefix: a code never changes. */
    public function renameBusiness(string $from, string $to): void
    {
        $from = trim($from);
        $to = trim($to);
        if ($from === '' || $to === '') {
            throw ValidationException::withMessages(['name' => 'Enter a business name.']);
        }
        if (strcasecmp($from, $to) !== 0 && $this->businessExists($to)) {
            throw ValidationException::withMessages(['name' => 'That business already exists.']);
        }
        DB::transaction(function () use ($from, $to) {
            PmBusiness::query()->where('name', $from)->update(['name' => $to]);
            foreach (['pm_qa_websites', 'pm_qa_issues', 'pm_qa_reports'] as $table) {
                DB::table($table)->where('business', $from)->update(['business' => $to]);
            }
            DB::table('pm_qa_task_reviews')->where('business', $from)->update(['business' => $to]);
            DB::table('pm_qa_task_reviews')->where('qa_business', $from)->update(['qa_business' => $to]);
            DB::table('pm_qa_business_codes')->where('business', $from)->update(['business' => $to]);
        });
    }

    /** Only a business nothing refers to can be deleted. */
    public function deleteBusiness(string $name): void
    {
        $name = trim($name);
        $uses = collect([
            'site' => DB::table('pm_qa_websites')->where('business', $name)->count(),
            'QA item' => DB::table('pm_qa_issues')->where('business', $name)->count()
                + DB::table('pm_qa_task_reviews')->where(fn ($q) => $q->where('business', $name)->orWhere('qa_business', $name))->count(),
            'saved report' => DB::table('pm_qa_reports')->where('business', $name)->count(),
        ])->filter();
        $business = PmBusiness::query()->where('name', $name)->first();
        if ($business && $business->projectLinks()->exists()) {
            $uses->put('Taskmandu project link', $business->projectLinks()->count());
        }
        if ($uses->isNotEmpty()) {
            $what = $uses->map(fn ($n, $k) => $n.' '.$k.($n > 1 ? 's' : ''))->implode(', ');
            throw ValidationException::withMessages(['name' => "{$name} is still used by {$what}. Move or remove those first."]);
        }
        $business?->delete();
    }

    private function businessExists(string $name): bool
    {
        return PmBusiness::query()->whereRaw('lower(name) = ?', [mb_strtolower($name)])->exists()
            || DB::table('pm_qa_websites')->whereRaw('lower(business) = ?', [mb_strtolower($name)])->exists()
            || DB::table('pm_qa_issues')->whereRaw('lower(business) = ?', [mb_strtolower($name)])->exists();
    }

    /** Every business name we know of: the Operations list plus any already used by sites, items or project links. */
    private function businessNames(Collection $websites, Collection $issues, Collection $projectBusinesses): array
    {
        return PmBusiness::query()->pluck('name')
            ->concat($websites->pluck('business'))
            ->concat($issues->pluck('business'))
            ->concat($projectBusinesses->values())
            ->map(fn ($n) => trim((string) $n))
            ->filter()
            ->unique(fn ($n) => mb_strtolower($n))
            ->sort(SORT_NATURAL | SORT_FLAG_CASE)
            ->values()
            ->all();
    }

    /** Report snapshot rows for the given 'issue:ID' / 'task:ID' keys, in the unified item shape. */
    public function snapshot(User $user, array $keys): array
    {
        $wanted = collect($keys)->unique()->values();
        $payload = $this->payload($user);

        return collect($payload['items'])
            ->filter(fn ($i) => $wanted->contains($i['key']))
            ->map(fn ($i) => [
                'key' => $i['key'], 'code' => $i['code'], 'title' => $i['title'], 'stage' => $i['stage'],
                'business' => $i['business'], 'site' => $i['site'], 'source' => $i['source'], 'assignee' => $i['assignee'],
                'url' => $i['url'], 'fail_note' => $i['fail_note'], 'remarks' => $i['remarks'],
                'checks' => collect($i['checks'])->map(fn ($c) => ['label' => $c['label'], 'is_done' => (bool) $c['is_done']])->values()->all(),
                'screenshots' => collect($i['screenshots'])->pluck('url')->values()->all(),
                'updated_at' => $i['updated_at'],
            ])
            ->sortBy('code', SORT_NATURAL)
            ->values()
            ->all();
    }

    /** One item in the same shape as payload()['items']. */
    public function present(Model $item, string $kind, User $user): array
    {
        $checks = $this->checksFor(
            collect($kind === self::ISSUE ? [$item->id] : []),
            collect($kind === self::TASK ? [$item->id] : []),
        );

        if ($kind === self::ISSUE) {
            return $this->presentIssue($item, $checks, $this->websitesFor($user->id), $this->projectBusinesses());
        }

        $siteByProject = $this->websitesFor($user->id)->filter(fn (PmQaWebsite $w) => filled($w->project_id))->unique('project_id')->keyBy('project_id');

        return $this->presentReview($item, $checks, $siteByProject);
    }

    /** Business for a finding that has none set, from its registered site or linked Taskmandu project. */
    public function detectBusinessFor(PmQaIssue $issue): ?string
    {
        $websites = $issue->created_by ? $this->websitesFor((int) $issue->created_by) : collect();

        return $this->detectBusiness($issue, $websites, $this->projectBusinesses());
    }

    // ---------------------------------------------------------------- creating / editing

    /**
     * Create a site check (registered site) or a client report / quick check (free-text site).
     *
     * @param array{title:string,business?:?string,site?:?string,url?:?string,assignee?:?string,checks?:array<int,string>} $data
     */
    public function create(User $user, array $data): PmQaIssue
    {
        $siteName = trim((string) ($data['site'] ?? ''));
        $business = trim((string) ($data['business'] ?? ''));
        $site = $siteName === '' ? null : PmQaWebsite::query()
            ->where('created_by', $user->id)->where('is_active', true)->where('name', $siteName)
            ->when($business !== '', fn ($q) => $q->where('business', $business))
            ->first();

        $url = $this->normalizeUrl($data['url'] ?? null) ?? $site?->url;
        if (! filled($url)) {
            throw ValidationException::withMessages(['url' => 'Enter the page URL so the developer can open it.']);
        }

        $labels = $this->cleanLabels($data['checks'] ?? []) ?: self::DEFAULT_SITE_CHECKS;

        return DB::transaction(function () use ($user, $data, $site, $siteName, $business, $url, $labels) {
            $issue = PmQaIssue::create([
                'created_by' => $user->id,
                'record_type' => $site ? 'Website' : 'Ad-hoc',
                'business' => $site?->business ?? ($business !== '' ? $business : null),
                'site_app' => $site?->name ?? ($siteName !== '' ? $siteName : null),
                'project_id' => $site?->project_id,
                'project_name' => $site?->project_name,
                'page_url' => mb_substr($url, 0, 500),
                'title' => trim($data['title']),
                'severity' => 'Medium',
                'status' => 'Draft',
                'assignee' => filled($data['assignee'] ?? null) ? trim($data['assignee']) : null,
                'qa_stage' => QaStage::QUEUE,
                'qa_history' => [['at' => now()->toIso8601String(), 'message' => 'Added to QA queue', 'by' => $user->name]],
            ]);

            foreach (array_slice($labels, 0, self::MAX_CHECKS) as $i => $label) {
                PmQaCheck::create(['item_type' => self::ISSUE, 'item_id' => $issue->id, 'label' => $label, 'sort' => $i]);
            }

            return $issue;
        });
    }

    /**
     * Change an item. Every item is editable. For Taskmandu tasks the edit is stored beside the synced
     * values (qa_* override columns), so a sync never wipes it and clearing a field restores the Taskmandu value.
     *
     * @param array<string,mixed> $data
     */
    public function update(Model $item, string $kind, array $data, User $user): void
    {
        DB::transaction(function () use ($item, $kind, $data, $user) {
            if ($kind === self::ISSUE) {
                if (array_key_exists('title', $data)) $item->title = trim((string) $data['title']);
                if (array_key_exists('assignee', $data)) $item->assignee = filled($data['assignee']) ? trim($data['assignee']) : null;
                if (array_key_exists('business', $data)) $item->business = filled($data['business']) ? trim($data['business']) : null;
                if (array_key_exists('site', $data)) $item->site_app = filled($data['site']) ? trim($data['site']) : null;
                if (array_key_exists('url', $data)) {
                    $url = $this->normalizeUrl($data['url']);
                    if (! $url) {
                        throw ValidationException::withMessages(['url' => 'Enter the page URL so the developer can open it.']);
                    }
                    $item->page_url = mb_substr($url, 0, 500);
                }
            }
            if ($kind === self::TASK) {
                $clean = fn ($v) => filled($v) ? trim((string) $v) : null;
                if (array_key_exists('title', $data)) $item->qa_title = $clean($data['title']);
                if (array_key_exists('assignee', $data)) $item->qa_assignee = $clean($data['assignee']);
                if (array_key_exists('business', $data)) $item->qa_business = $clean($data['business']);
                if (array_key_exists('site', $data)) $item->qa_site = $clean($data['site']);
                if (array_key_exists('url', $data)) {
                    $item->qa_url = filled($data['url']) ? mb_substr((string) $this->normalizeUrl($data['url']), 0, 1000) : null;
                }
            }
            if (array_key_exists('remarks', $data)) {
                $item->qa_remarks = filled($data['remarks']) ? trim($data['remarks']) : null;
            }

            $stage = $data['stage'] ?? null;
            if ($stage !== null && $stage !== ($item->qa_stage ?: QaStage::QUEUE)) {
                $item->save();
                $this->moveTo($item, $kind, $stage, $data['fail_note'] ?? null, $user);

                return;
            }

            if (array_key_exists('fail_note', $data)) {
                $note = trim((string) $data['fail_note']);
                if ($note === '' && $item->qa_stage === QaStage::FAILED) {
                    throw ValidationException::withMessages(['fail_note' => 'A failed item needs a failure note.']);
                }
                $item->qa_fail_note = $note === '' ? null : $note;
            }
            $item->save();
        });
    }

    /** Move an item through the pipeline, enforcing the QA rules. */
    public function moveTo(Model $item, string $kind, string $stage, ?string $note, User $user): void
    {
        $from = $item->qa_stage ?: QaStage::QUEUE;
        if ($from === $stage) {
            return;
        }
        if (! QaStage::canMove($from, $stage)) {
            throw ValidationException::withMessages(['stage' => "A {$from} item can't move to {$stage}."]);
        }

        $note = trim((string) $note);
        if ($stage === QaStage::PASSED) {
            $checks = $this->checkQuery($item, $kind)->get();
            if ($checks->isEmpty()) {
                throw ValidationException::withMessages(['stage' => 'Add at least one check before passing.']);
            }
            if ($checks->contains(fn (PmQaCheck $c) => ! $c->is_done)) {
                throw ValidationException::withMessages(['stage' => 'Complete every checklist item before passing.']);
            }
        }
        if ($stage === QaStage::FAILED) {
            $note = $note !== '' ? $note : trim((string) $item->qa_fail_note);
            if ($note === '') {
                throw ValidationException::withMessages(['stage' => 'Add a failure note so the developer knows what to fix.']);
            }
        }

        DB::transaction(function () use ($item, $kind, $stage, $from, $note, $user) {
            $item->qa_stage = $stage;
            $item->qa_fail_note = $stage === QaStage::FAILED ? $note : null;

            $restart = $stage === QaStage::QUEUE && in_array($from, [QaStage::FAILED, QaStage::PASSED], true);
            if ($restart) {
                $this->checkQuery($item, $kind)->update(['is_done' => false]);
            }

            if ($kind === self::ISSUE) {
                $item->status = QaStage::toIssueStatus($stage, $item->status);
            } else {
                $this->applyReviewSideEffects($item, $stage, $restart, $note, $user);
            }

            $this->log($item, match (true) {
                $stage === QaStage::TESTING => 'Started testing',
                $stage === QaStage::FAILED => 'Failed and sent back',
                $stage === QaStage::PASSED => 'Passed',
                $from === QaStage::PASSED => 'Reopened for retest',
                $from === QaStage::FAILED => 'Re-queued for retest',
                default => 'Back to queue',
            }, $user);
            $item->save();
        });
    }

    private function applyReviewSideEffects(PmQaTaskReview $review, string $stage, bool $restart, string $note, User $user): void
    {
        $review->qa_status = QaStage::toReviewStatus($stage);

        if (in_array($stage, [QaStage::PASSED, QaStage::FAILED], true)) {
            $passed = $stage === QaStage::PASSED;
            $text = $passed ? 'QA passed in the QA Center.' : $note;
            $review->last_result = $passed ? 'Pass' : 'Fail';
            $review->last_severity = $passed ? null : 'Medium';
            $review->last_notes = $text;
            $review->last_evidence_url = ($review->qa_screenshots[0]['url'] ?? null);
            $review->tested_at = now();
            $review->tested_by = $user->id;
            $review->events()->create([
                'cycle' => $review->cycle, 'result' => $review->last_result, 'severity' => $review->last_severity,
                'notes' => $text, 'evidence_url' => $review->last_evidence_url, 'tested_by' => $user->id,
            ]);
        }

        if ($restart) {
            $review->cycle = (int) $review->cycle + 1;
            $review->triggered_at = now();
            $review->tested_at = null;
            $review->tested_by = null;
            $review->last_result = null;
            $review->last_severity = null;
            $review->last_notes = null;
            $review->last_evidence_url = null;
            $review->events()->create(['cycle' => $review->cycle, 'result' => 'Queued', 'notes' => 'Re-queued for QA from the QA Center.']);
        }
    }

    // ---------------------------------------------------------------- checklist

    /** @param array<int,string> $labels */
    public function addChecks(Model $item, string $kind, array $labels): void
    {
        $this->assertChecklistOpen($item);
        $labels = $this->cleanLabels($labels);
        if ($labels === []) {
            throw ValidationException::withMessages(['label' => 'Type a check first.']);
        }
        $query = $this->checkQuery($item, $kind);
        $existing = (clone $query)->count();
        if ($existing + count($labels) > self::MAX_CHECKS) {
            throw ValidationException::withMessages(['label' => 'An item can have at most '.self::MAX_CHECKS.' checks.']);
        }
        $sort = (int) ((clone $query)->max('sort') ?? -1);
        foreach ($labels as $label) {
            PmQaCheck::create(['item_type' => $kind, 'item_id' => $item->id, 'label' => $label, 'sort' => ++$sort]);
        }
    }

    /** Ticking the first check of a queued item starts testing. */
    public function setCheckDone(Model $item, string $kind, PmQaCheck $check, bool $done, User $user): void
    {
        $this->assertChecklistOpen($item);
        $check->update(['is_done' => $done]);
        if ($done && ($item->qa_stage ?: QaStage::QUEUE) === QaStage::QUEUE) {
            $this->moveTo($item, $kind, QaStage::TESTING, null, $user);
        }
    }

    public function removeCheck(Model $item, PmQaCheck $check): void
    {
        $this->assertChecklistOpen($item);
        $check->delete();
    }

    private function assertChecklistOpen(Model $item): void
    {
        if ($item->qa_stage === QaStage::PASSED) {
            throw ValidationException::withMessages(['stage' => 'Reopen this item before changing its checks.']);
        }
    }

    // ---------------------------------------------------------------- screenshots

    public function addScreenshot(Model $item, UploadedFile $file, User $user): void
    {
        $path = $file->store('qa-center/'.$user->id, 'public');
        $shots = $item->qa_screenshots ?? [];
        $shots[] = [
            'id' => (string) Str::uuid(),
            'name' => $file->getClientOriginalName(),
            'path' => $path,
            'url' => url(Storage::disk('public')->url($path)),
            'created_at' => now()->toIso8601String(),
        ];
        $item->qa_screenshots = $shots;
        $this->log($item, 'Screenshot added', $user);
        $item->save();
    }

    public function removeScreenshot(Model $item, string $screenshotId, User $user): bool
    {
        $shots = $item->qa_screenshots ?? [];
        $target = collect($shots)->firstWhere('id', $screenshotId);
        if (! $target) {
            return false;
        }
        if (! empty($target['path'])) {
            Storage::disk('public')->delete($target['path']);
        }
        $item->qa_screenshots = array_values(array_filter($shots, fn ($s) => ($s['id'] ?? null) !== $screenshotId));
        $this->log($item, 'Screenshot removed', $user);
        $item->save();

        return true;
    }

    /** Only site checks / client reports can be deleted; Taskmandu reviews mirror a real task. */
    public function delete(PmQaIssue $issue): void
    {
        foreach (($issue->qa_screenshots ?? []) as $shot) {
            if (! empty($shot['path'])) {
                Storage::disk('public')->delete($shot['path']);
            }
        }
        DB::transaction(function () use ($issue) {
            PmQaCheck::query()->where('item_type', self::ISSUE)->where('item_id', $issue->id)->delete();
            $issue->delete();
        });
    }

    // ---------------------------------------------------------------- helpers

    private function log(Model $item, string $message, User $user): void
    {
        $history = $item->qa_history ?? [];
        $history[] = ['at' => now()->toIso8601String(), 'message' => $message, 'by' => $user->name];
        $item->qa_history = array_slice($history, -40);
    }

    private function checkQuery(Model $item, string $kind)
    {
        return PmQaCheck::query()->where('item_type', $kind)->where('item_id', $item->id);
    }

    /** @param array<int,mixed> $labels @return array<int,string> */
    private function cleanLabels(array $labels): array
    {
        return array_values(array_filter(array_map(
            fn ($l) => mb_substr(trim((string) $l), 0, 300),
            $labels,
        ), fn ($l) => $l !== ''));
    }

    /** Add https:// when missing. Returns null for blank input and rejects things that aren't web addresses. */
    private function normalizeUrl(?string $url): ?string
    {
        $url = trim((string) $url);
        if ($url === '') {
            return null;
        }
        if (! preg_match('#^https?://#i', $url)) {
            $url = 'https://'.$url;
        }
        if (! filter_var($url, FILTER_VALIDATE_URL)) {
            throw ValidationException::withMessages(['url' => 'That page URL doesn\'t look right.']);
        }

        return $url;
    }

    private function websitesFor(int $userId): Collection
    {
        return PmQaWebsite::query()->where('created_by', $userId)->where('is_active', true)->orderBy('business')->orderBy('name')->get();
    }

    private function projectBusinesses(): Collection
    {
        return PmBusinessProjectLink::query()->with('business:id,name')->get()
            ->filter(fn ($link) => filled($link->taskmandu_project_id) && filled($link->business?->name))
            ->mapWithKeys(fn ($link) => [(string) $link->taskmandu_project_id => $link->business->name]);
    }

    private function detectBusiness(PmQaIssue $issue, Collection $websites, Collection $projectBusinesses): ?string
    {
        if (filled($issue->business)) {
            return $issue->business;
        }

        $site = $websites->first(fn (PmQaWebsite $w) =>
            ($issue->project_id && $w->project_id === $issue->project_id)
            || ($issue->site_app && strcasecmp($w->name, $issue->site_app) === 0)
            || ($issue->page_url && rtrim($w->url, '/') === rtrim($issue->page_url, '/'))
        );

        return $site?->business ?: ($issue->project_id ? ($projectBusinesses[(string) $issue->project_id] ?? null) : null);
    }

    private function checksFor(Collection $issueIds, Collection $reviewIds): Collection
    {
        $rows = collect();
        foreach ([self::ISSUE => $issueIds, self::TASK => $reviewIds] as $type => $ids) {
            if ($ids->isNotEmpty()) {
                $rows = $rows->concat(PmQaCheck::query()->where('item_type', $type)->whereIn('item_id', $ids)->orderBy('sort')->orderBy('id')->get());
            }
        }

        return $rows->groupBy(fn (PmQaCheck $c) => $c->item_type.':'.$c->item_id);
    }

    private function shape(Model $item, string $kind, Collection $checks, array $own): array
    {
        $key = $kind.':'.$item->id;

        return [
            'key' => $key,
            'kind' => $kind,
            'id' => $item->id,
            'code' => $item->qa_code,
            'stage' => $item->qa_stage ?: QaStage::QUEUE,
            'checks' => ($checks->get($key) ?? collect())
                ->map(fn (PmQaCheck $c) => ['id' => $c->id, 'label' => $c->label, 'is_done' => (bool) $c->is_done])->values(),
            'screenshots' => array_values($item->qa_screenshots ?? []),
            'fail_note' => $item->qa_fail_note,
            'remarks' => $item->qa_remarks,
            'history' => array_values($item->qa_history ?? []),
            'created_at' => $item->created_at?->toIso8601String(),
            'updated_at' => $item->updated_at?->toIso8601String(),
        ] + $own;
    }

    private function presentIssue(PmQaIssue $issue, Collection $checks, Collection $websites, Collection $projectBusinesses): array
    {
        return $this->shape($issue, self::ISSUE, $checks, [
            'title' => $issue->title,
            'business' => $this->detectBusiness($issue, $websites, $projectBusinesses),
            'site' => $issue->site_app ?: $issue->project_name,
            'url' => $issue->page_url,
            'source' => $issue->record_type === 'Ad-hoc' ? 'Client report' : 'Site check',
            'assignee' => $issue->assignee,
            'editable' => true,
            'details' => $this->details([
                ['What happened', $issue->description],
                ['Expected', $issue->expected_behaviour],
                ['Developer notes', $issue->developer_notes],
                ['Severity', $issue->severity],
                ['Evidence link', $issue->evidence_url],
                ['Taskmandu task', $issue->pm_task_url],
            ]),
        ]);
    }

    private function presentReview(PmQaTaskReview $review, Collection $checks, Collection $siteByProject): array
    {
        return $this->shape($review, self::TASK, $checks, [
            'title' => $review->qa_title ?: $review->task_title,
            'business' => $review->qa_business ?: $review->business,
            'site' => $review->qa_site ?: (($review->project_id ? $siteByProject->get($review->project_id)?->name : null) ?: $review->project_name),
            'url' => $review->qa_url ?: $review->taskmandu_url,
            'source' => 'Taskmandu',
            'assignee' => $review->qa_assignee ?: $review->assignee,
            'editable' => true,
            'details' => $this->details([
                ['Taskmandu status', $review->task_status],
                ['Taskmandu project', $review->project_name],
                ['QA round', 'Round '.(int) $review->cycle],
                ['Task description', $review->task_description],
            ]),
        ]);
    }

    /** @param array<int,array{0:string,1:mixed}> $rows */
    private function details(array $rows): array
    {
        return collect($rows)->filter(fn ($r) => filled($r[1]))
            ->map(fn ($r) => ['label' => $r[0], 'value' => (string) $r[1]])->values()->all();
    }
}
