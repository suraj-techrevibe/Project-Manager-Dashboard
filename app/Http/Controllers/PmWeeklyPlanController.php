<?php

namespace App\Http\Controllers;

use App\Models\PmCard;
use App\Models\PmWeeklyPlan;
use App\Services\Pm\TaskmanduSync;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Support\Str;
use Throwable;

class PmWeeklyPlanController extends Controller
{
    public function index(): JsonResponse
    {
        $plans = PmWeeklyPlan::query()
            ->orderByDesc('week_start')
            ->limit(24)
            ->get()
            ->map(fn (PmWeeklyPlan $plan) => $this->present($plan, false));

        return response()->json(['plans' => $plans]);
    }

    public function show(PmWeeklyPlan $plan): JsonResponse
    {
        return response()->json(['plan' => $this->present($plan)]);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $this->validated($request);
        $tickets = $this->normaliseTickets($data['tickets']);

        try {
            $plan = PmWeeklyPlan::create([
                'title' => $data['title'] ?: 'Weekly assignments · '.$data['week_start'],
                'week_start' => $data['week_start'],
                'week_end' => $data['week_end'],
                'team_timezone' => 'Asia/Kathmandu',
                'status' => 'draft',
                'notes' => $data['notes'] ?? null,
                'tickets' => $tickets,
                'created_by' => $request->user()?->name,
                'created_by_id' => $request->user()?->id,
            ]);
        } catch (QueryException $e) {
            if (str_contains(strtolower($e->getMessage()), 'unique') || str_contains(strtolower($e->getMessage()), 'duplicate')) {
                return response()->json(['message' => 'A weekly plan already exists for this Sunday. Open that plan instead of creating a duplicate.'], 409);
            }
            throw $e;
        }

        return response()->json(['plan' => $this->present($plan)], 201);
    }

    public function update(Request $request, PmWeeklyPlan $plan): JsonResponse
    {
        abort_unless(in_array($plan->status, ['draft', 'changes_requested'], true), 422, 'This plan can only be edited while it is a draft or changes have been requested.');

        $data = $this->validated($request);
        $weekConflict = PmWeeklyPlan::query()
            ->where('week_start', $data['week_start'])
            ->whereKeyNot($plan->id)
            ->exists();
        abort_if($weekConflict, 409, 'A weekly plan already exists for this Sunday. Open that plan instead of creating a duplicate.');

        $plan->update([
            'title' => $data['title'] ?: 'Weekly assignments · '.$data['week_start'],
            'week_start' => $data['week_start'],
            'week_end' => $data['week_end'],
            'notes' => $data['notes'] ?? null,
            'tickets' => $this->normaliseTickets($data['tickets']),
            'status' => 'draft',
            'submitted_at' => null,
            'submitted_by' => null,
        ]);

        return response()->json(['plan' => $this->present($plan->fresh())]);
    }

    public function submit(Request $request, PmWeeklyPlan $plan): JsonResponse
    {
        abort_unless($plan->status === 'draft' || $plan->status === 'changes_requested', 422, 'Only a draft plan can be submitted for approval.');
        $tickets = $plan->tickets ?? [];
        abort_if(count($tickets) === 0, 422, 'Add at least one assignment before submitting the plan.');
        $this->assertNoDuplicateTitles($tickets);

        $plan->update([
            'status' => 'submitted_for_approval',
            'submitted_by' => $request->user()?->name,
            'submitted_at' => now(),
        ]);

        return response()->json(['plan' => $this->present($plan->fresh())]);
    }

    public function requestChanges(Request $request, PmWeeklyPlan $plan): JsonResponse
    {
        abort_unless($plan->status === 'submitted_for_approval', 422, 'Only a submitted plan can be returned for changes.');
        $data = $request->validate(['approval_notes' => 'required|string|max:2000']);
        $plan->update([
            'status' => 'changes_requested',
            'approval_notes' => $data['approval_notes'],
        ]);

        return response()->json(['plan' => $this->present($plan->fresh())]);
    }

