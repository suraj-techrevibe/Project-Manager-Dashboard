<?php

namespace App\Services\Pm;

use App\Models\PmQaCheck;
use App\Models\PmQaTaskReview;
use Illuminate\Validation\ValidationException;
use RuntimeException;

/**
 * Live Taskmandu data for a QA task item: the task's subtasks (the QA checklist), their comments,
 * and writes back to Taskmandu through its API. Nothing here is cached; each call reads the project.
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
        $path = $this->base($review).($subtaskId ? '/subtasks/'.$subtaskId : '').'/comments';
        $this->call(fn () => $this->client->post($path, ['text' => mb_substr($text, 0, 2000)]));
    }

    public function renameTask(PmQaTaskReview $review, string $title): void
    {
        $title = $this->title($title);
        $this->call(fn () => $this->client->patch($this->base($review), ['title' => $title]));
        $review->forceFill(['task_title' => $title, 'qa_title' => null])->saveQuietly();
    }

    // ------------------------------------------------------------------ internals

    private function base(PmQaTaskReview $review): string
    {
        if (blank($review->project_id) || blank($review->task_id)) {
            throw ValidationException::withMessages(['task' => 'This task is not part of a Taskmandu project, so it has no subtasks to load.']);
        }

        return '/projects/'.$review->project_id.'/tasks/'.$review->task_id;
    }

    private function fetchTask(PmQaTaskReview $review): array
    {
        $this->base($review);
        $project = $this->call(fn () => $this->client->get('/projects/'.$review->project_id))['data'] ?? [];
        foreach ($project['tasks'] ?? [] as $task) {
            if (($task['_id'] ?? null) === $review->task_id) {
                return $task;
            }
        }
        throw ValidationException::withMessages(['task' => 'Taskmandu no longer has this task.']);
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
