<?php

namespace App\Http\Controllers;

use App\Models\PmActivity;
use App\Models\PmCard;
use App\Models\PmWaitingClient;
use App\Services\Pm\ClaudeClient;
use App\Services\Pm\DigestService;
use App\Services\Pm\FlagService;
use App\Services\Pm\GitHubService;
use App\Services\Pm\GitService;
use App\Services\Pm\TaskmanduSync;
use Illuminate\Http\JsonResponse;
use Carbon\Carbon;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Validation\Rule;
use Inertia\Inertia;
use Inertia\Response;
use RuntimeException;

class PmController extends Controller
{
    public function __construct(
        private FlagService $flags,
        private ClaudeClient $claude,
        private TaskmanduSync $taskmandu,
        private GitService $git,
        private GitHubService $github,
        private DigestService $digest,
    ) {}

    public function index(): Response
    {
        return Inertia::render('Pm/Index', $this->todayPayload());
    }

    /** Fresh Today data without a page reload (used after Sync now). */
    public function today(): JsonResponse
    {
        return response()->json($this->todayPayload());
    }

    /** Pulls from Taskmandu right now, then returns the refreshed Today data. */
    public function sync(): JsonResponse
    {
        if (! $this->taskmandu->configured()) {
            return response()->json(['error' => 'Set TASKMANDU_BASE_URL, TASKMANDU_EMAIL and TASKMANDU_PASSWORD in .env'], 422);
        }

        @set_time_limit(180);

        try {
            $synced = $this->taskmandu->run();
        } catch (\Throwable $e) {
            report($e);

            return response()->json(['error' => "Couldn't sync from Taskmandu: ".$e->getMessage()], 422);
        }

        Cache::forget('pm.employees');

        return response()->json($this->todayPayload() + ['synced' => $synced]);
    }

    /** The morning digest as text, plus which delivery channels are configured. */
    public function digest(): JsonResponse
    {
        $data = $this->digest->build($this->staff());

        return response()->json([
            'text' => $this->digest->text($data),
            'channels' => $this->digest->channels(),
        ]);
    }

    /** Sends the morning digest now to the configured Slack / email channels. */
    public function digestSend(): JsonResponse
    {
        if (! in_array(true, $this->digest->channels(), true)) {
            return response()->json(['error' => 'No delivery channel set. Add PM_DIGEST_SLACK_WEBHOOK and/or PM_DIGEST_EMAIL to .env.'], 422);
        }

        $result = $this->digest->send($this->digest->build($this->staff()));

        if (! $result['sent']) {
            return response()->json(['error' => 'Digest not sent: '.implode('; ', $result['errors'])], 422);
        }

        return response()->json($result);
    }

