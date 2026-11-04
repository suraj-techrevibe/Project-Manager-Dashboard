<?php

namespace App\Http\Controllers;

use App\Models\PmBusiness;
use App\Models\PmBusinessProjectLink;
use App\Models\PmIntake;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

class PmOperationsController extends Controller
{
    private const REQUEST_STATUSES = [
        'received',
        'needs_clarification',
        'in_review',
        'approved',
        'rejected',
        'deferred',
        'planned',
    ];

    private const IDEA_STATUSES = [
        'captured',
        'under_review',
        'accepted',
        'rejected',
        'deferred',
        'planned',
    ];

    public function businesses(): JsonResponse
    {
        $businesses = PmBusiness::query()
            ->with('projectLinks')
            ->orderBy('name')
            ->get()
            ->map(fn (PmBusiness $business) => $this->presentBusiness($business));

        return response()->json(['businesses' => $businesses]);
    }

    public function storeBusiness(Request $request): JsonResponse
    {
        $data = $request->validate([
            'name' => 'required|string|max:160|unique:pm_businesses,name',
            'description' => 'nullable|string|max:3000',
            'status' => ['sometimes', Rule::in(['active', 'paused'])],
        ]);

        $base = Str::slug($data['name']) ?: 'business';
        $slug = $base;
        $suffix = 2;

        while (PmBusiness::query()->where('slug', $slug)->exists()) {
            $slug = $base.'-'.$suffix++;
        }

        $business = PmBusiness::create([
            'name' => trim($data['name']),
            'slug' => $slug,
            'description' => $data['description'] ?? null,
            'status' => $data['status'] ?? 'active',
            'created_by' => $request->user()?->id,
        ]);

        return response()->json(['business' => $this->presentBusiness($business->load('projectLinks'))], 201);
    }

    public function updateBusiness(Request $request, PmBusiness $business): JsonResponse
    {
        $data = $request->validate([
            'name' => ['sometimes', 'required', 'string', 'max:160', Rule::unique('pm_businesses', 'name')->ignore($business->id)],
            'description' => 'sometimes|nullable|string|max:3000',
            'status' => ['sometimes', Rule::in(['active', 'paused'])],
        ]);

        $business->fill($data)->save();

        return response()->json(['business' => $this->presentBusiness($business->fresh()->load('projectLinks'))]);
    }

    public function attachProject(Request $request, PmBusiness $business): JsonResponse
    {
        $data = $request->validate([
            'project_id' => ['required', 'regex:/^[0-9a-fA-F]{24}$/'],
            'project_name' => 'required|string|max:200',
            'is_primary' => 'sometimes|boolean',
        ]);

        $link = DB::transaction(function () use ($business, $data) {
            if ($data['is_primary'] ?? false) {
                PmBusinessProjectLink::query()
                    ->where('business_id', $business->id)
                    ->update(['is_primary' => false]);
            }

            return PmBusinessProjectLink::updateOrCreate(
                [
                    'business_id' => $business->id,
                    'taskmandu_project_id' => $data['project_id'],
                ],
                [
                    'taskmandu_project_name' => trim($data['project_name']),
                    'is_primary' => $data['is_primary'] ?? false,
                ],
            );
        });

        return response()->json(['project_link' => $this->presentProjectLink($link)]);
    }

    public function removeProject(PmBusiness $business, string $projectId): JsonResponse
    {
        $deleted = PmBusinessProjectLink::query()
            ->where('business_id', $business->id)
            ->where('taskmandu_project_id', $projectId)
            ->delete();

        abort_unless($deleted > 0, 404);

        return response()->json(['deleted' => true]);
    }

    public function intakes(Request $request): JsonResponse
    {
        $filters = $request->validate([
            'kind' => ['nullable', Rule::in(['request', 'idea'])],
        ]);

        $query = PmIntake::query()
            ->with(['business:id,name,slug', 'taskLinks'])
            ->latest('updated_at')
            ->limit(200);

        if (! empty($filters['kind'])) {
            $query->where('kind', $filters['kind']);
        }

        return response()->json([
            'intakes' => $query->get()->map(fn (PmIntake $intake) => $this->presentIntake($intake)),
        ]);
    }

    public function storeIntake(Request $request): JsonResponse
    {
        $data = $request->validate([
            'kind' => ['required', Rule::in(['request', 'idea'])],
            'business_id' => 'nullable|integer|exists:pm_businesses,id',
            'title' => 'required|string|max:200',
            'description' => 'nullable|string|max:10000',
            'source_type' => ['sometimes', Rule::in(['boss', 'client', 'team', 'self', 'other'])],
            'source_name' => 'nullable|string|max:120',
            'priority' => ['sometimes', Rule::in(['low', 'medium', 'high', 'critical'])],
            'requested_due_at' => 'nullable|date_format:Y-m-d',
            'linked_project_id' => ['nullable', 'regex:/^[0-9a-fA-F]{24}$/'],
            'linked_project_name' => 'nullable|required_with:linked_project_id|string|max:200',
        ]);

        $data['title'] = trim($data['title']);
        if (! empty($data['linked_project_name'])) {
            $data['linked_project_name'] = trim($data['linked_project_name']);
        }
        $data['status'] = $data['kind'] === 'request' ? 'received' : 'captured';
        $data['source_type'] = $data['source_type'] ?? 'other';
        $data['priority'] = $data['priority'] ?? 'medium';
        $data['created_by'] = $request->user()?->id;
        $data['updated_by'] = $request->user()?->id;

        $intake = PmIntake::create($data)->load(['business:id,name,slug', 'taskLinks']);

        return response()->json(['intake' => $this->presentIntake($intake)], 201);
    }

