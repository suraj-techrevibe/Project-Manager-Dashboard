<?php

namespace App\Http\Controllers;

use App\Models\PmActivity;
use App\Models\PmCard;
use App\Models\PmSubtask;
use App\Services\Pm\ClaudeClient;
use App\Services\Pm\DigestService;
use App\Services\Pm\FlagService;
use App\Services\Pm\GitHubService;
use App\Services\Pm\GitService;
use App\Services\Pm\TaskmanduSync;
use Illuminate\Http\JsonResponse;
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

    /** Pages that used to be tabs inside this one page, now at /pm/{page}. */
    private const PAGES = ['projects', 'minutes', 'brief', 'reports', 'scope', 'git'];

    public function index(Request $request): Response|RedirectResponse
    {
        // Old bookmarks like /pm?tab=projects&project=<id> keep working.
        $tab = $request->query('tab');
        if (is_string($tab) && in_array($tab, self::PAGES, true)) {
            $qs = http_build_query($request->except('tab'));

            return redirect('/pm/'.$tab.($qs !== '' ? '?'.$qs : ''));
        }

        return Inertia::render('Pm/App', ['page' => 'today'] + $this->todayPayload());
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

    /** Tickets pushed from the Brief tab that can still be undone (newest first). */
    public function recentPushes(): JsonResponse
    {
        $items = PmActivity::query()->where('type', 'pushed')->latest('occurred_at')->limit(30)->get()
            ->filter(fn ($a) => empty($a->meta['undone_at']) && ! empty($a->meta['task_id']))
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
        if (! empty($activity->meta['undone_at'])) {
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

    /** Records that the PM actually sent a nudge (e.g. copied the template message). */
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
            'tasks' => $this->flags->tasks(),
            'metrics' => $this->flags->metrics($flags),
            'workload' => $workload,
            'subtasks' => $this->flags->subtasks(),
            'staff' => $this->staff(),
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

    /** Assigns a sub-task right from Today (PATCHes Taskmandu, then updates the local mirror). */
    public function assignSubtask(Request $r, PmSubtask $subtask): JsonResponse
    {
        $data = $r->validate(['employee_id' => 'required|string|max:100']);

        try {
            $name = $this->taskmandu->assignSubTask($subtask, $data['employee_id']);
        } catch (RuntimeException $e) {
            report($e);

            return response()->json(['error' => "Couldn't assign that sub-task in Taskmandu: ".$e->getMessage()], 422);
        }

        $subtask->update(['assignee' => $name]);

        return response()->json(['id' => $subtask->id, 'assignee' => $name]);
    }

    public function snoozeSubtask(PmSubtask $subtask): JsonResponse
    {
        $subtask->update(['snoozed_until' => now()->addDays(3)->toDateString()]);

        return response()->json(['id' => $subtask->id]);
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

        // The Taskmandu id is what lets "Undo" delete exactly this ticket later.
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