    /** Records that the PM actually sent a nudge (e.g. copied the template message). */
    /**
     * PM command center: turns the synced Taskmandu snapshot into decisions and
     * actions. Today remains the detailed task execution view; this endpoint
     * deliberately answers "why does this matter?" and gives the PM a next step.
     */
    public function commandCenter(): JsonResponse
    {
        $flags = $this->flags->all();
        $workload = collect($this->flags->workload($this->staff()));
        $waiting = PmWaitingClient::query()
            ->where('status', 'waiting')
            ->orderBy('waiting_since')
            ->get();

        $cards = PmCard::query()
            ->whereNotIn('status', ['Completed', 'Cancelled'])
            ->get();

        $actions = [];

        // 1. Concrete task-level attention. These are intentionally richer than
        // Today's counters: each item carries a recommended PM action.
        foreach ($flags->sortBy(fn ($f) => ['danger' => 0, 'warning' => 1, 'neutral' => 2][$f['severity']] ?? 2) as $flag) {
            $action = match ($flag['type']) {
                'overdue' => 'Follow up',
                'blocked' => 'Resolve blocker',
                'unassigned' => 'Assign owner',
                'stuck' => 'Ask for update',
                'unverified' => 'Verify',
                'due_today' => 'Check delivery',
                default => 'Review task',
            };

            $actions[] = [
                'kind' => 'task',
                'priority' => ['danger' => 0, 'warning' => 1, 'neutral' => 2][$flag['severity']] ?? 2,
                'card_id' => $flag['card_id'],
                'task_id' => $flag['task_id'],
                'project_id' => $flag['project_id'],
                'project_name' => $flag['project_name'],
                'title' => $flag['title'],
                'assignee' => $flag['assignee'],
                'reason' => $flag['detail'],
                'action' => $action,
            ];

            if (count($actions) >= 8) break;
        }

        // 2. Capacity problems become actionable PM decisions.
        foreach ($workload
            ->filter(fn ($w) => ($w['week_hours'] ?? 0) > ($w['capacity'] ?? 40))
            ->sortByDesc(fn ($w) => ($w['week_hours'] ?? 0) - ($w['capacity'] ?? 40))
            ->take(4) as $w) {
            $actions[] = [
                'kind' => 'capacity',
                'priority' => 0,
                'card_id' => null,
                'task_id' => null,
                'project_id' => null,
                'project_name' => null,
                'title' => $w['name'].' is overloaded',
                'assignee' => $w['name'],
                'reason' => sprintf('%.1fh assigned against %.1fh capacity; %.1fh over.', $w['week_hours'] ?? 0, $w['capacity'] ?? 40, max(0, ($w['week_hours'] ?? 0) - ($w['capacity'] ?? 40))),
                'action' => 'Rebalance work',
            ];
        }

        $projects = $this->commandCenterProjects($cards, $waiting);

        return response()->json([
            'actions' => collect($actions)->take(12)->values()->all(),
            'overloaded' => $workload
                ->filter(fn ($w) => ($w['week_hours'] ?? 0) > ($w['capacity'] ?? 40))
                ->sortByDesc(fn ($w) => ($w['week_hours'] ?? 0) - ($w['capacity'] ?? 40))
                ->take(8)
                ->values()
                ->map(fn ($w) => [
                    'name' => $w['name'],
                    'week_hours' => (float) ($w['week_hours'] ?? 0),
                    'capacity' => (float) ($w['capacity'] ?? 40),
                    'excess' => round(max(0, ($w['week_hours'] ?? 0) - ($w['capacity'] ?? 40)), 1),
                    'open' => (int) ($w['open'] ?? 0),
                    'overdue' => (int) ($w['overdue'] ?? 0),
                ])->all(),
            'free' => $workload
                ->sortByDesc(fn ($w) => ($w['capacity'] ?? 40) - ($w['week_hours'] ?? 0))
                ->take(8)
                ->values()
                ->map(fn ($w) => [
                    'name' => $w['name'],
                    'week_hours' => (float) ($w['week_hours'] ?? 0),
                    'capacity' => (float) ($w['capacity'] ?? 40),
                    'room' => round(max(0, ($w['capacity'] ?? 40) - ($w['week_hours'] ?? 0)), 1),
                    'open' => (int) ($w['open'] ?? 0),
                ])->all(),
            'waiting' => $waiting->map(fn ($w) => [
                'id' => $w->id,
                'title' => $w->title,
                'project_id' => $w->project_id,
                'card_id' => $w->card_id,
                'waiting_since' => $w->waiting_since?->toDateString(),
                'days' => $w->waiting_since ? (int) $w->waiting_since->diffInDays(now()) : 0,
                'severity' => $w->waiting_since && $w->waiting_since->lt(now()->subDays(5)) ? 'red' : ($w->waiting_since && $w->waiting_since->lt(now()->subDays(3)) ? 'amber' : 'slate'),
            ])->take(8)->values()->all(),
            'projects' => $projects,
            'aging' => $this->commandCenterAging($cards),
            'recent' => PmActivity::query()
                ->whereIn('type', ['created', 'status_change', 'comment'])
                ->where('occurred_at', '>=', now()->subDay())
                ->latest('occurred_at')
                ->limit(12)
                ->get()
                ->map(fn ($a) => [
                    'type' => $a->type,
                    'title' => $a->title,
                    'occurred_at' => $a->occurred_at?->toIso8601String(),
                    'project' => $a->meta['project'] ?? null,
                    'from' => $a->meta['from'] ?? null,
                    'to' => $a->meta['to'] ?? null,
                ])->values()->all(),
        ]);
    }