    public function approveAndRelease(
        Request $request,
        PmWeeklyPlan $plan,
        PmMeetingTicketController $publisher,
        TaskmanduSync $sync,
    ): JsonResponse {
        $plan = DB::transaction(function () use ($request, $plan) {
            $locked = PmWeeklyPlan::query()->lockForUpdate()->findOrFail($plan->id);
            abort_unless($locked->status === 'submitted_for_approval', 422, 'Submit the weekly plan for approval before releasing it.');
            abort_if($locked->approved_at !== null || $locked->status === 'releasing', 409, 'This weekly plan has already been approved or is being released.');

            $locked->update([
                'status' => 'approved',
                'approved_by' => $request->user()?->name,
                'approved_by_id' => $request->user()?->id,
                'approved_at' => now(),
                'approval_notes' => $request->input('approval_notes'),
                'release_started_at' => now(),
            ]);

            return $locked->fresh();
        });

        $readyCount = collect($plan->tickets ?? [])->where('push_state', 'ready')->count();
        if ($readyCount === 0) {
            return response()->json([
                'plan' => $this->present($plan),
                'release' => ['released' => 0, 'queued' => collect($plan->tickets ?? [])->where('push_state', 'queued')->count(), 'failed' => 0],
            ]);
        }

        return $this->releaseTickets($request, $plan, $publisher, $sync, ['ready']);
    }

    public function releaseQueued(
        Request $request,
        PmWeeklyPlan $plan,
        PmMeetingTicketController $publisher,
        TaskmanduSync $sync,
    ): JsonResponse {
        abort_unless(in_array($plan->status, ['approved', 'partially_released'], true), 422, 'Approve the weekly plan before releasing queued assignments.');

        return $this->releaseTickets($request, $plan, $publisher, $sync, ['queued']);
    }

    public function retryFailed(
        Request $request,
        PmWeeklyPlan $plan,
        PmMeetingTicketController $publisher,
        TaskmanduSync $sync,
    ): JsonResponse {
        abort_unless(in_array($plan->status, ['approved', 'partially_released'], true), 422, 'Approve the weekly plan before retrying failed assignments.');

        return $this->releaseTickets($request, $plan, $publisher, $sync, ['failed']);
    }

    public function destroy(PmWeeklyPlan $plan): JsonResponse
    {
        abort_unless($plan->status === 'draft' || $plan->status === 'changes_requested', 422, 'Only an unreleased draft can be deleted.');
        $plan->delete();

        return response()->json(['deleted' => true]);
    }

    private function validated(Request $request): array
    {
        $data = $request->validate([
            'title' => 'nullable|string|max:200',
            'week_start' => 'required|date_format:Y-m-d',
            'week_end' => 'required|date_format:Y-m-d|after_or_equal:week_start',
            'notes' => 'nullable|string|max:5000',
            'tickets' => 'required|array|min:1|max:30',
            'tickets.*.uid' => 'nullable|string|max:60',
            'tickets.*.title' => 'required|string|max:200',
            'tickets.*.description' => 'nullable|string|max:3000',
            'tickets.*.project_id' => ['nullable', 'regex:/^[0-9a-fA-F]{24}$/'],
            'tickets.*.project_name' => 'nullable|string|max:200',
            'tickets.*.project_confirmed' => 'nullable|boolean',
            'tickets.*.assignee_employee_id' => 'required|string|max:100',
            'tickets.*.priority' => ['required', Rule::in(['Low', 'Medium', 'High', 'Critical'])],
            'tickets.*.estimate_hours' => 'nullable|numeric|min:0|max:1000',
            'tickets.*.due_date' => 'required|date_format:Y-m-d',
            'tickets.*.release_now' => 'required|boolean',
        ]);

        $weekStart = Carbon::createFromFormat('Y-m-d', $data['week_start'], 'Asia/Kathmandu')->startOfDay();
        $weekEnd = Carbon::createFromFormat('Y-m-d', $data['week_end'], 'Asia/Kathmandu')->startOfDay();
        abort_unless(
            $weekStart->dayOfWeek === Carbon::SUNDAY
                && $weekEnd->dayOfWeek === Carbon::FRIDAY
                && $weekStart->copy()->addDays(5)->isSameDay($weekEnd),
            422,
            'A weekly plan must run Sunday to Friday in Nepal time.',
        );

        foreach ($data['tickets'] as $index => $ticket) {
            abort_unless(
                $ticket['due_date'] >= $data['week_start'] && $ticket['due_date'] <= $data['week_end'],
                422,
                'Assignment #'.($index + 1).' due date must fall within the selected Sunday–Friday week.',
            );
            if (! empty($ticket['project_id']) && empty($ticket['project_confirmed'])) {
                abort(422, 'Confirm the Taskmandu project for assignment #'.($index + 1).'.');
            }
        }

        $titles = [];
        foreach ($data['tickets'] as $index => $ticket) {
            $key = mb_strtolower(preg_replace('/\s+/', ' ', trim($ticket['title'])));
            $scope = (string) ($ticket['project_id'] ?? 'standalone');
            $duplicateKey = $scope.'|'.$key;
            abort_if(isset($titles[$duplicateKey]), 422, 'Duplicate assignment title in this batch: '.$ticket['title']);
            $titles[$duplicateKey] = true;
        }

        return $data;
    }

