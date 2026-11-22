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
use Illuminate\Validation\Rule;
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
                    'areas_tested' => $report->areas_tested,
                    'environment' => $report->environment,
                    'fix_first' => $report->fix_first,
                    'open_questions' => $report->open_questions,
                    'checklist' => $report->checklist ?? [],
                    'findings' => $findings->values(),
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
                'agenda_items' => $minute->agenda_items ?? [],
                'discussion' => $minute->discussion,
                'topics' => $minute->topics ?? [],
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
                'assignee' => $meta['assignee'] ?? ($card?->assignee ?? 'Unassigned'),
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

        $subtaskRows = PmSubtask::query()
            ->where(function ($query) use ($from, $to) {
                $query->whereBetween('remote_created_at', [$from, $to])
                    ->orWhereBetween('completed_at', [$from, $to]);
            })->get();
        $subtaskCreated = $subtaskRows->filter(fn ($subtask) => $subtask->remote_created_at && $subtask->remote_created_at->between($from, $to));
        $subtaskCompleted = $subtaskRows->filter(fn ($subtask) => $subtask->completed_at && $subtask->completed_at->between($from, $to));
        $projectNames = PmCard::query()->whereNotNull('project_id')->get(['project_id', 'project_name'])
            ->unique('project_id')->keyBy(fn ($card) => (string) $card->project_id);
        $subtaskByProject = $subtaskRows->groupBy(fn ($subtask) => (string) $subtask->project_id)->map(function ($rows, $projectId) use ($projectNames, $from, $to) {
            return [
                'project_id' => $projectId,
                'project' => $projectNames->get($projectId)?->project_name ?? 'Unknown project',
                'created' => $rows->filter(fn ($subtask) => $subtask->remote_created_at && $subtask->remote_created_at->between($from, $to))->count(),
                'completed' => $rows->filter(fn ($subtask) => $subtask->completed_at && $subtask->completed_at->between($from, $to))->count(),
            ];
        })->values();
        $subtaskByTeam = [];
        foreach (['created' => $subtaskCreated, 'completed' => $subtaskCompleted] as $metric => $rows) {
            foreach ($rows as $subtask) {
                $owners = filled($subtask->assignee) ? array_filter(array_map('trim', explode(',', $subtask->assignee))) : ['Unassigned'];
                foreach ($owners as $owner) {
                    $subtaskByTeam[$owner] ??= ['name' => $owner, 'created' => 0, 'completed' => 0];
                    $subtaskByTeam[$owner][$metric]++;
                }
            }
        }

        $summary = [
            'activity_events' => $events->count(),
            'tasks_created' => $events->filter(fn ($e) => in_array($e['type'], ['created', 'pushed'], true))->count(),
            'tasks_completed' => $events->filter(fn ($e) => $e['type'] === 'status_change' && $e['to'] === 'Completed')->count(),
            'tasks_blocked' => $events->filter(fn ($e) => $e['type'] === 'status_change' && $e['to'] === 'Blocked')->count(),
            'comments' => $events->where('type', 'comment')->count(),
            'follow_ups' => $events->where('type', 'nudge')->count(),
            'verified' => $events->where('type', 'verify')->count(),
            'subtasks_created' => $subtaskCreated->count(),
            'subtasks_completed' => $subtaskCompleted->count(),
        ];

        $savedReports = PmReport::query()->whereBetween('report_date', [$from->toDateString(), $to->toDateString()])
            ->orderByDesc('report_date')->orderBy('kind')->get()->map(fn ($report) => $this->present($report))->values();

        return response()->json([
            'range' => ['from' => $from->toDateString(), 'to' => $to->toDateString()],
            'qa' => ['count' => $qaReports->count(), 'reports' => $qaReports],
            'minutes' => ['count' => $minutes->count(), 'meetings' => $minutes],
            'performance' => [
                'summary' => $summary, 'businesses' => $businessRows, 'team' => $teamRows,
                'subtasks' => ['created' => $subtaskCreated->count(), 'completed' => $subtaskCompleted->count(), 'by_project' => $subtaskByProject, 'by_team' => collect($subtaskByTeam)->sortByDesc(fn ($row) => $row['created'] + $row['completed'])->values()],
                'activities' => $events->take(500)->values(),
                'activity_total' => $events->count(),
                'activity_truncated' => $events->count() > 500,
                'data_note' => 'Performance counts show recorded activity within the selected dates. Taskmandu changes are only as complete as the sync/activity history; current open workload is not presented as historical data. Subtask creation and completion use Taskmandu remote-created and completion timestamps; assignee attribution reflects the mirrored assignee, not historical assignment changes.',
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

    /** Generate three saved report snapshots for a selected daily, weekly or custom period. */
    public function storePack(Request $request): JsonResponse
    {
        $data = $request->validate([
            'period_type' => ['required', Rule::in(['daily', 'weekly', 'date_range'])],
            'date' => 'nullable|date_format:Y-m-d|before_or_equal:today',
            'from' => 'nullable|date_format:Y-m-d|required_if:period_type,date_range',
            'to' => 'nullable|date_format:Y-m-d|required_if:period_type,date_range|after_or_equal:from|before_or_equal:today',
            'sync' => 'nullable|boolean',
        ]);
        $type = $data['period_type'];
        if ($type === 'daily') { $from = Carbon::parse($data['date'] ?? today())->startOfDay(); $to = $from->copy()->endOfDay(); }
        elseif ($type === 'weekly') { $from = Carbon::parse($data['date'] ?? today())->startOfWeek(Carbon::MONDAY); $to = $from->copy()->endOfWeek(Carbon::SUNDAY)->endOfDay(); if ($to->gt(now()->endOfDay())) $to = now()->endOfDay(); }
        else { $from = Carbon::parse($data['from'])->startOfDay(); $to = Carbon::parse($data['to'])->endOfDay(); }
        $warning = null;
        if (($data['sync'] ?? true) && $this->taskmandu->configured()) { try { $this->taskmandu->run(); } catch (Throwable $e) { $warning = 'Taskmandu refresh failed; using latest synced data. '.$e->getMessage(); } }
        $sourceRequest = Request::create('/pm/api/reports/period', 'GET', ['from' => $from->toDateString(), 'to' => $to->toDateString()]);
        $source = $this->period($sourceRequest)->getData(true);
        $definitions = ['qa' => ['title' => 'QA Report', 'data' => $source['qa']], 'minutes' => ['title' => 'Meeting Minutes', 'data' => $source['minutes']], 'performance' => ['title' => 'Tasks & Performance', 'data' => $source['performance']]];
        $saved = [];
        foreach ($definitions as $reportType => $definition) {
            $content = ['kind' => 'pack', 'report_type' => $reportType, 'title' => $definition['title'], 'period_type' => $type, 'period' => ['from' => $from->toDateString(), 'to' => $to->toDateString()], 'generated_at' => now()->toIso8601String(), 'data' => $definition['data']];
            $content['summary'] = $reportType === 'qa' ? ['reports' => count($definition['data']['reports'] ?? []), 'findings' => collect($definition['data']['reports'] ?? [])->sum(fn ($row) => count($row['findings'] ?? []))] : ($reportType === 'minutes' ? ['meetings' => count($definition['data']['meetings'] ?? [])] : ($definition['data']['summary'] ?? []));
            $body = $this->formatPackBody($definition['title'], $content);
            $report = PmReport::updateOrCreate(['kind' => $reportType, 'report_date' => $from->toDateString()], ['period_type' => $type, 'period_end' => $to->toDateString(), 'content' => $content, 'body' => $body, 'notes' => null, 'generated_by' => (string) ($request->user()?->name ?? 'PM'), 'auto' => false]);
            $saved[] = $this->present($report);
        }
        return response()->json(['reports' => $saved, 'warning' => $warning, 'period' => ['type' => $type, 'from' => $from->toDateString(), 'to' => $to->toDateString()]], 201);
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



    /** Download a Word-openable DOCX generated from saved report text. */
    public function exportDocx(PmReport $report)
    {
        if (!class_exists('ZipArchive')) return response()->json(['message'=>'DOCX export requires the PHP Zip extension on the server.'], 501);
        $text = ($report->content['kind'] ?? null) === 'pack' && $this->isLegacyPackBody($report->body)
            ? $this->formatPackBody($report->content['title'] ?? 'Report', $report->content)
            : ($report->body ?: $this->reports->render($report->content ?? []));
        $paragraphs = collect(preg_split('/\\r?\\n/', $text))->map(function ($line) {
            $line = htmlspecialchars($line, ENT_XML1 | ENT_COMPAT, 'UTF-8');
            return '<w:p><w:r><w:t xml:space="preserve">'.$line.'</w:t></w:r></w:p>';
        })->implode('');
        $document = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'.$paragraphs.'<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>';
        $tmp = tempnam(sys_get_temp_dir(), 'pm-report-'); $zip = new \ZipArchive();
        if ($zip->open($tmp, \ZipArchive::CREATE | \ZipArchive::OVERWRITE) !== true) { @unlink($tmp); return response()->json(['message'=>'Could not create DOCX file.'], 500); }
        $zip->addFromString('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
        $zip->addFromString('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
        $zip->addFromString('word/document.xml', $document); $zip->close();
        return response()->download($tmp, 'PM-Report-'.$report->kind.'-'.$report->report_date.'.docx', ['Content-Type'=>'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])->deleteFileAfterSend(true);
    }

    /** Edit a saved daily/weekly snapshot without changing source board data. */
    public function update(Request $request, PmReport $report): JsonResponse
    {
        $data = $request->validate([
            'content' => 'required|array', 'content.kind' => ['required', Rule::in(['daily','weekly','pack'])],
            'content.report_type' => 'required_if:content.kind,pack|in:qa,minutes,performance',
            'notes' => 'nullable|string|max:6000',
            'body' => 'sometimes|required|string|max:100000',
        ]);
        if (($data['content']['kind'] === 'pack' ? ($data['content']['report_type'] ?? null) : $data['content']['kind']) !== $report->kind) return response()->json(['message'=>'Report type cannot be changed.'], 422);
        $body = array_key_exists('body', $data) ? $data['body'] : (($data['content']['kind'] ?? null) === 'pack' ? $this->formatPackBody($data['content']['title'] ?? 'Report', $data['content']) : $this->reports->render($data['content']));
        $report->update(['content' => $data['content'], 'body' => $body, 'notes' => $data['notes'] ?? $report->notes, 'auto' => false]);
        return response()->json(['report' => $this->present($report->fresh())]);
    }

    private function isLegacyPackBody(?string $body): bool
    {
        return filled($body) && (bool) preg_match('/\\n\\s*[\\{\\[]\\s*\\n/', $body);
    }

    /** Turn report-pack data into readable document text rather than exposing JSON. */
    private function formatPackBody(string $title, array $content): string
    {
        $lines = [$title, 'Period: '.($content['period']['from'] ?? '').' to '.($content['period']['to'] ?? ''), ''];
        $summary = $content['summary'] ?? [];
        if ($summary) {
            $lines[] = 'SUMMARY';
            foreach ($summary as $key => $value) {
                $label = str($key)->replace('_', ' ')->title();
                $lines[] = $label.': '.(is_scalar($value) ? (string) $value : '');
            }
            $lines[] = '';
        }
        foreach (($content['data'] ?? []) as $key => $value) {
            $label = str((string) $key)->replace('_', ' ')->title();
            $lines[] = strtoupper($label);
            $this->appendReadableValue($lines, $value, 0);
            $lines[] = '';
        }
        return trim(implode("\n", $lines))."\n";
    }

    /** @param array<int, string> $lines */
    private function appendReadableValue(array &$lines, mixed $value, int $depth): void
    {
        $indent = str_repeat('  ', min($depth, 5));
        if (! is_array($value)) {
            if ($value !== null && $value !== '') $lines[] = $indent.'• '.(is_bool($value) ? ($value ? 'Yes' : 'No') : (string) $value);
            return;
        }
        if ($value === []) {
            $lines[] = $indent.'• None recorded';
            return;
        }
        foreach ($value as $key => $child) {
            if (is_int($key)) {
                if (is_array($child)) {
                    $heading = $child['title'] ?? $child['name'] ?? $child['business'] ?? $child['project'] ?? null;
                    if ($heading) $lines[] = $indent.'• '.$heading;
                    $this->appendReadableValue($lines, $child, $depth + 1);
                } else {
                    $this->appendReadableValue($lines, $child, $depth);
                }
                continue;
            }
            $label = str((string) $key)->replace('_', ' ')->title();
            if (is_array($child)) {
                $lines[] = $indent.$label.':';
                $this->appendReadableValue($lines, $child, $depth + 1);
            } elseif ($child !== null && $child !== '') {
                $display = is_bool($child) ? ($child ? 'Yes' : 'No') : (string) $child;
                $lines[] = $indent.$label.': '.$display;
            }
        }
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
            'report_type' => $r->kind,
            'period_type' => $r->period_type,
            'period_end' => $r->period_end,
            'report_date' => $r->report_date,
            'auto' => $r->auto,
            'generated_by' => $r->generated_by,
            'generated_at' => $r->updated_at?->toIso8601String(),
            'notes' => $r->notes,
            'body' => ($r->content['kind'] ?? null) === 'pack' && $this->isLegacyPackBody($r->body)
                ? $this->formatPackBody($r->content['title'] ?? 'Report', $r->content)
                : $r->body,
            'content' => $r->content,
        ];
    }
}