    /**
     * One deterministic risk model. No AI and no manually entered status.
     * Scores are penalties from observable Taskmandu/PM data.
     */
    private function commandCenterProjects($cards, $waiting): array
    {
        $today = now()->startOfDay();
        $all = PmCard::query()->whereNotNull('project_id')->get();

        return $all->groupBy('project_id')->map(function ($rows, $projectId) use ($cards, $waiting, $today) {
            $active = $rows->whereNotIn('status', ['Completed', 'Cancelled']);
            $total = $rows->count();
            $completed = $rows->where('status', 'Completed')->count();

            $overdue = $active->filter(fn ($c) => $c->due_at && $c->due_at->lt($today))->count();
            $dueSoon = $active->filter(function ($c) use ($today) {
                if (! $c->due_at) return false;

                $d = Carbon::parse($c->due_at)
                    ->startOfDay()
                    ->diffInDays($today, false);

                return $d >= 0 && $d <= 5;
            })->count();
            $blocked = $active->where('status', 'Blocked')->count();
            $unassigned = $active->filter(fn ($c) => blank($c->assignee))->count();
            $last = $active->max('last_activity_at');
            $idle = $last ? (int) Carbon::parse($last)->diffInDays(now()) : 999;

            $waitingRows = $waiting->where('project_id', $projectId);
            $waitingDays = $waitingRows->max(fn ($w) => $w->waiting_since ? $w->waiting_since->diffInDays(now()) : 0);

            $teamNames = $active->pluck('assignee')->filter()->flatMap(fn ($names) => array_map('trim', explode(',', $names)))->unique();
            $teamRows = $this->flags->workload($this->staff());
            $team = collect($teamRows)->filter(fn ($w) => $teamNames->contains($w['name'] ?? ''));
            $teamLoad = $team->count()
                ? $team->avg(fn ($w) => ($w['capacity'] ?? 40) > 0 ? (($w['week_hours'] ?? 0) / ($w['capacity'] ?? 40)) * 100 : 0)
                : 0;

            $schedule = max(0, 100 - min(50, $overdue * 15) - min(30, $dueSoon * 6));
            $tasks = $total ? round(($completed / $total) * 100) : 100;
            $teamScore = $team->count() ? max(0, round(100 - max(0, $teamLoad - 70))) : 100;
            $client = $waitingRows->count() ? max(0, 100 - min(70, ($waitingDays ?: 0) * 10)) : 100;
            $delivery = max(0, 100 - min(35, $overdue * 10) - min(25, $blocked * 10) - min(20, $idle * 3));
            $overall = (int) round(($delivery + $tasks + $schedule + $teamScore + $client) / 5);

            $why = [];
            if ($overdue) $why[] = $overdue.' overdue task'.($overdue === 1 ? '' : 's');
            if ($blocked) $why[] = $blocked.' blocked task'.($blocked === 1 ? '' : 's');
            if ($unassigned) $why[] = $unassigned.' unassigned task'.($unassigned === 1 ? '' : 's');
            if ($waitingRows->count()) $why[] = 'client waiting '.($waitingDays ?? 0).' days';
            if ($idle >= 3) $why[] = $idle === 999 ? 'no activity recorded' : $idle.' days since movement';

            $health = $overall < 45 ? 'red' : ($overall < 70 ? 'amber' : 'green');

            $nextDue = $active->filter(fn ($c) => $c->due_at)->sortBy('due_at')->first();

            return [
                'project_id' => $projectId,
                'project_name' => $rows->first()->project_name ?: 'Unnamed project',
                'score' => $overall,
                'health' => $health,
                'delivery' => $delivery,
                'tasks' => $tasks,
                'schedule' => $schedule,
                'team' => $teamScore,
                'client' => $client,
                'overdue' => $overdue,
                'blocked' => $blocked,
                'unassigned' => $unassigned,
                'idle_days' => $idle,
                'waiting_days' => $waitingDays ?: 0,
                'waiting_count' => $waitingRows->count(),
                'due_soon' => $dueSoon,
                'completed' => $completed,
                'total' => $total,
                'next_due' => $nextDue?->due_at?->toDateString(),
                'why' => array_slice($why, 0, 4),
            ];
        })->sortBy('score')->take(10)->values()->all();
    }

    /**
     * Tasks that have gone quiet for at least three days, even when their due
     * date has not passed. This catches stale work rather than only late work.
     */
    private function commandCenterAging($cards): array
    {
        return $cards
            ->filter(fn ($c) => $c->last_activity_at && $c->last_activity_at->lt(now()->subDays(3)))
            ->sortBy('last_activity_at')
            ->take(12)
            ->map(fn ($c) => [
                'card_id' => $c->id,
                'task_id' => $c->task_id,
                'project_id' => $c->project_id,
                'project_name' => $c->project_name,
                'title' => $c->title,
                'assignee' => $c->assignee,
                'status' => $c->status,
                'days' => (int) $c->last_activity_at->diffInDays(now()),
                'last_activity_at' => $c->last_activity_at->toIso8601String(),
            ])->values()->all();
    }

