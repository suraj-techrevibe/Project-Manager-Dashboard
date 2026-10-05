<?php

namespace App\Services\Pm;

use App\Models\PmActivity;
use App\Models\PmCard;
use App\Models\PmSubtask;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use RuntimeException;

/**
 * Pulls real data from Taskmandu (standalone /tasks, plus each project's
 * embedded task board) into the local pm_cards table that FlagService reads.
 *
 * Two card "shapes" get synced:
 *  - external_id "task:<mongoId>"                         — a standalone Task
 *  - external_id "project:<projectId>:task:<subTaskId>"   — a task on a project board
 *
 * Field notes (see backend/src/features/task/task.model.ts and
 * project.model.ts for the source schemas):
 *  - assignedToId is an array of Employee.employeeId strings, not names —
 *    we resolve those against /employees once per sync and join the names.
 *  - Standalone tasks have real updatedAt timestamps (used for "stuck").
 *    Project-board tasks only have createdAt on the subdocument, so their
 *    "last activity" falls back to the most recent comment, or createdAt —
 *    slightly less precise, noted here rather than hidden.
 *  - subtasks_count only applies to project-board tasks (subTasks array);
 *    standalone tasks have no subtask concept in Taskmandu.
 */
class TaskmanduSync
{
    /**
     * False on the very first sync (empty table): everything would look "new
     * today" and flood the daily report, so nothing is logged until there is a
     * baseline to compare against.
     */
    private bool $baseline = false;

    public function __construct(private TaskmanduClient $client) {}

    public function configured(): bool
    {
        return $this->client->configured();
    }

    public function run(): int
    {
        $employees = $this->employeeMap();
        $count = 0;
        $this->baseline = PmCard::query()->exists();

        $count += $this->syncStandaloneTasks($employees);
        $count += $this->syncProjectBoards($employees);

        // Powers the "Last synced" label on Today.
        try {
            Cache::forever('pm.last_synced_at', now()->toIso8601String());
        } catch (\Throwable $e) {
            report($e);
        }

        return $count;
    }

    /**
     * id => "First Last". Keyed by every id an employee can be referred to by
     * (employeeId, Mongo _id, userId) because tasks created elsewhere in
     * Taskmandu store assignees under different keys — keying only by
     * employeeId is what left raw ids like "6a8aa033…" showing as names.
     */
    public function employeeMap(): array
    {
        $map = [];

        foreach ($this->client->paginate('/employees') as $e) {
            $name = trim(($e['firstName'] ?? '').' '.($e['lastName'] ?? ''));

            foreach (['employeeId', '_id', 'userId'] as $key) {
                if (! empty($e[$key]) && is_string($e[$key])) {
                    $map[$e[$key]] = $name;
                }
            }
        }

        return $map;
    }

    /** Deletes a ticket the PM pushed, by the exact Taskmandu id recorded at push time. */
    public function deletePushedTask(string $taskId, ?string $projectId = null): void
    {
        $path = $projectId
            ? "/projects/{$projectId}/tasks/{$taskId}"
            : "/tasks/{$taskId}";

        $this->client->delete($path);
    }

    private function names(array $employees, array $ids): ?string
    {
        $names = collect($ids)->map(fn ($id) => $employees[$id] ?? $id)->filter();

        return $names->isEmpty() ? null : $names->implode(', ');
    }

    private function syncStandaloneTasks(array $employees): int
    {
        $tasks = $this->client->paginate('/tasks');
        $frontend = rtrim(config('services.taskmandu.frontend_url', ''), '/');

        foreach ($tasks as $t) {
            $card = PmCard::firstOrNew(['external_id' => 'task:'.$t['_id']]);
            [$existed, $oldStatus, $oldComments] = [$card->exists, $card->status, (int) $card->comments_count];
            $card->fill([
                'title' => $t['title'],
                'description' => $t['description'] ?? null,
                'assignee' => $this->names($employees, $t['assignedToId'] ?? []),
                'status' => $t['status'],
                'due_at' => $t['dueDate'] ?? null, // already YYYY-MM-DD
                'last_activity_at' => Carbon::parse($t['updatedAt']),
                'subtasks_count' => 0,
                'project_id' => null,
                'project_name' => null,
                'task_id' => $t['_id'],
                'priority' => $t['priority'] ?? null,
                'estimated_hours' => $t['estimatedHours'] ?? null,
                'tags' => $t['tags'] ?? [],
                'comments_count' => count($t['comments'] ?? []),
                'assigned_by' => $t['assignedByName'] ?? null,
                'url' => $frontend ? "{$frontend}/tasks/{$t['_id']}" : null,
            ]);
            $card->save();
            $this->track($card, $existed, $oldStatus, $oldComments);
        }

        return count($tasks);
    }

