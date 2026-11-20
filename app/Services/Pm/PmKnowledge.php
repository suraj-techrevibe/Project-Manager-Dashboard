<?php

namespace App\Services\Pm;

use App\Models\MeetingMinutes;
use App\Models\PmBusiness;
use App\Models\PmContact;
use App\Models\PmDraft;
use App\Models\PmIntake;
use App\Models\PmMeetingTemplate;
use App\Models\PmProjectHealth;
use App\Models\PmQaIssue;
use App\Models\PmReport;
use App\Models\PmSubtask;
use App\Models\PmTaskmanduEvent;
use App\Models\PmTicketPack;
use App\Models\PmWaitingClient;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Str;

/**
 * One read-only data layer over everything in the PM that is not a Taskmandu task:
 * meeting templates, ticket packs, minutes, drafts, reports, QA issues, businesses, waiting-on-client,
 * project health, contacts, sub-tasks, Taskmandu activity and Git.
 *
 * Both the built-in bot (RuleBot) and the AI tool (`lookup_pm_data`) read through this class,
 * so they always agree. Every method returns plain arrays: ['total' => int, 'rows' => array].
 */
class PmKnowledge
{
    public const KINDS = [
        'meeting_templates', 'ticket_packs', 'minutes', 'drafts', 'reports', 'qa_issues', 'businesses',
        'waiting_client', 'project_health', 'contacts', 'subtasks', 'activity_feed', 'git',
    ];

    /**
     * @param  array{term?: string, status?: string, severity?: string, person?: string, project?: string, kind?: string, date?: string, open?: bool, unassigned?: bool, limit?: int}  $o
     * @return array{total: int, rows: array<int, array<string, mixed>>}
     */
    public function fetch(string $kind, array $o = []): array
    {
        $limit = max(1, min((int) ($o['limit'] ?? 15), 50));
        $term = trim((string) ($o['term'] ?? ''));

        return match ($kind) {
            'meeting_templates' => $this->templates($term, $limit),
            'ticket_packs' => $this->packs($term, $limit),
            'minutes' => $this->minutes($term, $o, $limit),
            'drafts' => $this->drafts($term, $o, $limit),
            'reports' => $this->reports($o, $limit),
            'qa_issues' => $this->qa($term, $o, $limit),
            'businesses' => $this->businesses($term, $limit),
            'waiting_client' => $this->waiting($term, $limit),
            'project_health' => $this->health($term, $limit),
            'contacts' => $this->contacts($term, $limit),
            'subtasks' => $this->subtasks($term, $o, $limit),
            'activity_feed' => $this->feed($term, $o, $limit),
            'git' => $this->git(),
            default => throw new \InvalidArgumentException("Unknown kind {$kind}"),
        };
    }

    /** @return array<string, int|string|null> a one-line count per area, for "what do you know?" */
    public function inventory(): array
    {
        $latestMinute = MeetingMinutes::query()->latest('meeting_date')->first();
        $latestReport = PmReport::query()->latest('report_date')->first();

        return [
            'meeting_minutes' => MeetingMinutes::count(),
            'latest_minutes' => $latestMinute ? $latestMinute->title.' ('.$latestMinute->meeting_date?->format('j M Y').')' : null,
            'meeting_templates' => PmMeetingTemplate::count(),
            'ticket_packs' => PmTicketPack::count(),
            'drafts' => PmDraft::count(),
            'reports' => PmReport::count(),
            'latest_report' => $latestReport ? "{$latestReport->kind} {$latestReport->report_date}" : null,
            'qa_open' => PmQaIssue::query()->where('status', '!=', 'Passed')->count(),
            'qa_total' => PmQaIssue::count(),
            'businesses' => PmBusiness::count(),
            'open_intakes' => PmIntake::query()->whereNotIn('status', ['rejected', 'deferred', 'planned'])->count(),
            'waiting_on_client' => PmWaitingClient::query()->where('status', 'waiting')->count(),
            'contacts' => PmContact::count(),
            'subtasks_open' => PmSubtask::query()->whereNotIn('status', ['Completed', 'Cancelled'])->count(),
            'subtasks_total' => PmSubtask::count(),
            'taskmandu_events' => PmTaskmanduEvent::count(),
        ];
    }