    /** Assign a synced Taskmandu task to one employee without leaving Command Center. */
    public function commandCenterReassign(Request $r): JsonResponse
    {
        $data = $r->validate([
            'card_id' => 'required|integer|exists:pm_cards,id',
            'employee_id' => 'required|string|max:100',
        ]);
        $card = PmCard::findOrFail($data['card_id']);
        if (! $card->task_id) {
            return response()->json(['error' => 'This item has no Taskmandu task id.'], 422);
        }

        $employees = $this->taskmandu->listEmployees();
        $employee = collect($employees)->first(fn ($e) => ($e['employeeId'] ?? null) === $data['employee_id']);
        if (! $employee) {
            return response()->json(['error' => 'That employee is not available in Taskmandu.'], 422);
        }

        $path = $card->project_id
            ? "/projects/{$card->project_id}/tasks/{$card->task_id}"
            : "/tasks/{$card->task_id}";
        $this->taskmandu->patch($path, ['assignedToId' => [$data['employee_id']]]);

        $old = $card->assignee;
        $card->update(['assignee' => $employee['name'], 'last_activity_at' => now()]);
        PmActivity::record('owner_change', $card, [
            'from' => $old,
            'to' => $employee['name'],
            'source' => 'command_center',
        ]);

        return response()->json(['ok' => true, 'card' => $card->fresh()]);
    }

    /** Resolve a blocker by moving the Taskmandu task back into active work. */
    public function commandCenterResolveBlocker(PmCard $card): JsonResponse
    {
        if (! $card->task_id) {
            return response()->json(['error' => 'This item has no Taskmandu task id.'], 422);
        }
        if ($card->status !== 'Blocked') {
            return response()->json(['error' => 'This task is no longer blocked.'], 422);
        }

        $path = $card->project_id
            ? "/projects/{$card->project_id}/tasks/{$card->task_id}"
            : "/tasks/{$card->task_id}";
        $this->taskmandu->patch($path, ['status' => 'In Progress']);

        $card->update(['status' => 'In Progress', 'last_activity_at' => now()]);
        PmActivity::record('status_change', $card, [
            'from' => 'Blocked',
            'to' => 'In Progress',
            'source' => 'command_center',
        ]);

        return response()->json(['ok' => true, 'card' => $card->fresh()]);
    }

    /** Generate a reviewable follow-up for a waiting item when it is tied to a task. */
    public function commandCenterFollowUp(PmWaitingClient $item): JsonResponse
    {
        if ($item->status !== 'waiting') {
            return response()->json(['error' => 'This waiting item is already resolved.'], 422);
        }
        if (! $item->card_id) {
            return response()->json(['error' => 'Link this waiting item to a task before generating a follow-up.'], 422);
        }

        $card = PmCard::find($item->card_id);
        if (! $card) {
            return response()->json(['error' => 'The linked task no longer exists in the PM snapshot.'], 422);
        }

        $message = $this->claude->ask(
            'Write a short, friendly client follow-up about the item below. Max 3 sentences. No emojis. Ask for the specific outstanding response. Do not invent details.',
            json_encode([
                'waiting_item' => $item->title,
                'task' => $card->title,
                'days_waiting' => $item->waiting_since ? $item->waiting_since->diffInDays(now()) : 0,
            ]),
            300
        );
        PmActivity::record('client_follow_up', $card, ['waiting_item_id' => $item->id, 'source' => 'command_center']);

        return response()->json(['message' => trim($message)]);
    }

    /** List only the pushes made by Brief to tickets and not already undone. */
    public function recentPushes(): JsonResponse
    {
        $items = PmActivity::query()->where('type', 'pushed')->latest('occurred_at')->limit(30)->get()
            ->filter(fn ($a) => empty($a->meta['undone_at']) && !empty($a->meta['task_id']))
            ->map(fn ($a) => [
                'id' => $a->id,
                'title' => $a->title,
                'task_id' => $a->meta['task_id'],
                'project_id' => $a->meta['project_id'] ?? null,
                'project_name' => $a->meta['project'] ?? null,
                'occurred_at' => $a->occurred_at?->toIso8601String(),
            ])->values()->all();

        return response()->json(['pushes' => $items]);
    }

