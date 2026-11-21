<?php

namespace App\Http\Controllers;

use App\Models\PmReport;
use App\Models\PmQaReport;
use App\Models\MeetingMinutes;
use App\Models\PmActivity;
use App\Models\PmCard;
use App\Models\PmSubtask;
use App\Models\PmQaTaskReview;
use App\Services\Pm\ReportService;
use App\Services\Pm\TaskmanduSync;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Throwable;

class ReportController extends Controller
{
    public function __construct(
        private ReportService $reports,
        private TaskmanduSync $taskmandu,
    ) {}

    public function index(): JsonResponse
    {
        return response()->json([
            'reports' => PmReport::query()->orderByDesc('report_date')->orderBy('kind')->limit(120)->get()->map(fn ($r) => $this->present($r))->all(),
        ]);
    }

    /** Date-scoped reporting across QA handovers, meeting minutes and task activity. */
    public function period(Request $r): JsonResponse
    {
        $data = $r->validate([
            'from' => 'required|date_format:Y-m-d',
            'to' => 'required|date_format:Y-m-d|after_or_equal:from',
        ]);
        $from = Carbon::parse($data['from'])->startOfDay();
        $to = Carbon::parse($data['to'])->endOfDay();

        $qaReports = PmQaReport::query()->whereBetween('report_date', [$from->toDateString(), $to->toDateString()])
            ->orderByDesc('report_date')->orderByDesc('id')->get()
            ->map(function (PmQaReport $report) {
                $findings = collect($report->findings ?? []);
                $counts = collect(['Critical', 'High', 'Medium', 'Low'])->mapWithKeys(fn ($severity) => [
                    strtolower($severity) => $findings->where('severity', $severity)->count(),
                ]);
                return [
                    'id' => $report->id, 'report_code' => $report->report_code,
                    'business' => $report->business, 'site_app' => $report->site_app,
                    'report_date' => $report->report_date?->toDateString(),
                    'finding_count' => $findings->count(), 'severity_counts' => $counts,
                    'handed_over_at' => $report->handed_over_at?->toIso8601String(),
                    'summary' => $report->summary,
                ];
            })->values();

        $minutes = MeetingMinutes::query()->whereBetween('meeting_date', [$from->toDateString(), $to->toDateString()])
            ->orderByDesc('meeting_date')->orderByDesc('id')->get()
            ->map(fn (MeetingMinutes $minute) => [
                'id' => $minute->id, 'title' => $minute->title,
                'status' => $minute->status ?? 'final',
                'meeting_date' => $minute->meeting_date?->toDateString(),
                'attendees' => $minute->attendees ?? [],
                'decisions' => $minute->decisions ?? [],
                'action_items' => $minute->action_items ?? [],
                'work_items' => $minute->work_items ?? [],
                'created_by' => $minute->created_by,
            ])->values();

        $activities = PmActivity::query()->whereBetween('occurred_at', [$from, $to])
            ->orderByDesc('occurred_at')->get();
        $cardIds = $activities->pluck('card_id')->filter()->unique()->values();
        $cards = $cardIds->isEmpty() ? collect() : PmCard::query()->whereIn('id', $cardIds)->get()->keyBy('id');

        $events = $activities->map(function (PmActivity $activity) use ($cards) {
            $card = $cards->get($activity->card_id);
            $meta = $activity->meta ?? [];
            return [
                'id' => $activity->id, 'type' => $activity->type,
                'title' => $activity->title ?: $card?->title ?: 'Activity',
                'occurred_at' => $activity->occurred_at?->toIso8601String(),
                'business' => $card?->project_name ?? ($meta['project'] ?? 'Standalone / shared'),
                'assignee' => $card?->assignee ?? ($meta['assignee'] ?? 'Unassigned'),
                'from' => $meta['from'] ?? null, 'to' => $meta['to'] ?? null,
            ];
        })->values();

        $businessRows = $events->groupBy('business')->map(fn ($rows, $business) => [
            'business' => $business,
            'activity_count' => $rows->count(),
            'tasks_created' => $rows->filter(fn ($e) => in_array($e['type'], ['created', 'pushed'], true))->count(),
            'tasks_completed' => $rows->filter(fn ($e) => $e['type'] === 'status_change' && $e['to'] === 'Completed')->count(),
            'blocked' => $rows->filter(fn ($e) => $e['type'] === 'status_change' && $e['to'] === 'Blocked')->count(),
            'comments' => $rows->where('type', 'comment')->count(),
        ])->sortByDesc('activity_count')->values();

        $teamRows = $events->flatMap(function ($event) {
            $names = filled($event['assignee']) ? array_map('trim', explode(',', $event['assignee'])) : ['Unassigned'];
            return collect($names)->filter()->map(fn ($name) => [
                'name' => $name, 'activity_count' => 1,
                'tasks_created' => in_array($event['type'], ['created', 'pushed'], true) ? 1 : 0,
                'tasks_completed' => $event['type'] === 'status_change' && $event['to'] === 'Completed' ? 1 : 0,
                'blocked' => $event['type'] === 'status_change' && $event['to'] === 'Blocked' ? 1 : 0,
            ]);
        })->groupBy('name')->map(fn ($rows, $name) => [
            'name' => $name, 'activity_count' => $rows->sum('activity_count'),
            'tasks_created' => $rows->sum('tasks_created'),
            'tasks_completed' => $rows->sum('tasks_completed'),
            'blocked' => $rows->sum('blocked'),
        ])->sortByDesc('activity_count')->values();

        $summary = [
            'activity_events' => $events->count(),
            'tasks_created' => $events->filter(fn ($e) => in_array($e['type'], ['created', 'pushed'], true))->count(),
            'tasks_completed' => $events->filter(fn ($e) => $e['type'] === 'status_change' && $e['to'] === 'Completed')->count(),
            'tasks_blocked' => $events->filter(fn ($e) => $e['type'] === 'status_change' && $e['to'] === 'Blocked')->count(),
            'comments' => $events->where('type', 'comment')->count(),
            'follow_ups' => $events->where('type', 'nudge')->count(),
            'verified' => $events->where('type', 'verify')->count(),
        ];

        $savedReports = PmReport::query()->whereBetween('report_date', [$from->toDateString(), $to->toDateString()])
            ->orderByDesc('report_date')->orderBy('kind')->get()->map(fn ($report) => $this->present($report))->values();

        return response()->json([
            'range' => ['from' => $from->toDateString(), 'to' => $to->toDateString()],
            'qa' => ['count' => $qaReports->count(), 'reports' => $qaReports],
            'minutes' => ['count' => $minutes->count(), 'meetings' => $minutes],
            'performance' => [
                'summary' => $summary, 'businesses' => $businessRows, 'team' => $teamRows,
                'activities' => $events->take(500)->values(),
                'activity_total' => $events->count(),
                'activity_truncated' => $events->count() > 500,
                'data_note' => 'Performance counts show recorded activity within the selected dates. Taskmandu changes are only as complete as the sync/activity history; current open workload is not presented as historical data.',
            ],
            'saved_reports' => $savedReports,
        ]);
    }

