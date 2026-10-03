<?php

namespace App\Http\Controllers;

use App\Services\Pm\TaskmanduClient;
use App\Services\Pm\TaskmanduUploadClient;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use RuntimeException;

/**
 * Live passthrough to Taskmandu's /projects API (see
 * backend/src/features/project in the Taskmandu repo) so this dashboard can
 * do everything Taskmandu's own Projects area does: projects, documents
 * (real file upload), shared variables ("secrets"), tasks, task comments,
 * sub-tasks, sub-task comments and members. Nothing is cached locally.
 *
 * Validation mirrors Taskmandu's Zod schemas in project.validation.ts
 * (field names, limits, enums) so a bad request fails fast here instead of
 * bouncing off Taskmandu as a 400.
 *
 * Every Taskmandu mutation returns the whole updated project, so every
 * mutating action here responds with {project: ...} and the frontend just
 * swaps it in. Documents get a computed `url` (see present()).
 */
class ProjectController extends Controller
{
    private const PROJECT_STATUSES = ['Planning', 'Active', 'Blocked', 'On Hold', 'Completed'];

    private const TASK_STATUSES = ['Assigned', 'Pending', 'In Progress', 'Blocked', 'Completed', 'Cancelled'];

    private const TASK_PRIORITIES = ['Low', 'Medium', 'High', 'Critical'];

    private const VARIABLE_TYPES = ['Environment', 'Server Creds', 'Database', 'Other'];

    private const MEMBER_ROLES = ['owner', 'admin', 'member', 'viewer'];

    public function __construct(
        private TaskmanduClient $taskmandu,
        private TaskmanduUploadClient $uploads,
    ) {}

    /* ------------------------------------------------------------------ */
    /* Projects                                                            */
    /* ------------------------------------------------------------------ */

    public function index(Request $r): JsonResponse
    {
        $query = $r->validate([
            'search' => 'nullable|string|max:100',
            'status' => ['nullable', Rule::in(self::PROJECT_STATUSES)],
        ]);

        try {
            $projects = $this->taskmandu->paginate('/projects', array_filter($query));
        } catch (RuntimeException $e) {
            return $this->fail($e);
        }

        return response()->json(['projects' => array_map(fn ($p) => $this->present($p), $projects)]);
    }

    public function show(string $project): JsonResponse
    {
        return $this->respond(fn () => $this->taskmandu->get("/projects/{$project}"));
    }

    public function store(Request $r): JsonResponse
    {
        $data = $r->validate($this->projectRules(partial: false));

        return $this->respond(
            fn () => $this->taskmandu->post('/projects', array_filter($data, fn ($v) => $v !== null)),
            201,
        );
    }

    public function update(Request $r, string $project): JsonResponse
    {
        $data = $r->validate($this->projectRules(partial: true));

        $payload = [];
        foreach (['name', 'status'] as $k) {
            if (! empty($data[$k])) {
                $payload[$k] = $data[$k];
            }
        }
        // Blank text fields arrive as null (ConvertEmptyStringsToNull) — send ''
        // so they can actually be cleared. Dates: null clears them.
        foreach (['description', 'manager', 'color'] as $k) {
            if (array_key_exists($k, $data)) {
                $payload[$k] = $data[$k] ?? '';
            }
        }
        foreach (['startDate', 'endDate'] as $k) {
            if (array_key_exists($k, $data)) {
                $payload[$k] = $data[$k];
            }
        }

        return $this->respond(fn () => $this->taskmandu->patch("/projects/{$project}", $payload));
    }

    public function destroy(string $project): JsonResponse
    {
        try {
            $this->taskmandu->delete("/projects/{$project}");
        } catch (RuntimeException $e) {
            return $this->fail($e);
        }

        return response()->json(['deleted' => true]);
    }

    /* ------------------------------------------------------------------ */
    /* Documents (multipart upload; files are served by Taskmandu itself)  */
    /* ------------------------------------------------------------------ */

    public function addDocument(Request $r, string $project): JsonResponse
    {
        // Taskmandu's multer limit is 5 MB. Also check php.ini's
        // upload_max_filesize / post_max_size are at least that high.
        $data = $r->validate([
            'file' => 'required|file|max:5120',
            'name' => 'nullable|string|max:200',
            'description' => 'nullable|string|max:1000',
        ]);

        return $this->respond(fn () => $this->uploads->upload(
            "/projects/{$project}/documents",
            $r->file('file'),
            [
                'name' => $data['name'] ?? $r->file('file')->getClientOriginalName(),
                'uploadedBy' => $r->user()?->name ?? '',
                'description' => $data['description'] ?? null,
            ],
        ));
    }

    public function updateDocument(Request $r, string $project, string $document): JsonResponse
    {
        $data = $r->validate([
            'name' => 'nullable|string|min:1|max:200',
            'description' => 'nullable|string|max:1000',
        ]);

        return $this->respond(fn () => $this->taskmandu->patch(
            "/projects/{$project}/documents/{$document}",
            $this->payload($data, ['description']),
        ));
    }