    /** Undo one PM-created ticket by deleting exactly the Taskmandu id recorded at push time. */
    public function undoPush(PmActivity $activity): JsonResponse
    {
        if ($activity->type !== 'pushed' || empty($activity->meta['task_id'])) {
            return response()->json(['error' => 'That activity is not an undoable PM ticket push.'], 422);
        }
        if (!empty($activity->meta['undone_at'])) {
            return response()->json(['error' => 'This ticket has already been undone.'], 422);
        }

        try {
            $this->taskmandu->deletePushedTask((string) $activity->meta['task_id'], $activity->meta['project_id'] ?? null);
        } catch (RuntimeException $e) {
            return response()->json(['error' => $e->getMessage()], 422);
        }

        if ($cardId = $activity->card_id) {
            PmCard::query()->whereKey($cardId)->delete();
        }
        $activity->update(['meta' => array_merge($activity->meta ?? [], [
            'undone_at' => now()->toIso8601String(),
            'undone_by' => request()->user()?->name,
        ])]);
        PmActivity::record('push_undone', null, [
            'original_push_id' => $activity->id,
            'task_id' => $activity->meta['task_id'],
            'project_id' => $activity->meta['project_id'] ?? null,
        ], $activity->title);

        return response()->json(['ok' => true]);
    }

    public function nudged(PmCard $card): JsonResponse
    {
        PmActivity::record('nudge', $card, ['template' => true]);

        return response()->json(['at' => now()->toIso8601String()]);
    }

    private function todayPayload(): array
    {
        $flags = $this->flags->all();
        $workload = $this->flags->workload($this->staff());

        return [
            'flags' => $flags->values(),
            'metrics' => $this->flags->metrics($flags),
            'workload' => $workload,
            'since' => $this->flags->sinceLastWorkday($workload),
            'lastSyncedAt' => Cache::get('pm.last_synced_at'),
        ];
    }

    /**
     * Everyone in Taskmandu, so people with no open tasks show up in the workload.
     * Cached (and failures cached briefly) so Today never waits on Taskmandu twice.
     */
    private function staff(): array
    {
        if (! $this->taskmandu->configured()) {
            return [];
        }

        $staff = Cache::get('pm.employees');
        if ($staff === null) {
            try {
                $staff = $this->taskmandu->listEmployees();
                Cache::put('pm.employees', $staff, 600);
            } catch (\Throwable $e) {
                report($e);
                $staff = [];
                Cache::put('pm.employees', $staff, 60);
            }
        }

        return $staff;
    }

    public function ask(Request $r): JsonResponse
    {
        $data = $r->validate(['question' => 'required|string|max:500']);

        $answer = $this->claude->ask(
            "You are a PM assistant for a small dev agency. Answer only from the board data below. Be terse. Name the cards you rely on. If the data can't answer the question, say so.\n\nBoard:\n".$this->flags->snapshot(),
            $data['question']
        );

        return response()->json(['answer' => $answer]);
    }

    public function nudge(PmCard $card): JsonResponse
    {
        $message = $this->claude->ask(
            'Write a short, friendly status-check message from the PM to the assignee about this card. Max 2 sentences. No emojis. Do not blame.',
            json_encode([
                'title' => $card->title,
                'assignee' => $card->assignee,
                'status' => $card->status,
                'due' => $card->due_at?->toDateString(),
                'last_activity' => $card->last_activity_at?->toDateString(),
            ]),
            300
        );

        PmActivity::record('nudge', $card);

        return response()->json(['message' => trim($message)]);
    }

    public function snooze(PmCard $card): RedirectResponse
    {
        $card->update(['snoozed_until' => now()->addDays(3)->toDateString()]);
        PmActivity::record('snooze', $card);

        return back();
    }

    public function verify(PmCard $card): RedirectResponse
    {
        $card->update(['verified' => true]);
        PmActivity::record('verify', $card);

        return back();
    }