    private function syncProjectBoards(array $employees): int
    {
        $projects = $this->client->paginate('/projects');
        $frontend = rtrim(config('services.taskmandu.frontend_url', ''), '/');
        $count = 0;
        $seenSubs = [];

        foreach ($projects as $p) {
            foreach ($p['tasks'] ?? [] as $t) {
                $lastComment = collect($t['comments'] ?? [])->last();
                $lastActivity = $lastComment['createdAt'] ?? $t['createdAt'] ?? null;

                $card = PmCard::firstOrNew(['external_id' => "project:{$p['_id']}:task:{$t['_id']}"]);
                [$existed, $oldStatus, $oldComments] = [$card->exists, $card->status, (int) $card->comments_count];
                $card->fill([
                    'title' => $t['title'],
                    'description' => $t['description'] ?? null,
                    'assignee' => $this->names($employees, $t['assignedToId'] ?? []),
                    'status' => $t['status'],
                    'due_at' => $t['dueDate'] ?? null,
                    'last_activity_at' => $lastActivity ? Carbon::parse($lastActivity) : null,
                    'subtasks_count' => count($t['subTasks'] ?? []),
                    'project_id' => $p['_id'],
                    'project_name' => $p['name'],
                    'task_id' => $t['_id'],
                    'priority' => $t['priority'] ?? null,
                    'estimated_hours' => $t['estimatedHours'] ?? null,
                    'tags' => $t['tags'] ?? [],
                    'comments_count' => count($t['comments'] ?? []),
                    'assigned_by' => $t['assignedByName'] ?? null,
                    'url' => $frontend ? "{$frontend}/projects/{$p['_id']}" : null,
                ]);
                $card->save();
                $this->track($card, $existed, $oldStatus, $oldComments);
                $count++;

                $this->syncSubTasks($p, $t, $card, $employees, $seenSubs);
            }
        }

        // Sub-tasks deleted in Taskmandu (or whose project/task is gone) must not linger on Today.
        PmSubtask::query()->whereNotIn('external_id', $seenSubs ?: [''])->delete();

        return $count;
    }

    /**
     * Mirrors one task's sub-tasks into pm_subtasks. Sub-tasks have no due date or estimate of
     * their own, so we keep the parent's due date for context.
     *
     * @param  array<string>  $seen  collects every external_id written, for pruning
     */
    private function syncSubTasks(array $project, array $task, PmCard $parent, array $employees, array &$seen): void
    {
        $frontend = rtrim(config('services.taskmandu.frontend_url', ''), '/');

        foreach ($task['subTasks'] ?? [] as $s) {
            $key = "project:{$project['_id']}:task:{$task['_id']}:sub:{$s['_id']}";
            $seen[] = $key;

            PmSubtask::updateOrCreate(['external_id' => $key], [
                'project_id' => $project['_id'],
                'project_name' => $project['name'],
                'task_id' => $task['_id'],
                'subtask_id' => $s['_id'],
                'parent_title' => $task['title'],
                'parent_assignee' => $parent->assignee,
                'parent_due_at' => $task['dueDate'] ?? null,
                'title' => $s['title'],
                'assignee' => $this->names($employees, $s['assignedToId'] ?? []),
                'assigned_by' => $s['assignedByName'] ?? null,
                'status' => $s['status'] ?? 'Assigned',
                'comments_count' => count($s['comments'] ?? []),
                'remote_created_at' => ! empty($s['createdAt']) ? Carbon::parse($s['createdAt']) : null,
                'url' => $frontend ? "{$frontend}/projects/{$project['_id']}" : null,
            ]);
        }
    }

    /**
     * Assigns a sub-task in Taskmandu (PATCH, same call the Projects tab uses) and returns the
     * display name, so the caller can update the local mirror without waiting for a sync.
     */
    public function assignSubTask(PmSubtask $sub, string $employeeId): string
    {
        $this->client->patch("/projects/{$sub->project_id}/tasks/{$sub->task_id}/subtasks/{$sub->subtask_id}", [
            'assignedToId' => [$employeeId],
        ]);

        $name = collect($this->listEmployees())->firstWhere('employeeId', $employeeId)['name'] ?? null;

        return $name ?: $employeeId;
    }