    private function normaliseTickets(array $tickets): array
    {
        return collect($tickets)->values()->map(fn ($ticket) => [
            'uid' => (string) ($ticket['uid'] ?? Str::uuid()),
            'title' => trim((string) $ticket['title']),
            'description' => trim((string) ($ticket['description'] ?? '')),
            'project_id' => $ticket['project_id'] ?? null,
            'project_name' => $ticket['project_name'] ?? null,
            'project_confirmed' => (bool) ($ticket['project_confirmed'] ?? false),
            'assignee_employee_id' => (string) $ticket['assignee_employee_id'],
            'priority' => $ticket['priority'],
            'estimate_hours' => isset($ticket['estimate_hours']) ? (float) $ticket['estimate_hours'] : null,
            'due_date' => $ticket['due_date'],
            'release_now' => (bool) $ticket['release_now'],
            'push_state' => ! empty($ticket['release_now']) ? 'ready' : 'queued',
            'task_id' => null,
            'card_id' => null,
            'task_url' => null,
            'push_error' => null,
            'released_at' => null,
        ])->all();
    }

    private function releaseTickets(
        Request $request,
        PmWeeklyPlan $plan,
        PmMeetingTicketController $publisher,
        TaskmanduSync $sync,
        array $eligibleStates,
    ): JsonResponse {
        $plan = DB::transaction(function () use ($plan, $eligibleStates) {
            $locked = PmWeeklyPlan::query()->lockForUpdate()->findOrFail($plan->id);
            abort_unless(in_array($locked->status, ['approved', 'partially_released'], true), 409, 'The plan is not ready for ticket release.');
            $tickets = $locked->tickets ?? [];
            $selected = collect($tickets)->whereIn('push_state', $eligibleStates);
            abort_if($selected->isEmpty(), 422, 'There are no assignments in this release group.');

            foreach ($tickets as $index => $ticket) {
                if (in_array($ticket['push_state'] ?? '', $eligibleStates, true)) {
                    $tickets[$index]['push_state'] = 'processing';
                    $tickets[$index]['push_error'] = null;
                }
            }

            $locked->update(['status' => 'releasing', 'tickets' => $tickets, 'release_started_at' => now()]);

            return $locked->fresh();
        });

        $tickets = $plan->tickets ?? [];
        $selectedIndexes = [];
        $payload = [];
        foreach ($tickets as $index => $ticket) {
            if (($ticket['push_state'] ?? '') !== 'processing') {
                continue;
            }

            $selectedIndexes[] = $index;
            $payload[] = [
                'title' => $ticket['title'],
                'description' => $ticket['description'] ?? '',
                'level' => null,
                'estimate_hours' => $ticket['estimate_hours'] ?? null,
                'priority' => $ticket['priority'],
                'assignee_employee_id' => $ticket['assignee_employee_id'],
                'due_date' => $ticket['due_date'],
                'project_id' => $ticket['project_id'] ?? null,
                'project_name' => $ticket['project_name'] ?? null,
                'project_confirmed' => (bool) ($ticket['project_confirmed'] ?? false),
                'subtasks' => [],
            ];
        }

        try {
            // Refresh the local mirror before checking/publishing, so duplicate detection uses current Taskmandu tasks.
            $sync->run();
            $publication = $payload === []
                ? ['results' => []]
                : $publisher->publishTickets($payload, (string) ($request->user()?->name ?? 'PM'), false);
            foreach ($publication['results'] as $result) {
                $index = $selectedIndexes[$result['index']];
                $tickets[$index]['push_state'] = ! empty($result['ok']) ? 'released' : 'failed';
                $tickets[$index]['task_id'] = $result['task_id'] ?? null;
                $tickets[$index]['card_id'] = $result['card_id'] ?? null;
                $tickets[$index]['task_url'] = $this->taskUrl($tickets[$index]);
                $tickets[$index]['push_error'] = $result['error'] ?? null;
                $tickets[$index]['released_at'] = ! empty($result['ok']) ? now()->toIso8601String() : null;
            }
        } catch (Throwable $e) {
            foreach ($tickets as $index => $ticket) {
                if (($ticket['push_state'] ?? '') === 'processing') {
                    $tickets[$index]['push_state'] = 'failed';
                    $tickets[$index]['push_error'] = 'Release interrupted: '.$e->getMessage();
                }
            }
        }

        $hasFailure = collect($tickets)->contains(fn ($ticket) => ($ticket['push_state'] ?? '') === 'failed');
        $hasReady = collect($tickets)->contains(fn ($ticket) => in_array($ticket['push_state'] ?? '', ['ready', 'processing'], true));
        $hasQueue = collect($tickets)->contains(fn ($ticket) => ($ticket['push_state'] ?? '') === 'queued');
        $status = $hasFailure ? 'partially_released' : (($hasReady || $hasQueue) ? 'approved' : 'released');

        $plan->update([
            'tickets' => $tickets,
            'status' => $status,
            'released_at' => $status === 'released' ? now() : null,
        ]);

        return response()->json([
            'plan' => $this->present($plan->fresh()),
            'release' => [
                'released' => collect($tickets)->where('push_state', 'released')->count(),
                'queued' => collect($tickets)->where('push_state', 'queued')->count(),
                'failed' => collect($tickets)->where('push_state', 'failed')->count(),
            ],
        ]);
    }