    public function brief(Request $r): JsonResponse
    {
        $data = $r->validate(
            ['brief' => 'required|string|max:8000'],
            [
                'brief.required' => 'Paste a brief first.',
                'brief.max' => 'The brief is over the 8,000 character limit — trim it or split it into two briefs.',
            ]
        );

        try {
            $out = $this->claude->json(
                'You are a PM at a small dev agency (Laravel, Inertia, React). Split the client brief into small tickets. level is "senior dev" for architecture, integrations, payments or anything risky, and "intern" for UI, copy and simple CRUD. estimate_hours is a number. Also list questions that need answers before work starts. Shape: {"tickets":[{"title":"","description":"","level":"senior dev","estimate_hours":2}],"questions":[""]}',
                $data['brief']
            );
        } catch (RuntimeException $e) {
            return response()->json(['error' => $e->getMessage()], 422);
        }

        $all = collect($out['tickets'] ?? [])
            ->filter(fn ($t) => is_array($t) && filled($t['title'] ?? null))
            ->map(fn ($t) => [
                'title' => mb_substr((string) $t['title'], 0, 200),
                'description' => mb_substr((string) ($t['description'] ?? ''), 0, 3000),
                'level' => str_contains(strtolower((string) ($t['level'] ?? '')), 'senior') ? 'senior dev' : 'intern',
                'estimate_hours' => is_numeric($t['estimate_hours'] ?? null) ? (float) $t['estimate_hours'] : 2,
            ])
            ->values();

        return response()->json([
            // push() accepts at most 30 tickets, so never hand back more than that.
            'tickets' => $all->take(30)->all(),
            'truncated' => max(0, $all->count() - 30),
            'questions' => array_values(array_filter(array_map('strval', $out['questions'] ?? []))),
        ]);
    }

    public function employees(): JsonResponse
    {
        try {
            return response()->json(['employees' => $this->employeesWithLoad()]);
        } catch (RuntimeException $e) {
            return response()->json(['error' => $e->getMessage()], 422);
        }
    }

    /**
     * Everything the "Brief to tickets" tab needs up front: employees with their
     * open-task counts, and existing card titles for the duplicate warning.
     */
    public function briefContext(): JsonResponse
    {
        try {
            $employees = $this->employeesWithLoad();
        } catch (RuntimeException $e) {
            return response()->json(['error' => $e->getMessage()], 422);
        }

        $titles = PmCard::query()
            ->where('status', '!=', 'Cancelled')
            ->latest('id')
            ->limit(1500)
            ->get(['title', 'project_name', 'status'])
            ->map(fn ($c) => ['title' => $c->title, 'project_name' => $c->project_name, 'status' => $c->status])
            ->all();

        return response()->json(['employees' => $employees, 'titles' => $titles]);
    }

    /**
     * Pushes drafted tickets to Taskmandu one by one and reports every ticket's
     * own result. A failure never aborts the batch and never hides what already
     * succeeded, so the client can retry only the failed ones.
     */
    public function push(Request $r): JsonResponse
    {
        // Older clients sent one assignee / due date for the whole batch.
        if (is_array($r->input('tickets')) && ($r->filled('assignee_employee_id') || $r->filled('due_date'))) {
            $r->merge(['tickets' => collect($r->input('tickets'))->map(fn ($t) => is_array($t) ? $t + [
                'assignee_employee_id' => $r->input('assignee_employee_id'),
                'due_date' => $r->input('due_date'),
            ] : $t)->all()]);
        }

        $data = $r->validate([
            // null/absent = standalone tasks; a 24-char id = that project's board.
            'project_id' => ['nullable', 'regex:/^[0-9a-fA-F]{24}$/'],
            'tickets' => 'required|array|min:1|max:30',
            'tickets.*.title' => 'required|string|max:200',
            'tickets.*.description' => 'nullable|string|max:3000',
            'tickets.*.level' => 'nullable|string|max:20',
            'tickets.*.estimate_hours' => 'nullable|numeric|min:0|max:1000',
            'tickets.*.priority' => ['nullable', Rule::in(['Low', 'Medium', 'High', 'Critical'])],
            // Taskmandu requires at least one assignee per task.
            'tickets.*.assignee_employee_id' => 'required|string|max:100',
            'tickets.*.due_date' => 'nullable|date_format:Y-m-d',
        ], [
            'tickets.max' => 'You can push at most 30 tickets at a time.',
            'tickets.*.title.required' => 'Every ticket needs a title.',
            'tickets.*.title.max' => 'A ticket title is over 200 characters.',
            'tickets.*.description.max' => 'A ticket description is over 3,000 characters.',
            'tickets.*.assignee_employee_id.required' => 'Every ticket needs an assignee — Taskmandu requires one per task.',
        ]);

        try {
            $employees = $this->taskmandu->employeeMap();
        } catch (RuntimeException $e) {
            $employees = []; // names are cosmetic here; the push itself will surface a real connection problem
        }

        $results = [];
        foreach ($data['tickets'] as $i => $t) {
            try {
                $results[] = ['index' => $i] + $this->pushTicket($t, $data['project_id'] ?? null, $employees, (string) $r->user()?->name);
            } catch (RuntimeException $e) {
                $results[] = ['index' => $i, 'ok' => false, 'error' => $e->getMessage()];
            }
        }

        $ok = collect($results)->where('ok', true)->count();

        return response()->json([
            'results' => $results,
            'created' => $ok,
            'failed' => count($results) - $ok,
        ]);
    }

