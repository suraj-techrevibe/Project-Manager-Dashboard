<?php

namespace App\Services\Pm;

use App\Models\PmQaCheck;
use App\Models\PmQaTaskReview;
use Illuminate\Support\Facades\Cache;
use Illuminate\Validation\ValidationException;
use RuntimeException;

/**
 * Live Taskmandu data for a QA task item: the task's subtasks (the QA checklist), their comments,
 * and writes back to Taskmandu through its API. Task reads are never cached; each call reads the project.
 * The project list used by the pickers is cached for a few minutes.
 */
class QaTaskmanduService
{
    public function __construct(private TaskmanduClient $client) {}

    /**
     * Read the task from Taskmandu and line the checklist up with its subtasks.
     *
     * @return array{task:array<string,mixed>,subtasks:array<int,array<string,mixed>>}
     */
    public function live(PmQaTaskReview $review): array
    {
        $task = $this->fetchTask($review);
        $subtasks = collect($task['subTasks'] ?? [])->map(fn ($s) => $this->shapeSubtask($s))->values();
        $this->reconcile($review, $subtasks->all());

        return [
            'task' => [
                'title' => (string) ($task['title'] ?? $review->task_title),
                'description' => $task['description'] ?? null,
                'status' => $task['status'] ?? null,
                'comments' => $this->shapeComments($task['comments'] ?? []),
            ],
            'subtasks' => $subtasks->all(),
        ];
    }

    public function addSubtask(PmQaTaskReview $review, string $title, string $by): void
    {
        $title = $this->title($title);
        $this->call(fn () => $this->client->post($this->base($review).'/subtasks', ['title' => $title, 'assignedByName' => $by, 'status' => 'Assigned']));
        $this->live($review); // creates the matching check
    }

    public function renameSubtask(PmQaTaskReview $review, string $subtaskId, string $title): void
    {
        $title = $this->title($title);
        $this->call(fn () => $this->client->patch($this->base($review).'/subtasks/'.$subtaskId, ['title' => $title]));
        PmQaCheck::query()->where('item_type', 'task')->where('item_id', $review->id)->where('subtask_id', $subtaskId)->update(['label' => mb_substr($title, 0, 300)]);
    }

    public function deleteSubtask(PmQaTaskReview $review, string $subtaskId): void
    {
        $this->call(fn () => $this->client->delete($this->base($review).'/subtasks/'.$subtaskId));
        PmQaCheck::query()->where('item_type', 'task')->where('item_id', $review->id)->where('subtask_id', $subtaskId)->delete();
    }

    /** Comment on the task, or on one of its subtasks when $subtaskId is given. */
    public function addComment(PmQaTaskReview $review, ?string $subtaskId, string $text): void
    {
        $text = trim($text);
        if ($text === '') {
            throw ValidationException::withMessages(['text' => 'Write a comment first.']);
        }
        if (blank($review->project_id) && $subtaskId) {
            throw ValidationException::withMessages(['task' => 'This Taskmandu task has no subtasks to comment on.']);
        }
        $path = blank($review->project_id)
            ? '/tasks/'.$review->task_id.'/comments'
            : $this->base($review).($subtaskId ? '/subtasks/'.$subtaskId : '').'/comments';
        $this->call(fn () => $this->client->post($path, ['text' => mb_substr($text, 0, 2000)]));
    }

    public function renameTask(PmQaTaskReview $review, string $title): void
    {
        $title = $this->title($title);
        $path = blank($review->project_id) && filled($review->task_id) ? '/tasks/'.$review->task_id : $this->base($review);
        $this->call(fn () => $this->client->patch($path, ['title' => $title]));
        $review->forceFill(['task_title' => $title, 'qa_title' => null])->saveQuietly();
    }