    private function assertNoDuplicateTitles(array $tickets): void
    {
        $seen = [];
        foreach ($tickets as $ticket) {
            $key = (string) ($ticket['project_id'] ?? 'standalone').'|'.mb_strtolower(preg_replace('/\s+/', ' ', trim((string) ($ticket['title'] ?? ''))));
            abort_if(isset($seen[$key]), 422, 'The plan contains duplicate task titles in the same project.');
            $seen[$key] = true;
        }
    }

    private function taskUrl(array $ticket): ?string
    {
        $base = rtrim((string) config('services.taskmandu.frontend_url', ''), '/');
        $id = $ticket['task_id'] ?? null;
        if (! $id || ! $base) return null;

        return ! empty($ticket['project_id'])
            ? $base.'/projects/'.$ticket['project_id']
            : $base.'/tasks/'.$id;
    }

    private function present(PmWeeklyPlan $plan, bool $includeTickets = true): array
    {
        $tickets = $plan->tickets ?? [];
        return [
            'id' => $plan->id,
            'title' => $plan->title,
            'week_start' => $plan->week_start?->toDateString(),
            'week_end' => $plan->week_end?->toDateString(),
            'team_timezone' => $plan->team_timezone,
            'status' => $plan->status,
            'notes' => $plan->notes,
            'tickets' => $includeTickets ? $tickets : [],
            'counts' => [
                'total' => count($tickets),
                'released' => collect($tickets)->where('push_state', 'released')->count(),
                'queued' => collect($tickets)->where('push_state', 'queued')->count(),
                'failed' => collect($tickets)->where('push_state', 'failed')->count(),
            ],
            'created_by' => $plan->created_by,
            'submitted_by' => $plan->submitted_by,
            'submitted_at' => $plan->submitted_at?->toIso8601String(),
            'approved_by' => $plan->approved_by,
            'approved_at' => $plan->approved_at?->toIso8601String(),
            'approval_notes' => $plan->approval_notes,
            'released_at' => $plan->released_at?->toIso8601String(),
            'updated_at' => $plan->updated_at?->toIso8601String(),
        ];
    }
}