    private function pushTicket(array $t, ?string $projectId, array $employees, string $assignedBy): array
    {
        $due = $t['due_date'] ?? now()->addWeek()->toDateString();
        $capacityWarning = null;
        $employeeName = $employees[$t['assignee_employee_id']] ?? $t['assignee_employee_id'];
        $load = collect($this->flags->workload())->firstWhere('name', $employeeName);
        $estimate = isset($t['estimate_hours']) ? (float) $t['estimate_hours'] : 0.0;
        if ($load && $estimate > 0 && (($load['week_hours'] ?? 0) + $estimate) > ($load['capacity'] ?? config('pm.weekly_capacity_hours', 40))) {
            $capacityWarning = sprintf('%s would reach %.1fh against %.1fh weekly capacity.', $employeeName, ($load['week_hours'] ?? 0) + $estimate, $load['capacity'] ?? config('pm.weekly_capacity_hours', 40));
            if (config('pm.automation.block_over_capacity', false)) {
                throw new RuntimeException('Workload guard: '.$capacityWarning);
            }
        }
        $assigneeId = $t['assignee_employee_id'];
        $assignee = $employees[$assigneeId] ?? $assigneeId;
        $priority = $t['priority'] ?? 'Medium';
        $hours = isset($t['estimate_hours']) ? (float) $t['estimate_hours'] : null;
        $level = $t['level'] ?? null;
        $description = trim($t['description'] ?? '');
        $tags = $level ? [$level] : [];
        $frontend = rtrim((string) config('services.taskmandu.frontend_url'), '/');

        // Level/estimate/priority go in as real fields (tags, estimatedHours, priority).
        // The line below is only used if Taskmandu rejects those fields on create.
        $extra = ['priority' => $priority, 'estimatedHours' => $hours, 'tags' => $tags];
        $fallbackLine = 'Level: '.($level ?: '-').' | Est: '.($hours ?? '?').'h | Priority: '.$priority;

        if ($projectId) {
            $res = $this->taskmandu->createProjectTask($projectId, $t['title'], $description, $assigneeId, $assignedBy, $due, $extra, $fallbackLine);
            $task = $res['task'];
            $taskId = $task['_id'] ?? null;
            $externalId = $taskId ? "project:{$projectId}:task:{$taskId}" : null;
            $project = ['id' => $projectId, 'name' => $res['project']['name'] ?? null];
            $url = $frontend ? "{$frontend}/projects/{$projectId}" : null;
        } else {
            $res = $this->taskmandu->createTask($t['title'], $description, $assigneeId, $due, $extra, $fallbackLine);
            $task = $res['data'];
            $taskId = $task['_id'] ?? null;
            $externalId = $taskId ? "task:{$taskId}" : null;
            $project = ['id' => null, 'name' => null];
            $url = ($frontend && $taskId) ? "{$frontend}/tasks/{$taskId}" : null;
        }

        // Save the full card now so Today shows assignee, hours and priority straight
        // away instead of "Unassigned" until the next pm:sync (which will overwrite
        // this with Taskmandu's own copy via the same external_id).
        $attrs = [
            'title' => $t['title'],
            'description' => $task['description'] ?? ($res['fallback'] ? trim($description."\n\n".$fallbackLine) : $description),
            'assignee' => $assignee,
            'status' => $task['status'] ?? 'Assigned',
            'priority' => $task['priority'] ?? ($res['fallback'] ? null : $priority),
            'due_at' => $due,
            'estimated_hours' => $task['estimatedHours'] ?? $hours,
            'tags' => $task['tags'] ?? $tags,
            'subtasks_count' => 0,
            'comments_count' => 0,
            'assigned_by' => $assignedBy ?: null,
            'project_id' => $project['id'],
            'project_name' => $project['name'],
            'task_id' => $taskId,
            'url' => $url,
            'last_activity_at' => now(),
        ];

        $card = $externalId
            ? PmCard::updateOrCreate(['external_id' => $externalId], $attrs)
            : PmCard::create($attrs);

        PmActivity::record('pushed', $card, [
            'task_id' => $taskId,
            'project_id' => $project['id'],
            'external_id' => $externalId,
            'source' => 'brief',
            'actor' => $assignedBy ?: null,
        ]);

        return [
            'ok' => true,
            'task_id' => $taskId,
            'card_id' => $card->id,
            'fields_fallback' => $res['fallback'],
            'capacity_warning' => $capacityWarning,
        ];
    }

