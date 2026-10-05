<?php

namespace App\Http\Controllers;

use App\Models\PmActivity;
use App\Models\PmCard;
use App\Models\PmDraft;
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

    /** Saved Brief drafts are local PM CRUD records until tickets are pushed. */
    public function briefDrafts(): JsonResponse
    {
        $drafts = PmDraft::query()->latest('updated_at')->limit(50)
            ->get(['id','title','project_id','status','created_by','created_at','updated_at'])
            ->map(fn (PmDraft $draft) => [
                'id' => $draft->id,
                'title' => $draft->title,
                'project_id' => $draft->project_id,
                'status' => $draft->status,
                'created_by' => $draft->created_by,
                'created_at' => $draft->created_at?->toIso8601String(),
                'updated_at' => $draft->updated_at?->toIso8601String(),
            ])->values();

        return response()->json(['drafts' => $drafts]);
    }

    public function briefDraftShow(PmDraft $draft): JsonResponse
    {
        return response()->json(['draft' => $draft]);
    }

    public function briefDraftStore(Request $r): JsonResponse
    {
        $data = $this->validateBriefDraft($r);
        $draft = PmDraft::create($data + [
            'status' => 'draft',
            'created_by' => (string) ($r->user()?->name ?? $r->user()?->id ?? ''),
        ]);

        return response()->json(['draft' => $draft], 201);
    }

    public function briefDraftUpdate(Request $r, PmDraft $draft): JsonResponse
    {
        $data = $this->validateBriefDraft($r);
        $draft->update($data + [
            'status' => $draft->status === 'pushed' ? 'partial' : 'draft',
        ]);

        return response()->json(['draft' => $draft->fresh()]);
    }

    public function briefDraftDestroy(PmDraft $draft): JsonResponse
    {
        $draft->delete();

        return response()->json(['deleted' => true]);
    }

    private function validateBriefDraft(Request $r): array
    {
        return $r->validate([
            'title' => 'required|string|max:200',
            'brief' => 'nullable|string|max:8000',
            'project_id' => ['nullable', 'regex:/^[0-9a-fA-F]{24}$/'],
            'tickets' => 'required|array|max:30',
            'tickets.*.uid' => 'required|string|max:100',
            'tickets.*.projectId' => ['required', 'regex:/^[0-9a-fA-F]{24}$/'],
            'tickets.*.projectTitle' => 'required|string|max:200',
            'tickets.*.title' => 'nullable|string|max:200',
            'tickets.*.description' => 'nullable|string|max:3000',
            'tickets.*.level' => 'nullable|string|max:20',
            'tickets.*.estimate_hours' => 'nullable|numeric|min:0|max:1000',
            'tickets.*.priority' => ['nullable', Rule::in(['Low','Medium','High','Critical'])],
            'tickets.*.assigneeId' => 'nullable|string|max:100',
            'tickets.*.dueDate' => 'nullable|date_format:Y-m-d',
            'tickets.*.state' => ['required', Rule::in(['draft','pushed','failed'])],
            'tickets.*.error' => 'nullable|string|max:1000',
        ]);
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
}    public function push(Request $r): JsonResponse
    {
        $data = $r->validate([
            'tickets' => 'required|array|min:1|max:30',
            'tickets.*.project_id' => ['required', 'regex:/^[0-9a-fA-F]{24}$/'],
            'tickets.*.title' => 'required|string|max:200',
            'tickets.*.description' => 'nullable|string|max:3000',
            'tickets.*.level' => 'nullable|string|max:20',
            'tickets.*.estimate_hours' => 'nullable|numeric|min:0|max:1000',
            'tickets.*.priority' => ['nullable', Rule::in(['Low', 'Medium', 'High', 'Critical'])],
            'tickets.*.assignee_employee_id' => 'required|string|max:100',
            'tickets.*.due_date' => 'nullable|date_format:Y-m-d',
        ], [
            'tickets.*.project_id.required' => 'Every ticket needs a project.',
            'tickets.*.title.required' => 'Every ticket needs a title.',
            'tickets.*.assignee_employee_id.required' => 'Every ticket needs an assignee — Taskmandu requires one per task.',
        ]);

        try {
            $employees = $this->taskmandu->employeeMap();
        } catch (RuntimeException $e) {
            $employees = [];
        }

        $results = [];
        foreach ($data['tickets'] as $i => $t) {
            try {
                $results[] = ['index' => $i] + $this->pushTicket(
                    $t,
                    $t['project_id'],
                    $employees,
                    (string) $r->user()?->name
                );
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


