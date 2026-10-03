<?php

namespace App\Http\Controllers;

use App\Models\PmCard;
use App\Services\Pm\ClaudeClient;
use App\Services\Pm\FlagService;
use App\Services\Pm\GitHubService;
use App\Services\Pm\GitService;
use App\Services\Pm\TaskmanduSync;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
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
    ) {}

    public function index(): Response
    {
        $flags = $this->flags->all();

        return Inertia::render('Pm/Index', [
            'flags' => $flags,
            'metrics' => $this->flags->metrics($flags),
        ]);
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

        return response()->json(['message' => trim($message)]);
    }

    public function snooze(PmCard $card): RedirectResponse
    {
        $card->update(['snoozed_until' => now()->addDays(3)->toDateString()]);

        return back();
    }

    public function verify(PmCard $card): RedirectResponse
    {
        $card->update(['verified' => true]);

        return back();
    }

    public function brief(Request $r): JsonResponse
    {
        $data = $r->validate(['brief' => 'required|string|max:8000']);

        $out = $this->claude->json(
            'You are a PM at a small dev agency (Laravel, Inertia, React). Split the client brief into small tickets. level is "senior dev" for architecture, integrations, payments or anything risky, and "intern" for UI, copy and simple CRUD. estimate_hours is a number. Also list questions that need answers before work starts. Shape: {"tickets":[{"title":"","description":"","level":"senior dev","estimate_hours":2}],"questions":[""]}',
            $data['brief']
        );

        return response()->json([
            'tickets' => $out['tickets'] ?? [],
            'questions' => $out['questions'] ?? [],
        ]);
    }

    public function employees(): JsonResponse
    {
        return response()->json(['employees' => $this->taskmandu->listEmployees()]);
    }

    public function push(Request $r): JsonResponse
    {
        $data = $r->validate([
            'tickets' => 'required|array|min:1|max:30',
            'tickets.*.title' => 'required|string|max:200',
            'tickets.*.description' => 'nullable|string|max:3000',
            'tickets.*.level' => 'nullable|string|max:20',
            'tickets.*.estimate_hours' => 'nullable|numeric',
            // Taskmandu requires at least one assignee per task — the frontend
            // gets this from the employee picker before allowing push.
            'assignee_employee_id' => 'required|string|max:100',
            'due_date' => 'nullable|date_format:Y-m-d',
        ]);

        $dueDate = $data['due_date'] ?? now()->addWeek()->toDateString();

        foreach ($data['tickets'] as $t) {
            $desc = trim(($t['description'] ?? '')."\n\nLevel: ".($t['level'] ?? '-').' | Est: '.($t['estimate_hours'] ?? '?').'h');

            try {
                $remote = $this->taskmandu->createTask($t['title'], $desc, $data['assignee_employee_id'], $dueDate);
            } catch (RuntimeException $e) {
                return response()->json(['error' => $e->getMessage()], 422);
            }

            $task = $remote['data'] ?? [];

            PmCard::create([
                'external_id' => isset($task['_id']) ? 'task:'.$task['_id'] : null,
                'title' => $t['title'],
                'description' => $desc,
                'status' => $task['status'] ?? 'Assigned',
                'due_at' => $dueDate,
                'url' => config('services.taskmandu.frontend_url')
                    ? rtrim(config('services.taskmandu.frontend_url'), '/')."/tasks/{$task['_id']}"
                    : null,
                'last_activity_at' => now(),
            ]);
        }

        return response()->json(['created' => count($data['tickets'])]);
    }

    public function clientUpdate(Request $r): JsonResponse
    {
        $data = $r->validate([
            'tone' => 'required|in:formal,casual',
            'client_name' => 'nullable|string|max:80',
        ]);

        $email = $this->claude->ask(
            "Write a weekly client status email for a software project. Tone: {$data['tone']}. Plain paragraphs: done, in progress, delayed (give a new estimate only if the data supports one), and what is needed from the client only if a card is blocked. Use only the board data. Do not invent facts, dates or names. No markdown. Sign off as ".$r->user()->name.".\n\nBoard:\n".$this->flags->snapshot(),
            'Client name: '.($data['client_name'] ?: 'there')
        );

        return response()->json(['email' => trim($email)]);
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