    private function employeesWithLoad(): array
    {
        $load = collect($this->flags->workload())->keyBy('name');

        return array_map(
            fn ($e) => $e + [
                'open' => $load->get($e['name'])['open'] ?? 0,
                'hours' => $load->get($e['name'])['hours'] ?? 0,
                'week_hours' => $load->get($e['name'])['week_hours'] ?? 0,
                'capacity' => (float) config('pm.weekly_capacity_hours', 40),
            ],
            $this->taskmandu->listEmployees()
        );
    }

    public function scope(Request $r): JsonResponse
    {
        $data = $r->validate([
            'brief' => 'required|string|max:8000',
            'message' => 'required|string|max:4000',
        ]);

        $out = $this->claude->json(
            'Compare the client message with the signed brief. List each distinct request. verdict is "in_scope", "out_of_scope" or "unclear". reason is one short sentence citing the brief. estimate_hours is a number for out_of_scope items, otherwise null. Shape: {"items":[{"request":"","verdict":"","reason":"","estimate_hours":null}]}',
            "BRIEF:\n{$data['brief']}\n\nCLIENT MESSAGE:\n{$data['message']}"
        );

        return response()->json(['items' => $out['items'] ?? []]);
    }

    public function scopeEmail(Request $r): JsonResponse
    {
        $data = $r->validate([
            'items' => 'required|array|min:1|max:20',
            'items.*.request' => 'required|string|max:300',
            'items.*.estimate_hours' => 'nullable|numeric',
            'client_name' => 'nullable|string|max:80',
            'rate' => 'nullable|string|max:40',
        ]);

        $email = $this->claude->ask(
            'Write a polite change request email to a client. List each item with its hours, then total hours. Show total cost only if a rate is given, otherwise hours only. Say these were outside the original brief and are billed separately. Offer to do the items separately. Say the revised delivery date follows written confirmation, and ask them to confirm by [date]. Under 180 words. No markdown. Subject line first. Sign off as '.$r->user()->name.'.',
            json_encode([
                'client' => $data['client_name'] ?: 'there',
                'rate' => $data['rate'] ?? null,
                'items' => $data['items'],
            ]),
            700
        );

        return response()->json(['email' => trim($email)]);
    }

    public function gitStatus(): JsonResponse
    {
        $status = $this->git->status();

        $prs = [];
        if ($this->github->configured() && ($slug = $this->git->remoteSlug())) {
            $prs = $this->github->openPullRequests($slug);
        }

        return response()->json(['git' => $status, 'pull_requests' => $prs]);
    }

    public function gitFetch(): JsonResponse
    {
        return $this->gitAction(fn () => $this->git->fetch());
    }

    public function gitPull(): JsonResponse
    {
        return $this->gitAction(fn () => $this->git->pull());
    }

    public function gitPush(): JsonResponse
    {
        return $this->gitAction(fn () => $this->git->push());
    }

    public function gitCheckout(Request $r): JsonResponse
    {
        $data = $r->validate(['branch' => 'required|string|max:200']);

        return $this->gitAction(fn () => $this->git->checkout($data['branch']));
    }

    private function gitAction(callable $action): JsonResponse
    {
        try {
            return response()->json(['git' => $action()]);
        } catch (RuntimeException $e) {
            return response()->json(['error' => $e->getMessage()], 422);
        }
    }
}
