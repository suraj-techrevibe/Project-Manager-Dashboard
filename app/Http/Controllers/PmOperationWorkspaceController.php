<?php

namespace App\Http\Controllers;

use App\Models\PmOperationGoal;
use App\Models\PmOperationPlan;
use App\Models\PmOperationPlanRevision;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class PmOperationWorkspaceController extends Controller
{
    private const GOAL_TYPES = ['business_goal', 'event', 'launch', 'marketing', 'deadline', 'decision', 'opportunity', 'other'];
    private const GOAL_STATUSES = ['active', 'completed', 'cancelled'];
    private const PRIORITIES = ['auto', 'urgent', 'high', 'medium', 'low'];
    private const PLAN_STATUSES = ['draft', 'submitted_for_approval', 'changes_requested', 'approved', 'rejected', 'in_progress', 'completed', 'archived'];

    public function goals(Request $request): JsonResponse
    {
        $filters = $request->validate([
            'q' => 'nullable|string|max:200',
            'business_id' => 'nullable|integer',
            'type' => ['nullable', Rule::in(self::GOAL_TYPES)],
            'priority' => ['nullable', Rule::in(self::PRIORITIES)],
            'status' => ['nullable', Rule::in(self::GOAL_STATUSES)],
            'from' => 'nullable|date_format:Y-m-d',
            'to' => 'nullable|date_format:Y-m-d',
            'sort' => ['nullable', Rule::in(['deadline', 'priority', 'created'])],
        ]);

        $query = PmOperationGoal::query()->with('business:id,name,slug');
        if (!empty($filters['q'])) {
            $term = trim($filters['q']);
            $query->where(fn ($q) => $q->where('title', 'like', "%{$term}%")->orWhere('description', 'like', "%{$term}%")->orWhere('source_notes', 'like', "%{$term}%"));
        }
        foreach (['business_id' => 'business_id', 'type' => 'goal_type', 'status' => 'status'] as $filter => $column) {
            if (!empty($filters[$filter])) $query->where($column, $filters[$filter]);
        }
        if (!empty($filters['from'])) $query->whereDate('target_date', '>=', $filters['from']);
        if (!empty($filters['to'])) $query->whereDate('target_date', '<=', $filters['to']);
        if (!empty($filters['sort']) && $filters['sort'] === 'created') $query->latest();
        else $query->orderByRaw('CASE WHEN target_date IS NULL THEN 1 ELSE 0 END')->orderBy('target_date');

        $goals = $query->get()->map(fn (PmOperationGoal $goal) => $this->presentGoal($goal));
        if (!empty($filters['priority'])) {
            $goals = $goals->filter(fn ($goal) => $goal['effective_priority'] === $filters['priority'] || $goal['priority'] === $filters['priority'])->values();
        }
        if (($filters['sort'] ?? null) === 'priority') {
            $rank = ['urgent' => 5, 'high' => 4, 'medium' => 3, 'normal' => 2, 'low' => 1, 'unscheduled' => 0];
            $goals = $goals->sortByDesc(fn ($goal) => $rank[$goal['effective_priority']] ?? 0)->values();
        }

        return response()->json(['goals' => $goals]);
    }

    public function storeGoal(Request $request): JsonResponse
    {
        $data = $this->validateGoal($request);
        $data['created_by'] = $request->user()?->id;
        $data['updated_by'] = $request->user()?->id;
        $goal = PmOperationGoal::create($data)->load('business:id,name,slug');

        return response()->json(['goal' => $this->presentGoal($goal)], 201);
    }

    public function updateGoal(Request $request, PmOperationGoal $goal): JsonResponse
    {
        $data = $this->validateGoal($request, true);
        $data['updated_by'] = $request->user()?->id;
        $goal->fill($data)->save();

        return response()->json(['goal' => $this->presentGoal($goal->fresh()->load('business:id,name,slug'))]);
    }

    public function deleteGoal(PmOperationGoal $goal): JsonResponse
    {
        abort_if($goal->plans()->exists(), 422, 'This goal is linked to a plan. Unlink or delete the plan first.');
        $goal->delete();

        return response()->json(['deleted' => true]);
    }

    public function plans(Request $request): JsonResponse
    {
        $filters = $request->validate([
            'q' => 'nullable|string|max:200',
            'business_id' => 'nullable|integer',
            'status' => ['nullable', Rule::in(self::PLAN_STATUSES)],
            'priority' => ['nullable', Rule::in(self::PRIORITIES)],
            'from' => 'nullable|date_format:Y-m-d',
            'to' => 'nullable|date_format:Y-m-d',
        ]);
        $query = PmOperationPlan::query()->with(['business:id,name,slug', 'goal:id,title,target_date']);
        if (!empty($filters['q'])) {
            $term = trim($filters['q']);
            $query->where(fn ($q) => $q->where('title', 'like', "%{$term}%")->orWhere('objective', 'like', "%{$term}%")->orWhere('background', 'like', "%{$term}%"));
        }
        if (!empty($filters['business_id'])) $query->where('business_id', $filters['business_id']);
        if (!empty($filters['status'])) $query->where('status', $filters['status']);
        if (!empty($filters['from'])) $query->whereDate('updated_at', '>=', $filters['from']);
        if (!empty($filters['to'])) $query->whereDate('updated_at', '<=', $filters['to']);
        $plans = $query->latest('updated_at')->limit(300)->get()->map(fn (PmOperationPlan $plan) => $this->presentPlan($plan));
        if (!empty($filters['priority'])) $plans = $plans->filter(fn ($plan) => $plan['priority'] === $filters['priority'] || $plan['effective_priority'] === $filters['priority'])->values();

        return response()->json(['plans' => $plans]);
    }

    public function storePlan(Request $request): JsonResponse
    {
        $data = $this->validatePlan($request);
        $data['created_by'] = $request->user()?->id;
        $data['updated_by'] = $request->user()?->id;
        $plan = PmOperationPlan::create($data)->load(['business:id,name,slug', 'goal:id,title,target_date', 'revisions']);

        return response()->json(['plan' => $this->presentPlan($plan)], 201);
    }

    public function updatePlan(Request $request, PmOperationPlan $plan): JsonResponse
    {
        abort_if(in_array($plan->status, ['archived', 'rejected'], true), 422, 'Archived or rejected plans cannot be edited. Duplicate the plan to continue.');
        $data = $this->validatePlan($request, true);

        DB::transaction(function () use ($request, $plan, $data) {
            if ($plan->submitted_at && in_array($plan->status, ['submitted_for_approval', 'changes_requested', 'approved', 'in_progress'], true)) {
                $this->recordRevision($plan, 'edited_after_submission', 'Saved edits to a previously submitted plan', $request->user()?->id);
            }
            $data['updated_by'] = $request->user()?->id;
            $plan->fill($data)->save();
        });

        return response()->json(['plan' => $this->presentPlan($plan->fresh()->load(['business:id,name,slug', 'goal:id,title,target_date', 'revisions']))]);
    }

    public function transitionPlan(Request $request, PmOperationPlan $plan): JsonResponse
    {
        $data = $request->validate([
            'status' => ['required', Rule::in(self::PLAN_STATUSES)],
            'boss_feedback' => 'nullable|string|max:10000',
            'approval_notes' => 'nullable|string|max:10000',
            'change_reason' => 'nullable|string|max:2000',
        ]);
        $next = $data['status'];
        $allowed = [
            'draft' => ['submitted_for_approval', 'archived'],
            'submitted_for_approval' => ['changes_requested', 'approved', 'rejected', 'draft'],
            'changes_requested' => ['submitted_for_approval', 'archived'],
            'approved' => ['in_progress', 'archived'],
            'rejected' => ['archived'],
            'in_progress' => ['completed', 'archived'],
            'completed' => ['archived'],
            'archived' => [],
        ];
        abort_unless(in_array($next, $allowed[$plan->status] ?? [], true), 422, 'That plan status transition is not allowed.');

        DB::transaction(function () use ($request, $plan, $data, $next) {
            if ($next === 'submitted_for_approval') {
                $plan->status = $next;
                $plan->submitted_at = now();
                $this->recordRevision($plan, 'submitted', $data['change_reason'] ?? 'Submitted for boss review', $request->user()?->id);
            }
            if (in_array($next, ['approved', 'rejected', 'changes_requested'], true)) {
                $plan->reviewed_at = now();
            }
            if (array_key_exists('boss_feedback', $data)) $plan->boss_comments = $data['boss_feedback'];
            if (array_key_exists('approval_notes', $data)) $plan->approval_notes = $data['approval_notes'];
            if ($next === 'archived') $plan->archived_at = now();
            if ($next !== 'archived') $plan->archived_at = null;
            $plan->status = $next;
            $plan->updated_by = $request->user()?->id;
            $plan->save();
        });

        return response()->json(['plan' => $this->presentPlan($plan->fresh()->load(['business:id,name,slug', 'goal:id,title,target_date', 'revisions']))]);
    }

    public function duplicatePlan(Request $request, PmOperationPlan $plan): JsonResponse
    {
        $copy = $plan->replicate(['status', 'submitted_at', 'reviewed_at', 'archived_at']);
        $copy->title = $plan->title.' (Copy)';
        $copy->status = 'draft';
        $copy->submitted_at = null;
        $copy->reviewed_at = null;
        $copy->archived_at = null;
        $copy->created_by = $request->user()?->id;
        $copy->updated_by = $request->user()?->id;
        $copy->save();

        return response()->json(['plan' => $this->presentPlan($copy->fresh()->load(['business:id,name,slug', 'goal:id,title,target_date', 'revisions']))], 201);
    }

    public function deletePlan(PmOperationPlan $plan): JsonResponse
    {
        $plan->delete();
        return response()->json(['deleted' => true]);
    }

    private function validateGoal(Request $request, bool $partial = false): array
    {
        $rules = [
            'business_id' => 'nullable|integer|exists:pm_businesses,id',
            'title' => ($partial ? 'sometimes|' : '').'required|string|max:200',
            'description' => 'sometimes|nullable|string|max:12000',
            'goal_type' => ['sometimes', 'required', Rule::in(self::GOAL_TYPES)],
            'target_date' => 'sometimes|nullable|date_format:Y-m-d',
            'start_date' => 'sometimes|nullable|date_format:Y-m-d',
            'priority' => ['sometimes', Rule::in(self::PRIORITIES)],
            'status' => ['sometimes', Rule::in(self::GOAL_STATUSES)],
            'source_notes' => 'sometimes|nullable|string|max:10000',
        ];
        $data = $request->validate($rules);
        if (isset($data['title'])) $data['title'] = trim($data['title']);
        if (!empty($data['start_date']) && !empty($data['target_date']) && $data['start_date'] > $data['target_date']) {
            abort(422, 'The start date must be on or before the target date.');
        }
        return $data;
    }

    private function validatePlan(Request $request, bool $partial = false): array
    {
        $rules = [
            'business_id' => 'sometimes|nullable|integer|exists:pm_businesses,id',
            'goal_id' => 'sometimes|nullable|integer|exists:pm_operation_goals,id',
            'title' => ($partial ? 'sometimes|' : '').'required|string|max:200',
            'priority' => ['sometimes', Rule::in(self::PRIORITIES)],
            'objective' => 'sometimes|nullable|string|max:12000',
            'background' => 'sometimes|nullable|string|max:20000',
            'proposed_approach' => 'sometimes|nullable|string|max:30000',
            'proposed_tasks' => 'sometimes|array|max:100',
            'proposed_tasks.*.title' => 'required_with:proposed_tasks|string|max:200',
            'proposed_tasks.*.description' => 'nullable|string|max:5000',
            'proposed_tasks.*.responsible' => 'nullable|string|max:160',
            'proposed_tasks.*.due_date' => 'nullable|date_format:Y-m-d',
            'proposed_tasks.*.dependencies' => 'nullable|string|max:2000',
            'proposed_tasks.*.priority' => ['nullable', Rule::in(self::PRIORITIES)],
            'proposed_tasks.*.notes' => 'nullable|string|max:3000',
            'timeline' => 'sometimes|array|max:100',
            'timeline.*.milestone' => 'required_with:timeline|string|max:200',
            'timeline.*.date' => 'nullable|date_format:Y-m-d',
            'timeline.*.notes' => 'nullable|string|max:3000',
            'resource_requirements' => 'sometimes|nullable|string|max:20000',
            'expected_outcomes' => 'sometimes|nullable|string|max:20000',
            'risks' => 'sometimes|nullable|string|max:20000',
            'boss_comments' => 'sometimes|nullable|string|max:10000',
            'approval_notes' => 'sometimes|nullable|string|max:10000',
            'additional_notes' => 'sometimes|nullable|string|max:20000',
        ];
        $data = $request->validate($rules);
        if (isset($data['title'])) $data['title'] = trim($data['title']);
        return $data;
    }

    private function recordRevision(PmOperationPlan $plan, string $event, ?string $reason, ?int $userId): void
    {
        $plan->loadMissing(['business:id,name', 'goal:id,title']);
        $snapshot = $plan->only([
            'business_id', 'goal_id', 'title', 'priority', 'status', 'objective', 'background',
            'proposed_approach', 'proposed_tasks', 'timeline', 'resource_requirements',
            'expected_outcomes', 'risks', 'boss_comments', 'approval_notes', 'additional_notes',
        ]);
        $next = ((int) PmOperationPlanRevision::query()->where('plan_id', $plan->id)->max('revision_number')) + 1;
        PmOperationPlanRevision::create([
            'plan_id' => $plan->id,
            'revision_number' => $next,
            'snapshot' => $snapshot,
            'event' => $event,
            'change_reason' => $reason,
            'created_by' => $userId,
        ]);
    }

    private function presentGoal(PmOperationGoal $goal): array
    {
        $date = $goal->target_date?->toDateString();
        $effective = $goal->priority === 'auto' ? $this->automaticPriority($date) : $goal->priority;
        return [
            'id' => $goal->id, 'business_id' => $goal->business_id,
            'business' => $goal->business ? ['id' => $goal->business->id, 'name' => $goal->business->name, 'slug' => $goal->business->slug] : null,
            'title' => $goal->title, 'description' => $goal->description, 'goal_type' => $goal->goal_type,
            'target_date' => $date, 'start_date' => $goal->start_date?->toDateString(),
            'priority' => $goal->priority, 'effective_priority' => $effective, 'status' => $goal->status,
            'source_notes' => $goal->source_notes, 'created_at' => $goal->created_at?->toIso8601String(),
            'updated_at' => $goal->updated_at?->toIso8601String(),
        ];
    }

    private function presentPlan(PmOperationPlan $plan): array
    {
        $target = $plan->goal?->target_date?->toDateString();
        $effective = $plan->priority === 'auto' ? $this->automaticPriority($target) : $plan->priority;
        return [
            'id' => $plan->id, 'business_id' => $plan->business_id,
            'business' => $plan->business ? ['id' => $plan->business->id, 'name' => $plan->business->name, 'slug' => $plan->business->slug] : null,
            'goal_id' => $plan->goal_id, 'goal' => $plan->goal ? ['id' => $plan->goal->id, 'title' => $plan->goal->title, 'target_date' => $target] : null,
            'title' => $plan->title, 'priority' => $plan->priority, 'effective_priority' => $effective,
            'status' => $plan->status, 'objective' => $plan->objective, 'background' => $plan->background,
            'proposed_approach' => $plan->proposed_approach, 'proposed_tasks' => $plan->proposed_tasks ?? [],
            'timeline' => $plan->timeline ?? [], 'resource_requirements' => $plan->resource_requirements,
            'expected_outcomes' => $plan->expected_outcomes, 'risks' => $plan->risks,
            'boss_comments' => $plan->boss_comments, 'approval_notes' => $plan->approval_notes,
            'additional_notes' => $plan->additional_notes, 'submitted_at' => $plan->submitted_at?->toIso8601String(),
            'reviewed_at' => $plan->reviewed_at?->toIso8601String(), 'archived_at' => $plan->archived_at?->toIso8601String(),
            'revision_count' => $plan->revisions?->count() ?? 0,
            'revisions' => ($plan->revisions ?? collect())->map(fn ($revision) => [
                'id' => $revision->id, 'revision_number' => $revision->revision_number, 'event' => $revision->event,
                'change_reason' => $revision->change_reason, 'snapshot' => $revision->snapshot,
                'created_at' => $revision->created_at?->toIso8601String(),
            ])->values(),
            'created_at' => $plan->created_at?->toIso8601String(), 'updated_at' => $plan->updated_at?->toIso8601String(),
        ];
    }

    private function automaticPriority(?string $date): string
    {
        if (!$date) return 'unscheduled';
        $today = now()->startOfDay();
        $target = Carbon::parse($date)->startOfDay();
        if ($target->lt($today)) return 'urgent';
        $days = $today->diffInDays($target);
        $highDays = max(0, (int) config('pm_operations.priority_high_within_days', 3));
        $mediumDays = max($highDays, (int) config('pm_operations.priority_medium_within_days', 7));
        if ($days <= $highDays) return 'high';
        if ($days <= $mediumDays) return 'medium';
        return 'normal';
    }
}