    public function store(Request $r): JsonResponse
    {
        $data = $r->validate([
            'date' => 'nullable|date_format:Y-m-d|before_or_equal:today',
            'notes' => 'nullable|string|max:6000',
            'sync' => 'nullable|boolean',
            'kind' => 'nullable|in:daily,weekly',
        ], [
            'date.before_or_equal' => 'Pick today or an earlier date — a report can’t be written for a day that hasn’t happened.',
            'notes.max' => 'The custom text is over the 6,000 character limit.',
        ]);

        // Refresh from Taskmandu first so the report reflects what is on the board now.
        // A failure here is reported, not fatal: the report is still built from the last sync.
        $warning = null;
        if (($data['sync'] ?? true) && $this->taskmandu->configured()) {
            try {
                $this->taskmandu->run();
            } catch (Throwable $e) {
                $warning = 'Couldn’t refresh from Taskmandu ('.$e->getMessage().') — used the last synced data.';
            }
        }

        $report = $this->reports->generate(
            isset($data['date']) ? Carbon::parse($data['date']) : now(),
            $data['notes'] ?? null,
            (string) ($r->user()?->name ?? 'PM'),
            kind: $data['kind'] ?? 'daily',
        );

        return response()->json(['report' => $this->present($report), 'warning' => $warning], 201);
    }