    /* ------------------------------------------------------------------ */

    /** Every word of $term must appear in at least one of the (text-castable) columns. */
    private function search(Builder $q, array $cols, string $term): Builder
    {
        foreach (array_filter(preg_split('/\s+/', Str::lower($term))) as $word) {
            $q->where(function ($w) use ($cols, $word) {
                foreach ($cols as $c) {
                    $w->orWhereRaw("LOWER(CAST({$c} AS TEXT)) LIKE ?", ['%'.str_replace(['%', '_'], ['\%', '\_'], $word).'%']);
                }
            });
        }

        return $q;
    }

    private function titles(mixed $items): array
    {
        return collect((array) $items)
            ->map(fn ($x) => is_array($x) ? trim((string) ($x['title'] ?? $x['task'] ?? '')) : trim((string) $x))
            ->filter()->values()->all();
    }

    private function templates(string $term, int $limit): array
    {
        $q = $this->search(PmMeetingTemplate::query(), ['name', 'project_name', 'weekday', 'topics', 'attendees'], $term)->orderByDesc('active')->orderBy('name');

        return ['total' => $q->count(), 'rows' => $q->limit($limit)->get()->map(fn ($t) => [
            'name' => $t->name,
            'project' => $t->project_name,
            'weekday' => ucfirst((string) $t->weekday),
            'time' => $t->meeting_time?->format('H:i'),
            'active' => (bool) $t->active,
            'attendees' => array_values(array_filter((array) $t->attendees)),
            'topics' => $this->titles($t->topics),
        ])->all()];
    }

    private function packs(string $term, int $limit): array
    {
        $q = $this->search(PmTicketPack::query(), ['name', 'description', 'tickets'], $term)->orderBy('name');

        return ['total' => $q->count(), 'rows' => $q->limit($limit)->get()->map(fn ($p) => [
            'name' => $p->name,
            'description' => $p->description,
            'ticket_count' => count((array) $p->tickets),
            'tickets' => array_slice($this->titles($p->tickets), 0, 10),
        ])->all()];
    }

    private function minutes(string $term, array $o, int $limit): array
    {
        $q = MeetingMinutes::query()->latest('meeting_date')->latest('id');
        $this->search($q, ['title', 'discussion', 'raw_notes', 'attendees', 'topics'], $term);
        if (! empty($o['status'])) {
            $q->where('status', Str::lower($o['status']));
        }
        if (! empty($o['date'])) {
            $q->whereDate('meeting_date', $o['date']);
        }

        return ['total' => $q->count(), 'rows' => $q->limit($limit)->get()->map(fn ($m) => [
            'title' => $m->title,
            'date' => $m->meeting_date?->toDateString(),
            'status' => $m->status,
            'attendees' => array_values(array_filter((array) $m->attendees)),
            'topics' => $this->titles($m->topics),
            'decisions' => $this->titles($m->decisions),
            'action_items' => collect((array) $m->action_items)->map(fn ($a) => is_array($a)
                ? trim(($a['task'] ?? '').(! empty($a['owner']) ? " — {$a['owner']}" : '').(! empty($a['due_date']) ? " (due {$a['due_date']})" : '')) : (string) $a)->filter()->values()->all(),
            'work_items' => count((array) $m->work_items),
        ])->all()];
    }

    private function drafts(string $term, array $o, int $limit): array
    {
        $q = $this->search(PmDraft::query()->latest('updated_at'), ['title', 'brief', 'source_title'], $term);
        if (! empty($o['status'])) {
            $q->where('status', Str::lower($o['status']));
        }

        return ['total' => $q->count(), 'rows' => $q->limit($limit)->get()->map(fn ($d) => [
            'title' => $d->title,
            'status' => $d->status,
            'source' => $d->source_title ?: $d->source_type,
            'created_by' => $d->created_by,
            'updated' => $d->updated_at?->diffForHumans(),
            'ticket_count' => count((array) $d->tickets),
            'tickets' => array_slice($this->titles($d->tickets), 0, 8),
        ])->all()];
    }