    public function deleteDocument(string $project, string $document): JsonResponse
    {
        return $this->respond(fn () => $this->taskmandu->delete("/projects/{$project}/documents/{$document}"));
    }

    /* ------------------------------------------------------------------ */
    /* Shared variables ("secrets")                                        */
    /* ------------------------------------------------------------------ */

    public function addVariable(Request $r, string $project): JsonResponse
    {
        $data = $r->validate($this->variableRules(partial: false));
        $data['updatedBy'] = $r->user()?->name ?? '';

        return $this->respond(fn () => $this->taskmandu->post(
            "/projects/{$project}/variables",
            $this->payload($data, ['value', 'description']),
        ));
    }

    public function updateVariable(Request $r, string $project, string $variable): JsonResponse
    {
        $data = $r->validate($this->variableRules(partial: true));
        $data['updatedBy'] = $r->user()?->name ?? '';

        return $this->respond(fn () => $this->taskmandu->patch(
            "/projects/{$project}/variables/{$variable}",
            $this->payload($data, ['value', 'description']),
        ));
    }

    public function deleteVariable(string $project, string $variable): JsonResponse
    {
        return $this->respond(fn () => $this->taskmandu->delete("/projects/{$project}/variables/{$variable}"));
    }

    /* ------------------------------------------------------------------ */
    /* Tasks + task comments                                               */
    /* ------------------------------------------------------------------ */

    public function addTask(Request $r, string $project): JsonResponse
    {
        $data = $r->validate($this->taskRules(partial: false));
        $data['assignedByName'] ??= $r->user()?->name ?? '';

        return $this->respond(fn () => $this->taskmandu->post(
            "/projects/{$project}/tasks",
            $this->payload($data, ['description']),
        ), 201);
    }

    public function updateTask(Request $r, string $project, string $task): JsonResponse
    {
        $data = $r->validate($this->taskRules(partial: true));

        return $this->respond(fn () => $this->taskmandu->patch(
            "/projects/{$project}/tasks/{$task}",
            $this->payload($data, ['description']),
        ));
    }

    public function deleteTask(string $project, string $task): JsonResponse
    {
        return $this->respond(fn () => $this->taskmandu->delete("/projects/{$project}/tasks/{$task}"));
    }

    public function addTaskComment(Request $r, string $project, string $task): JsonResponse
    {
        $data = $r->validate(['text' => 'required|string|min:1|max:2000']);

        return $this->respond(fn () => $this->taskmandu->post("/projects/{$project}/tasks/{$task}/comments", $data));
    }

    /* ------------------------------------------------------------------ */
    /* Sub-tasks + sub-task comments                                       */
    /* ------------------------------------------------------------------ */

    public function addSubTask(Request $r, string $project, string $task): JsonResponse
    {
        $data = $r->validate($this->subTaskRules(partial: false));
        $data['assignedByName'] ??= $r->user()?->name ?? '';

        return $this->respond(fn () => $this->taskmandu->post(
            "/projects/{$project}/tasks/{$task}/subtasks",
            $this->payload($data),
        ), 201);
    }

    public function updateSubTask(Request $r, string $project, string $task, string $subTask): JsonResponse
    {
        $data = $r->validate($this->subTaskRules(partial: true));

        return $this->respond(fn () => $this->taskmandu->patch(
            "/projects/{$project}/tasks/{$task}/subtasks/{$subTask}",
            $this->payload($data),
        ));
    }

    public function deleteSubTask(string $project, string $task, string $subTask): JsonResponse
    {
        return $this->respond(fn () => $this->taskmandu->delete("/projects/{$project}/tasks/{$task}/subtasks/{$subTask}"));
    }

    public function addSubTaskComment(Request $r, string $project, string $task, string $subTask): JsonResponse
    {
        $data = $r->validate(['text' => 'required|string|min:1|max:2000']);

        return $this->respond(fn () => $this->taskmandu->post(
            "/projects/{$project}/tasks/{$task}/subtasks/{$subTask}/comments",
            $data,
        ));
    }

    /* ------------------------------------------------------------------ */
    /* Members                                                             */
    /* ------------------------------------------------------------------ */

    public function members(string $project): JsonResponse
    {
        try {
            $res = $this->taskmandu->get("/projects/{$project}/members");
        } catch (RuntimeException $e) {
            return $this->fail($e);
        }

        return response()->json(['members' => $res['data'] ?? []]);
    }

