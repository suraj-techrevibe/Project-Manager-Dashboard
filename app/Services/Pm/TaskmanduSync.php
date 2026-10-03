<?php

namespace App\Services\Pm;

use App\Models\PmCard;
use Illuminate\Support\Carbon;

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
    public function __construct(private TaskmanduClient $client) {}

    public function configured(): bool
    {
        return $this->client->configured();
    }

    public function run(): int
    {
        $employees = $this->employeeMap();
        $count = 0;

        $count += $this->syncStandaloneTasks($employees);
        $count += $this->syncProjectBoards($employees);

        return $count;
    }

    /** employeeId => "First Last" */
    private function employeeMap(): array
    {
        $employees = $this->client->paginate('/employees');

        return collect($employees)->mapWithKeys(fn ($e) => [
            $e['employeeId'] => trim($e['firstName'].' '.$e['lastName']),
        ])->all();
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
        }

        return count($tasks);
    }

    private function syncProjectBoards(array $employees): int
    {
        $projects = $this->client->paginate('/projects');
        $frontend = rtrim(config('services.taskmandu.frontend_url', ''), '/');
        $count = 0;

        foreach ($projects as $p) {
            foreach ($p['tasks'] ?? [] as $t) {
                $lastComment = collect($t['comments'] ?? [])->last();
                $lastActivity = $lastComment['createdAt'] ?? $t['createdAt'] ?? null;

                $card = PmCard::firstOrNew(['external_id' => "project:{$p['_id']}:task:{$t['_id']}"]);
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
                $count++;
            }
        }

        return $count;
    }

    /**
     * Creates a standalone Task in Taskmandu from a drafted ticket.
     * assignedToId is required by Taskmandu (min 1) — pass an Employee.employeeId.
     */
    public function createTask(string $title, string $description, string $assigneeEmployeeId, string $dueDate): array
    {
        return $this->client->post('/tasks', [
            'title' => $title,
            'description' => $description,
            'assignedToId' => [$assigneeEmployeeId],
            'dueDate' => $dueDate, // YYYY-MM-DD
            'status' => 'Assigned',
        ]);
    }

    /** For the assignee picker on the "brief to tickets" tab. */
    public function listEmployees(): array
    {
        return collect($this->client->paginate('/employees'))
            ->map(fn ($e) => [
                'employeeId' => $e['employeeId'],
                'name' => trim($e['firstName'].' '.$e['lastName']),
                'designation' => $e['designation'] ?? null,
            ])
            ->values()
            ->all();
    }
}