    /**
     * Set the Taskmandu task's status (QA uses this to mark a passed task Completed).
     * Throws a ValidationException that says nothing was changed when Taskmandu refuses, so the caller
     * can stop before touching its own records.
     */
    public function setStatus(PmQaTaskReview $review, string $status): void
    {
        if (blank($review->task_id)) {
            throw ValidationException::withMessages(['task' => 'This QA item is not linked to a Taskmandu task, so its status can\'t be changed there.']);
        }
        try {
            if (blank($review->project_id)) {
                $this->client->patch('/tasks/'.$review->task_id.'/status', ['status' => $status]);
            } else {
                $this->client->patch($this->base($review), ['status' => $status]);
            }
        } catch (RuntimeException $e) {
            throw ValidationException::withMessages(['taskmandu' => "Taskmandu did not accept the change to {$status}, so nothing was changed here either. ".$e->getMessage()]);
        }
    }

    /**
     * Every Taskmandu project as [{id, name}], A to Z. Cached briefly because the QA tab reloads often.
     * Returns null when Taskmandu can't be reached; callers fall back to the projects already synced.
     *
     * @return array<int,array{id:string,name:string}>|null
     */
    public function projects(bool $fresh = false): ?array
    {
        if (! $this->client->configured()) {
            return null;
        }
        if ($fresh) {
            Cache::forget('pm.qa.taskmandu_projects');
        }
        $cached = Cache::get('pm.qa.taskmandu_projects');
        if (is_array($cached)) {
            return $cached['ok'] ? $cached['rows'] : null;
        }

        try {
            $rows = collect($this->client->paginate('/projects'))
                ->filter(fn ($p) => is_array($p) && filled($p['_id'] ?? null) && filled(trim((string) ($p['name'] ?? ''))))
                ->map(fn ($p) => ['id' => (string) $p['_id'], 'name' => trim((string) $p['name'])])
                ->unique('id')->sortBy('name', SORT_NATURAL | SORT_FLAG_CASE)->values()->all();
            Cache::put('pm.qa.taskmandu_projects', ['ok' => true, 'rows' => $rows], 300);

            return $rows;
        } catch (\Throwable $e) {
            report($e);
            Cache::put('pm.qa.taskmandu_projects', ['ok' => false, 'rows' => []], 60);

            return null;
        }
    }

    /** Create a project in Taskmandu and return it as {id, name}. */
    public function createProject(string $name): array
    {
        $name = mb_substr(trim($name), 0, 200);
        if ($name === '') {
            throw ValidationException::withMessages(['name' => 'Enter a project name.']);
        }
        $res = $this->call(fn () => $this->client->post('/projects', ['name' => $name, 'status' => 'Planning']));
        $id = (string) ($res['data']['_id'] ?? '');
        if ($id === '') {
            throw ValidationException::withMessages(['taskmandu' => 'Taskmandu created the project but did not return its id. Refresh and look for it in the list.']);
        }
        Cache::forget('pm.qa.taskmandu_projects');

        return ['id' => $id, 'name' => (string) ($res['data']['name'] ?? $name)];
    }

    // ------------------------------------------------------------------ internals

    private function base(PmQaTaskReview $review): string
    {
        if (blank($review->project_id) || blank($review->task_id)) {
            throw ValidationException::withMessages(['task' => 'This Taskmandu task is not in a project, so it has no subtasks. Its checks live only in the QA Center.']);
        }

        return '/projects/'.$review->project_id.'/tasks/'.$review->task_id;
    }

    private function fetchTask(PmQaTaskReview $review): array
    {
        if (blank($review->task_id)) {
            throw ValidationException::withMessages(['task' => 'This QA item is not linked to a Taskmandu task.']);
        }

        // A standalone task (not in a project) is read on its own.
        if (blank($review->project_id)) {
            $task = $this->call(fn () => $this->client->get('/tasks/'.$review->task_id))['data'] ?? null;
            if (is_array($task) && $task !== []) {
                return $task;
            }
            throw ValidationException::withMessages(['task' => 'Taskmandu no longer has this task.']);
        }

        $project = $this->call(fn () => $this->client->get('/projects/'.$review->project_id))['data'] ?? [];
        $found = $this->findTask($project['tasks'] ?? [], $review->task_id);

        // Taskmandu's single-project GET sometimes comes back without its tasks while the project list still
        // has them (the Project tab works around the same thing). Look in the list before giving up.
        if ($found === null) {
            foreach ($this->call(fn () => $this->client->paginate('/projects')) as $listed) {
                if (($listed['_id'] ?? null) === $review->project_id) {
                    $found = $this->findTask($listed['tasks'] ?? [], $review->task_id);
                    break;
                }
            }
        }

        return $found ?? throw ValidationException::withMessages(['task' => 'Taskmandu no longer has this task.']);
    }