    public function addMember(Request $r, string $project): JsonResponse
    {
        // Taskmandu accepts a User id or an Employee id here (it resolves an
        // Employee to its User by email). Note: Taskmandu only lets project
        // members / creators / `projects:manage` holders manage members.
        $data = $r->validate([
            'userId' => 'required|string|max:100',
            'role' => ['nullable', Rule::in(self::MEMBER_ROLES)],
            'name' => 'nullable|string|max:100',
            'email' => 'nullable|email|max:200',
        ]);

        return $this->respond(fn () => $this->taskmandu->post(
            "/projects/{$project}/members",
            array_filter($data, fn ($v) => $v !== null),
        ), 201);
    }

    public function removeMember(string $project, string $member): JsonResponse
    {
        return $this->respond(fn () => $this->taskmandu->delete("/projects/{$project}/members/{$member}"));
    }

    /* ------------------------------------------------------------------ */
    /* Validation rule sets (mirror project.validation.ts)                 */
    /* ------------------------------------------------------------------ */

    private function projectRules(bool $partial): array
    {
        return [
            'name' => [$partial ? 'nullable' : 'required', 'string', 'min:1', 'max:200'],
            'description' => 'nullable|string|max:5000',
            'status' => ['nullable', Rule::in(self::PROJECT_STATUSES)],
            'manager' => 'nullable|string|max:100',
            'startDate' => 'nullable|date_format:Y-m-d',
            'endDate' => 'nullable|date_format:Y-m-d',
            'color' => 'nullable|string|max:200',
        ];
    }

    private function variableRules(bool $partial): array
    {
        return [
            'key' => [$partial ? 'nullable' : 'required', 'string', 'min:1', 'max:200'],
            'value' => 'nullable|string|max:5000',
            'isSecret' => 'nullable|boolean',
            'type' => ['nullable', Rule::in(self::VARIABLE_TYPES)],
            'description' => 'nullable|string|max:1000',
        ];
    }

    private function taskRules(bool $partial): array
    {
        return [
            'title' => [$partial ? 'nullable' : 'required', 'string', 'min:1', 'max:200'],
            'description' => 'nullable|string|max:5000',
            'assignedToId' => 'nullable|array',
            'assignedToId.*' => 'string|max:100',
            'assignedByName' => 'nullable|string|max:100',
            'priority' => ['nullable', Rule::in(self::TASK_PRIORITIES)],
            'dueDate' => [$partial ? 'nullable' : 'required', 'date_format:Y-m-d'],
            'estimatedHours' => 'nullable|numeric|min:0|max:1000',
            'status' => ['nullable', Rule::in(self::TASK_STATUSES)],
            'tags' => 'nullable|array|max:20',
            'tags.*' => 'string|max:50',
        ];
    }

    private function subTaskRules(bool $partial): array
    {
        return [
            'title' => [$partial ? 'nullable' : 'required', 'string', 'min:1', 'max:200'],
            'assignedToId' => 'nullable|array',
            'assignedToId.*' => 'string|max:100',
            'assignedByName' => 'nullable|string|max:100',
            'status' => ['nullable', Rule::in(self::TASK_STATUSES)],
        ];
    }

    /* ------------------------------------------------------------------ */
    /* Helpers                                                             */
    /* ------------------------------------------------------------------ */

    /**
     * Drop keys the client didn't send. Blank strings arrive as null
     * (ConvertEmptyStringsToNull), so for $textKeys map null → '' — that is
     * what lets the UI clear a description/value instead of silently
     * ignoring the edit.
     */
    private function payload(array $data, array $textKeys = []): array
    {
        $out = [];
        foreach ($data as $k => $v) {
            if ($v === null) {
                if (in_array($k, $textKeys, true)) {
                    $out[$k] = '';
                }

                continue;
            }
            $out[$k] = $v;
        }

        return $out;
    }

    /** Run a Taskmandu call that returns {data: project} and wrap it as {project}. */
    private function respond(callable $call, int $status = 200): JsonResponse
    {
        try {
            $res = $call();
        } catch (RuntimeException $e) {
            return $this->fail($e);
        }

        return response()->json(['project' => $this->present($res['data'] ?? null)], $status);
    }

    private function fail(RuntimeException $e): JsonResponse
    {
        return response()->json(['error' => $e->getMessage()], 422);
    }

    /**
     * Add a download `url` to each project document. Taskmandu serves
     * uploaded files statically at {origin}/uploads/{filePath}. Override with
     * services.taskmandu.uploads_url if that's hosted somewhere else.
     */
    private function present(?array $project): ?array
    {
        if (! $project) {
            return $project;
        }

        $base = config('services.taskmandu.uploads_url')
            ?: preg_replace('#/api/v\d+/?$#', '', rtrim((string) config('services.taskmandu.base_url'), '/')).'/uploads';

        $project['documents'] = array_map(function ($d) use ($base) {
            $d['url'] = ! empty($d['filePath']) ? rtrim($base, '/').'/'.ltrim($d['filePath'], '/') : null;

            return $d;
        }, $project['documents'] ?? []);

        return $project;
    }
}
