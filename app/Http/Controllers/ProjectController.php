<?php

namespace App\Http\Controllers;

use App\Services\Pm\TaskmanduClient;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use RuntimeException;

/**
 * Thin passthrough to Taskmandu's real /projects API (see
 * backend/src/features/project in the Taskmandu repo) so the PM agent can
 * list, open, create and edit projects and their task boards without
 * leaving the dashboard. Nothing here is cached locally — it's a live
 * mirror of Taskmandu, not a sync job like TaskmanduSync/pm_cards.
 *
 * Validation below mirrors Taskmandu's Zod schemas in
 * project.validation.ts exactly (field names, limits, enums) so a bad
 * request fails fast here instead of bouncing off Taskmandu as a 400.
 */
class ProjectController extends Controller
{
    private const PROJECT_STATUSES = ['Planning', 'Active', 'Blocked', 'On Hold', 'Completed'];

    private const TASK_STATUSES = ['Assigned', 'Pending', 'In Progress', 'Blocked', 'Completed', 'Cancelled'];

    private const TASK_PRIORITIES = ['Low', 'Medium', 'High', 'Critical'];

    public function __construct(private TaskmanduClient $taskmandu) {}

    public function index(Request $r): JsonResponse
    {
        $query = $r->validate([
            'search' => 'nullable|string|max:100',
            'status' => ['nullable', Rule::in(self::PROJECT_STATUSES)],
        ]);

        try {
            $projects = $this->taskmandu->paginate('/projects', array_filter($query));
        } catch (RuntimeException $e) {
            return response()->json(['error' => $e->getMessage()], 422);
        }

        return response()->json(['projects' => $projects]);
    }

    public function show(string $project): JsonResponse
    {
        try {
            $res = $this->taskmandu->get("/projects/{$project}");
        } catch (RuntimeException $e) {
            return response()->json(['error' => $e->getMessage()], 422);
        }

        return response()->json(['project' => $res['data'] ?? null]);
    }

    public function store(Request $r): JsonResponse
    {
        $data = $r->validate([
            'name' => 'required|string|min:1|max:200',
            'description' => 'nullable|string|max:5000',
            'status' => ['nullable', Rule::in(self::PROJECT_STATUSES)],
            'manager' => 'nullable|string|max:100',
            'startDate' => 'nullable|date_format:Y-m-d',
            'endDate' => 'nullable|date_format:Y-m-d',
            'color' => 'nullable|string|max:200',
        ]);

        try {
            $res = $this->taskmandu->post('/projects', array_filter($data, fn ($v) => $v !== null));
        } catch (RuntimeException $e) {
            return response()->json(['error' => $e->getMessage()], 422);
        }

        return response()->json(['project' => $res['data'] ?? null], 201);
    }

    public function update(Request $r, string $project): JsonResponse
    {
        $data = $r->validate([
            'name' => 'nullable|string|min:1|max:200',
            'description' => 'nullable|string|max:5000',
            'status' => ['nullable', Rule::in(self::PROJECT_STATUSES)],
            'manager' => 'nullable|string|max:100',
            'startDate' => 'nullable|date_format:Y-m-d',
            'endDate' => 'nullable|date_format:Y-m-d',
            'color' => 'nullable|string|max:200',
        ]);

        try {
            $res = $this->taskmandu->patch("/projects/{$project}", array_filter($data, fn ($v) => $v !== null));
        } catch (RuntimeException $e) {
            return response()->json(['error' => $e->getMessage()], 422);
        }

        return response()->json(['project' => $res['data'] ?? null]);
    }

    public function destroy(string $project): JsonResponse
    {
        try {
            // TaskmanduClient has no delete() helper yet — reuse the generic
            // request path via patch's sibling isn't right either, so go
            // straight through the client's post-like request for DELETE.
            $this->taskmandu->delete("/projects/{$project}");
        } catch (RuntimeException $e) {
            return response()->json(['error' => $e->getMessage()], 422);
        }

        return response()->json(['deleted' => true]);
    }

    public function addTask(Request $r, string $project): JsonResponse
    {
        $data = $r->validate([
            'title' => 'required|string|min:1|max:200',
            'description' => 'nullable|string|max:5000',
            'assignedToId' => 'nullable|array',
            'assignedToId.*' => 'string|max:100',
            'assignedByName' => 'nullable|string|max:100',
            'priority' => ['nullable', Rule::in(self::TASK_PRIORITIES)],
            'dueDate' => 'required|date_format:Y-m-d',
            'estimatedHours' => 'nullable|numeric|min:0|max:1000',
            'status' => ['nullable', Rule::in(self::TASK_STATUSES)],
            'tags' => 'nullable|array|max:20',
            'tags.*' => 'string|max:50',
        ]);

        try {
            $res = $this->taskmandu->post("/projects/{$project}/tasks", array_filter($data, fn ($v) => $v !== null));
        } catch (RuntimeException $e) {
            return response()->json(['error' => $e->getMessage()], 422);
        }

        return response()->json(['project' => $res['data'] ?? null], 201);
    }

    public function updateTask(Request $r, string $project, string $task): JsonResponse
    {
        $data = $r->validate([
            'title' => 'nullable|string|min:1|max:200',
            'description' => 'nullable|string|max:5000',
            'assignedToId' => 'nullable|array',
            'assignedToId.*' => 'string|max:100',
            'assignedByName' => 'nullable|string|max:100',
            'priority' => ['nullable', Rule::in(self::TASK_PRIORITIES)],
            'dueDate' => 'nullable|date_format:Y-m-d',
            'estimatedHours' => 'nullable|numeric|min:0|max:1000',
            'status' => ['nullable', Rule::in(self::TASK_STATUSES)],
            'tags' => 'nullable|array|max:20',
            'tags.*' => 'string|max:50',
        ]);

        try {
            $res = $this->taskmandu->patch("/projects/{$project}/tasks/{$task}", array_filter($data, fn ($v) => $v !== null));
        } catch (RuntimeException $e) {
            return response()->json(['error' => $e->getMessage()], 422);
        }

        return response()->json(['project' => $res['data'] ?? null]);
    }

    public function deleteTask(string $project, string $task): JsonResponse
    {
        try {
            $this->taskmandu->delete("/projects/{$project}/tasks/{$task}");
        } catch (RuntimeException $e) {
            return response()->json(['error' => $e->getMessage()], 422);
        }

        return response()->json(['deleted' => true]);
    }
}