    public function updateIntake(Request $request, PmIntake $intake): JsonResponse
    {
        $statuses = $intake->kind === 'request' ? self::REQUEST_STATUSES : self::IDEA_STATUSES;

        $data = $request->validate([
            'business_id' => 'sometimes|nullable|integer|exists:pm_businesses,id',
            'title' => 'sometimes|required|string|max:200',
            'description' => 'sometimes|nullable|string|max:10000',
            'source_type' => ['sometimes', Rule::in(['boss', 'client', 'team', 'self', 'other'])],
            'source_name' => 'sometimes|nullable|string|max:120',
            'priority' => ['sometimes', Rule::in(['low', 'medium', 'high', 'critical'])],
            'requested_due_at' => 'sometimes|nullable|date_format:Y-m-d',
            'linked_project_id' => ['sometimes', 'nullable', 'regex:/^[0-9a-fA-F]{24}$/'],
            'linked_project_name' => 'sometimes|nullable|required_with:linked_project_id|string|max:200',
            'clarification' => 'sometimes|nullable|string|max:5000',
            'decision_notes' => 'sometimes|nullable|string|max:5000',
            'status' => ['sometimes', Rule::in($statuses)],
        ]);

        if (($data['status'] ?? null) === 'planned' && $intake->status !== 'planned') {
            abort(422, 'This status is set automatically after tasks have been created in Taskmandu.');
        }

        if ($intake->taskLinks()->exists()
            && array_key_exists('linked_project_id', $data)
            && $data['linked_project_id'] !== $intake->linked_project_id) {
            abort(422, 'The project cannot be changed after tasks have been linked to this request.');
        }

        if (! empty($data['linked_project_name'])) {
            $data['linked_project_name'] = trim($data['linked_project_name']);
        }

        $data['updated_by'] = $request->user()?->id;
        $intake->fill($data)->save();

        return response()->json([
            'intake' => $this->presentIntake($intake->fresh()->load(['business:id,name,slug', 'taskLinks'])),
        ]);
    }

    public function deleteIntake(PmIntake $intake): JsonResponse
    {
        $intake->delete();

        return response()->json(['deleted' => true]);
    }

    private function presentBusiness(PmBusiness $business): array
    {
        return [
            'id' => $business->id,
            'name' => $business->name,
            'slug' => $business->slug,
            'description' => $business->description,
            'status' => $business->status,
            'project_links' => $business->projectLinks
                ->map(fn (PmBusinessProjectLink $link) => $this->presentProjectLink($link))
                ->values(),
        ];
    }

    private function presentProjectLink(PmBusinessProjectLink $link): array
    {
        return [
            'id' => $link->id,
            'project_id' => $link->taskmandu_project_id,
            'project_name' => $link->taskmandu_project_name,
            'is_primary' => (bool) $link->is_primary,
        ];
    }

    private function presentIntake(PmIntake $intake): array
    {
        return [
            'id' => $intake->id,
            'kind' => $intake->kind,
            'status' => $intake->status,
            'priority' => $intake->priority,
            'title' => $intake->title,
            'description' => $intake->description,
            'source_type' => $intake->source_type,
            'source_name' => $intake->source_name,
            'business_id' => $intake->business_id,
            'business' => $intake->business ? [
                'id' => $intake->business->id,
                'name' => $intake->business->name,
                'slug' => $intake->business->slug,
            ] : null,
            'requested_due_at' => $intake->requested_due_at?->toDateString(),
            'clarification' => $intake->clarification,
            'decision_notes' => $intake->decision_notes,
            'linked_project_id' => $intake->linked_project_id,
            'linked_project_name' => $intake->linked_project_name,
            'linked_task_id' => $intake->linked_task_id,
            'task_links' => $intake->taskLinks
                ->map(fn (PmIntakeTaskLink $link) => [
                    'id' => $link->id,
                    'project_id' => $link->project_id,
                    'project_name' => $link->project_name,
                    'task_id' => $link->task_id,
                    'card_id' => $link->card_id,
                    'title' => $link->title,
                    'url' => $link->url,
                ])
                ->values(),
            'created_at' => $intake->created_at?->toIso8601String(),
            'updated_at' => $intake->updated_at?->toIso8601String(),
        ];
    }
}