    /** Logs new tasks and status changes seen by this sync, for the daily report. */
    private function track(PmCard $card, bool $existed, ?string $oldStatus, int $oldComments = 0): void
    {
        if (! $this->baseline) {
            return;
        }

        if (! $existed) {
            PmActivity::record('created', $card);
        } else {
            if ($oldStatus !== $card->status) {
                PmActivity::record('status_change', $card, ['from' => $oldStatus, 'to' => $card->status]);
            }
            // New comments are the best signal of quiet progress on a task whose status didn't change.
            if ((int) $card->comments_count > $oldComments) {
                PmActivity::record('comment', $card, ['count' => (int) $card->comments_count - $oldComments]);
            }
        }
    }

    /**
     * Creates a standalone Task in Taskmandu from a drafted ticket.
     * assignedToId is required by Taskmandu (min 1) — pass an Employee.employeeId.
     *
     * $extra may carry priority / estimatedHours / tags. Taskmandu's create
     * endpoint is not confirmed to accept them, so they are tried first as real
     * fields; if Taskmandu rejects the request with a 400/422 it is retried
     * once without them and $fallbackLine is appended to the description.
     *
     * @return array{data: array, fallback: bool}
     */
    public function createTask(
        string $title,
        string $description,
        string $assigneeEmployeeId,
        string $dueDate,
        array $extra = [],
        string $fallbackLine = '',
    ): array {
        [$res, $fallback] = $this->postWithFallback('/tasks', [
            'title' => $title,
            'description' => $description,
            'assignedToId' => [$assigneeEmployeeId],
            'dueDate' => $dueDate, // YYYY-MM-DD
            'status' => 'Assigned',
        ], $extra, $fallbackLine);

        return ['data' => $res['data'] ?? [], 'fallback' => $fallback];
    }

    /**
     * Adds a task to a project's board (POST /projects/{id}/tasks).
     *
     * @return array{project: array, task: array, fallback: bool}
     */
    public function createProjectTask(
        string $projectId,
        string $title,
        string $description,
        string $assigneeEmployeeId,
        string $assignedByName,
        string $dueDate,
        array $extra = [],
        string $fallbackLine = '',
    ): array {
        [$res, $fallback] = $this->postWithFallback("/projects/{$projectId}/tasks", [
            'title' => $title,
            'description' => $description,
            'assignedToId' => [$assigneeEmployeeId],
            'assignedByName' => $assignedByName,
            'dueDate' => $dueDate,
            'status' => 'Assigned',
        ], $extra, $fallbackLine);

        $project = $res['data'] ?? [];
        $tasks = collect($project['tasks'] ?? []);
        // Taskmandu returns the whole project; the new task is the last one pushed.
        $task = $tasks->last(fn ($t) => ($t['title'] ?? null) === $title) ?? $tasks->last() ?? [];

        return ['project' => $project, 'task' => $task, 'fallback' => $fallback];
    }

    /** @return array{0: array, 1: bool} [response, usedFallback] */
    private function postWithFallback(string $path, array $base, array $extra, string $fallbackLine): array
    {
        $extra = array_filter($extra, fn ($v) => $v !== null && $v !== [] && $v !== '');

        if (! $extra) {
            return [$this->client->post($path, $base), false];
        }

        try {
            return [$this->client->post($path, $base + $extra), false];
        } catch (RuntimeException $e) {
            // Only a validation rejection means "these fields aren't accepted".
            // Anything else (auth, network, 5xx) is rethrown untouched.
            if (! preg_match('/\((400|422)\)/', $e->getMessage())) {
                throw $e;
            }

            $base['description'] = trim(($base['description'] ?? '')."\n\n".$fallbackLine);

            return [$this->client->post($path, $base), true];
        }
    }

    /** For the assignee pickers. `id` is the Mongo _id, `employeeId` is what Taskmandu assigns by. */
    public function listEmployees(): array
    {
        return collect($this->client->paginate('/employees'))
            ->map(fn ($e) => [
                'employeeId' => $e['employeeId'],
                'id' => $e['_id'] ?? null,
                'name' => trim($e['firstName'].' '.$e['lastName']),
                'designation' => $e['designation'] ?? null,
            ])
            ->values()
            ->all();
    }
}