    /** Current operational snapshot grouped by Taskmandu project (the dashboard's business scope). */
    public function overview(): JsonResponse
    {
        $cards = PmCard::query()->whereNotNull('project_id')->orderBy('project_name')->orderBy('title')->get();
        $allSubtasks = PmSubtask::query()->orderBy('title')->get();
        $subtasks = $allSubtasks->groupBy(fn ($s) => (string) $s->project_id.':'.(string) $s->task_id);
        $reviews = PmQaTaskReview::query()->with('events')->get()->keyBy(fn ($r) => (string) $r->project_id.':'.(string) $r->task_id);

        $projectRows = $cards->groupBy(fn ($card) => (string) $card->project_id)->map(function ($items, $projectId) use ($subtasks, $reviews) {
            $first = $items->first();
            $tasks = $items->map(function ($card) use ($subtasks, $reviews) {
                $key = (string) $card->project_id.':'.(string) $card->task_id;
                $children = ($subtasks->get($key) ?? collect())->map(fn ($sub) => [
                    'id' => $sub->id, 'title' => $sub->title, 'status' => $sub->status,
                    'assignee' => $sub->assignee, 'completed_at' => $sub->completed_at?->toIso8601String(),
                ])->values();
                $qa = $reviews->get($key);
                return [
                    'id' => $card->id, 'task_id' => $card->task_id, 'title' => $card->title,
                    'status' => $card->status, 'assignee' => $card->assignee,
                    'due_at' => $card->due_at?->toDateString(), 'url' => $card->url,
                    'subtasks' => $children,
                    'subtasks_total' => $children->where('status', '!=', 'Cancelled')->count(),
                    'subtasks_completed' => $children->where('status', 'Completed')->count(),
                    'qa_status' => $qa?->qa_status ?? null,
                    'qa_cycle' => $qa?->cycle ?? null,
                    'qa_history' => $qa?->events?->map(fn ($event) => ['cycle' => $event->cycle, 'result' => $event->result, 'severity' => $event->severity, 'notes' => $event->notes, 'at' => $event->created_at?->toIso8601String()])->values() ?? [],
                ];
            })->values();
            $active = $items->filter(fn ($c) => ! in_array($c->status, ['Completed', 'Cancelled'], true));
            return [
                'project_id' => $projectId, 'project_name' => $first->project_name ?: 'Unnamed project',
                'task_count' => $items->count(),
                'completed' => $items->where('status', 'Completed')->count(),
                'open' => $active->count(),
                'in_progress' => $active->where('status', 'In Progress')->count(),
                'blocked' => $active->where('status', 'Blocked')->count(),
                'overdue' => $active->filter(fn ($c) => $c->due_at && $c->due_at->lt(today()))->count(),
                'qa_pending' => $reviews->filter(fn ($r) => (string) $r->project_id === $projectId && $r->qa_status === 'Awaiting QA')->count(),
                'qa_failed' => $reviews->filter(fn ($r) => (string) $r->project_id === $projectId && $r->qa_status === 'Failed')->count(),
                'tasks' => $tasks,
                'team' => $tasks->flatMap(function ($task) {
                    $rows = [];
                    $owners = filled($task['assignee']) ? array_filter(array_map('trim', explode(',', $task['assignee']))) : ['Unassigned'];
                    foreach ($owners as $owner) $rows[$owner] = ['name' => $owner, 'tasks_completed' => $task['status'] === 'Completed' ? 1 : 0, 'tasks_open' => ! in_array($task['status'], ['Completed', 'Cancelled'], true) ? 1 : 0, 'subtasks_completed' => 0, 'subtasks_open' => 0];
                    foreach ($task['subtasks'] as $sub) {
                        $subOwners = filled($sub['assignee']) ? array_filter(array_map('trim', explode(',', $sub['assignee']))) : ['Unassigned'];
                        foreach ($subOwners as $owner) {
                            $rows[$owner] ??= ['name' => $owner, 'tasks_completed' => 0, 'tasks_open' => 0, 'subtasks_completed' => 0, 'subtasks_open' => 0];
                            if ($sub['status'] !== 'Cancelled') $rows[$owner][$sub['status'] === 'Completed' ? 'subtasks_completed' : 'subtasks_open']++;
                        }
                    }
                    return array_values($rows);
                })->groupBy('name')->map(fn ($rows, $name) => ['name' => $name, 'tasks_completed' => $rows->sum('tasks_completed'), 'tasks_open' => $rows->sum('tasks_open'), 'subtasks_completed' => $rows->sum('subtasks_completed'), 'subtasks_open' => $rows->sum('subtasks_open')])->values(),
            ];
        })->values();

        $standalone = PmCard::query()->whereNull('project_id')->whereNotNull('task_id')->get();
        $unassigned = $cards->filter(fn ($c) => ! filled($c->project_id))->merge($standalone);
        $teamRows = [];
        $addPerson = function (?string $name, string $type, string $status) use (&$teamRows) {
            if ($status === 'Cancelled') return;
            $people = filled($name) ? array_values(array_filter(array_map('trim', explode(',', $name)))) : ['Unassigned'];
            foreach ($people as $person) {
                $teamRows[$person] ??= ['name' => $person, 'tasks_open' => 0, 'tasks_completed' => 0, 'subtasks_open' => 0, 'subtasks_completed' => 0, 'blocked' => 0, 'overdue' => 0];
                $key = $type === 'task' ? ($status === 'Completed' ? 'tasks_completed' : 'tasks_open') : ($status === 'Completed' ? 'subtasks_completed' : 'subtasks_open');
                $teamRows[$person][$key]++;
                if ($type === 'task' && $status === 'Blocked') $teamRows[$person]['blocked']++;
            }
        };
        foreach ($cards->concat($standalone) as $card) {
            $addPerson($card->assignee, 'task', (string) $card->status);
            if ($card->due_at && $card->due_at->lt(today()) && ! in_array($card->status, ['Completed', 'Cancelled'], true)) {
                foreach (filled($card->assignee) ? array_map('trim', explode(',', $card->assignee)) : ['Unassigned'] as $person) {
                    $teamRows[$person]['overdue'] = ($teamRows[$person]['overdue'] ?? 0) + 1;
                }
            }
        }
        foreach (PmSubtask::query()->get() as $subtask) $addPerson($subtask->assignee, 'subtask', (string) $subtask->status);

        $businessByPerson = [];
        foreach ($projectRows as $project) {
            foreach ($project['team'] as $member) {
                $businessByPerson[$member['name']][] = [
                    'project_name' => $project['project_name'],
                    'tasks_completed' => $member['tasks_completed'],
                    'tasks_open' => $member['tasks_open'],
                    'subtasks_completed' => $member['subtasks_completed'],
                    'subtasks_open' => $member['subtasks_open'],
                ];
            }
        }
        foreach ($teamRows as $name => &$row) {
            $row['businesses'] = $businessByPerson[$name] ?? [];
        }
        unset($row);

        return response()->json([
            'generated_at' => now()->toIso8601String(),
            'projects' => $projectRows,
            'team' => collect($teamRows)->sortBy('name')->values(),
            'unassigned_tasks' => $unassigned->map(fn ($c) => ['title' => $c->title, 'project_name' => $c->project_name, 'assignee' => $c->assignee, 'status' => $c->status])->values(),
            'totals' => [
                'businesses' => $projectRows->count(), 'tasks' => $cards->count() + $standalone->count(),
                'completed' => $cards->where('status', 'Completed')->count() + $standalone->where('status', 'Completed')->count(),
                'open' => $cards->reject(fn ($c) => in_array($c->status, ['Completed', 'Cancelled'], true))->count() + $standalone->reject(fn ($c) => in_array($c->status, ['Completed', 'Cancelled'], true))->count(),
                'blocked' => $cards->where('status', 'Blocked')->count() + $standalone->where('status', 'Blocked')->count(),
                'overdue' => $cards->filter(fn ($c) => $c->due_at && $c->due_at->lt(today()) && ! in_array($c->status, ['Completed', 'Cancelled'], true))->count() + $standalone->filter(fn ($c) => $c->due_at && $c->due_at->lt(today()) && ! in_array($c->status, ['Completed', 'Cancelled'], true))->count(),
                'qa_pending' => PmQaTaskReview::query()->where('qa_status', 'Awaiting QA')->count(),
                'qa_failed' => PmQaTaskReview::query()->where('qa_status', 'Failed')->count(),
                'subtasks_total' => $allSubtasks->where('status', '!=', 'Cancelled')->count(),
                'subtasks_completed' => $allSubtasks->where('status', 'Completed')->count(),
            ],
            'data_notes' => ['Business = Taskmandu project, matching the current project scope switcher.', 'Task and subtask counts are separate; subtasks are never counted as parent tasks.', 'QA counts come from task QA review records, not the Taskmandu Completed status.', 'This is a current snapshot, not a historical end-of-period snapshot.'],
        ]);
    }

    public function destroy(PmReport $report): JsonResponse
    {
        $report->delete();

        return response()->json(['deleted' => true]);
    }

    private function present(PmReport $r): array
    {
        return [
            'id' => $r->id,
            'kind' => $r->kind,
            'report_date' => $r->report_date,
            'auto' => $r->auto,
            'generated_by' => $r->generated_by,
            'generated_at' => $r->updated_at?->toIso8601String(),
            'notes' => $r->notes,
            'body' => $r->body,
            'content' => $r->content,
        ];
    }
}