    private function reports(array $o, int $limit): array
    {
        $q = PmReport::query()->latest('report_date');
        if (! empty($o['kind'])) {
            $q->where('kind', $o['kind']);
        }
        if (! empty($o['date'])) {
            $q->where('report_date', $o['date']);
        }

        return ['total' => $q->count(), 'rows' => $q->limit(min($limit, 5))->get()->map(fn ($r) => [
            'kind' => $r->kind,
            'date' => $r->report_date,
            'auto' => (bool) $r->auto,
            'generated_by' => $r->generated_by,
            'notes' => $r->notes,
            'body' => Str::limit(trim((string) $r->body), 1800),
        ])->all()];
    }

    private function qa(string $term, array $o, int $limit): array
    {
        $q = $this->search(PmQaIssue::query(), ['title', 'description', 'business', 'site_app', 'assignee', 'page_url'], $term)
            ->orderByRaw("CASE severity WHEN 'Critical' THEN 1 WHEN 'High' THEN 2 WHEN 'Medium' THEN 3 ELSE 4 END")->latest('updated_at');
        if (! empty($o['status'])) {
            $q->where('status', $o['status']);
        } elseif ($o['open'] ?? true) {
            $q->where('status', '!=', 'Passed');
        }
        if (! empty($o['severity'])) {
            $q->where('severity', $o['severity']);
        }

        return ['total' => $q->count(), 'rows' => $q->limit($limit)->get()->map(fn ($i) => [
            'title' => $i->title,
            'severity' => $i->severity,
            'status' => $i->status,
            'business' => $i->business,
            'site_app' => $i->site_app,
            'page_url' => $i->page_url,
            'assignee' => $i->assignee,
            'description' => Str::limit(trim((string) $i->description), 220),
            'task_link' => $i->pm_task_url,
            'retest_notes' => Str::limit(trim((string) $i->retest_notes), 160),
        ])->all()];
    }

    private function businesses(string $term, int $limit): array
    {
        $q = $this->search(PmBusiness::query()->with('projectLinks'), ['name', 'description'], $term)
            ->withCount(['intakes as open_intakes' => fn ($i) => $i->whereNotIn('status', ['rejected', 'deferred', 'planned'])])
            ->orderBy('name');

        return ['total' => $q->count(), 'rows' => $q->limit($limit)->get()->map(fn ($b) => [
            'name' => $b->name,
            'status' => $b->status,
            'description' => Str::limit(trim((string) $b->description), 200),
            'projects' => $b->projectLinks->pluck('taskmandu_project_name')->values()->all(),
            'open_requests' => (int) $b->open_intakes,
        ])->all()];
    }

    private function waiting(string $term, int $limit): array
    {
        $q = $this->search(PmWaitingClient::query()->where('status', 'waiting'), ['title'], $term)->orderBy('waiting_since');

        return ['total' => $q->count(), 'rows' => $q->limit($limit)->get()->map(fn ($w) => [
            'title' => $w->title,
            'waiting_since' => $w->waiting_since?->toDateString(),
            'days_waiting' => $w->waiting_since ? (int) $w->waiting_since->diffInDays(now()->startOfDay(), true) : null,
            'last_checked' => $w->last_checked_at?->toDateString(),
        ])->all()];
    }

    private function health(string $term, int $limit): array
    {
        $rows = PmProjectHealth::query()->orderByDesc('calculated_at')->get()->unique('project_id')
            ->when($term !== '', fn ($c) => $c->filter(fn ($h) => Str::contains(Str::lower($h->project_name), Str::lower($term))))
            ->sortBy('score')->values();

        return ['total' => $rows->count(), 'rows' => $rows->take($limit)->map(fn ($h) => [
            'project' => $h->project_name,
            'health' => $h->health,
            'score' => $h->score,
            'overdue' => $h->overdue_count,
            'idle_days' => $h->idle_days,
            'as_of' => $h->calculated_at?->diffForHumans(),
        ])->all()];
    }