    /** @param array<int,mixed> $tasks */
    private function findTask(array $tasks, string $taskId): ?array
    {
        foreach ($tasks as $task) {
            if (is_array($task) && ($task['_id'] ?? null) === $taskId) {
                return $task;
            }
        }

        return null;
    }

    private function call(callable $fn): array
    {
        try {
            return $fn() ?? [];
        } catch (RuntimeException $e) {
            throw ValidationException::withMessages(['taskmandu' => $e->getMessage()]);
        }
    }

    private function title(string $title): string
    {
        $title = trim($title);
        if ($title === '') {
            throw ValidationException::withMessages(['title' => 'Enter some text.']);
        }

        return mb_substr($title, 0, 200);
    }

    private function shapeSubtask(array $s): array
    {
        return [
            'id' => (string) ($s['_id'] ?? ''),
            'title' => (string) ($s['title'] ?? ''),
            'status' => $s['status'] ?? null,
            'comments' => $this->shapeComments($s['comments'] ?? []),
        ];
    }

    private function shapeComments(array $comments): array
    {
        return collect($comments)->filter(fn ($c) => is_array($c))->map(fn ($c) => [
            'id' => (string) ($c['_id'] ?? $c['id'] ?? ''),
            'text' => trim((string) ($c['text'] ?? $c['content'] ?? $c['message'] ?? '')),
            'author' => trim((string) ($c['authorName'] ?? $c['createdByName'] ?? $c['userName'] ?? '')) ?: null,
            'at' => $c['createdAt'] ?? $c['created_at'] ?? null,
        ])->filter(fn ($c) => $c['text'] !== '')->values()->all();
    }

    /** One check per Taskmandu subtask: link existing checks by title, add the missing ones, refresh titles. */
    private function reconcile(PmQaTaskReview $review, array $subtasks): void
    {
        $checks = PmQaCheck::query()->where('item_type', 'task')->where('item_id', $review->id)->get();
        $sort = (int) ($checks->max('sort') ?? -1);

        foreach ($subtasks as $s) {
            if ($s['id'] === '' || $s['title'] === '') {
                continue;
            }
            $linked = $checks->firstWhere('subtask_id', $s['id']);
            $byTitle = $checks->first(fn ($c) => blank($c->subtask_id) && mb_strtolower(trim($c->label)) === mb_strtolower(trim($s['title'])));
            if ($linked) {
                if ($linked->label !== mb_substr($s['title'], 0, 300)) {
                    $linked->update(['label' => mb_substr($s['title'], 0, 300)]);
                }
            } elseif ($byTitle) {
                $byTitle->update(['subtask_id' => $s['id']]);
            } elseif ($checks->count() < QaCenterService::MAX_CHECKS) {
                $checks->push(PmQaCheck::create(['item_type' => 'task', 'item_id' => $review->id, 'label' => mb_substr($s['title'], 0, 300), 'sort' => ++$sort, 'subtask_id' => $s['id']]));
            }
        }

        // A linked check whose subtask is gone from Taskmandu was deleted there; drop it here too.
        $ids = collect($subtasks)->pluck('id')->all();
        PmQaCheck::query()->where('item_type', 'task')->where('item_id', $review->id)->whereNotNull('subtask_id')->whereNotIn('subtask_id', $ids)->delete();
    }
}