    private function contacts(string $term, int $limit): array
    {
        $q = $this->search(PmContact::query(), ['name', 'email'], $term)->orderBy('name');

        return ['total' => $q->count(), 'rows' => $q->limit($limit)->get()->map(fn ($c) => ['name' => $c->name, 'email' => $c->email])->all()];
    }

    private function subtasks(string $term, array $o, int $limit): array
    {
        $q = $this->search(PmSubtask::query(), ['title', 'parent_title', 'project_name'], $term)->orderByRaw('CASE WHEN assignee IS NULL THEN 0 ELSE 1 END')->orderBy('parent_due_at');
        $status = $o['status'] ?? 'open';
        match (Str::lower((string) $status)) {
            'open', '' => $q->whereNotIn('status', ['Completed', 'Cancelled']),
            'completed', 'done' => $q->where('status', 'Completed'),
            'all' => null,
            default => $q->where('status', $status),
        };
        if (! empty($o['person'])) {
            $q->whereRaw('LOWER(assignee) LIKE ?', ['%'.Str::lower($o['person']).'%']);
        }
        if (! empty($o['project'])) {
            $q->whereRaw('LOWER(project_name) LIKE ?', ['%'.Str::lower($o['project']).'%']);
        }
        if (! empty($o['unassigned'])) {
            $q->whereNull('assignee');
        }

        return ['total' => $q->count(), 'rows' => $q->limit($limit)->get()->map(fn ($s) => [
            'title' => $s->title,
            'task' => $s->parent_title,
            'project' => $s->project_name,
            'assignee' => $s->assignee,
            'status' => $s->status,
            'task_due' => $s->parent_due_at?->toDateString(),
            'snoozed_until' => $s->snoozed_until?->toDateString(),
        ])->all()];
    }

    private function feed(string $term, array $o, int $limit): array
    {
        $q = $this->search(PmTaskmanduEvent::query()->latest('occurred_at'), ['body', 'task_title', 'subtask_title'], $term);
        if (! empty($o['person'])) {
            $p = '%'.Str::lower($o['person']).'%';
            $q->where(fn ($w) => $w->whereRaw('LOWER(actor_name) LIKE ?', [$p])->orWhereRaw('LOWER(owner_name) LIKE ?', [$p]));
        }
        if (! empty($o['project'])) {
            $q->whereRaw('LOWER(project_name) LIKE ?', ['%'.Str::lower($o['project']).'%']);
        }
        if (! empty($o['kind'])) {
            $q->where('event_type', $o['kind']);
        }

        return ['total' => $q->count(), 'rows' => $q->limit($limit)->get()->map(fn ($e) => [
            'when' => $e->occurred_at?->diffForHumans(),
            'type' => $e->event_type,
            'project' => $e->project_name,
            'task' => $e->task_title,
            'subtask' => $e->subtask_title,
            'by' => $e->actor_name,
            'owner' => $e->owner_name,
            'text' => Str::limit(trim((string) $e->body), 200),
            'from' => $e->status_from,
            'to' => $e->status_to,
        ])->all()];
    }

    private function git(): array
    {
        try {
            $s = app(GitService::class)->status();
        } catch (\Throwable) {
            return ['total' => 0, 'rows' => []];
        }

        return ['total' => 1, 'rows' => [[
            'branch' => $s['branch'],
            'ahead' => $s['ahead'],
            'behind' => $s['behind'],
            'uncommitted_files' => count($s['dirty']),
            'last_commit' => $s['last_commit'],
            'branches' => collect($s['branches'] ?? [])->map(fn ($b) => is_array($b) ? ($b['name'] ?? '') : (string) $b)->filter()->take(15)->values()->all(),
        ]]];
    }
}
