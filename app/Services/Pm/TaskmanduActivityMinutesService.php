<?php

namespace App\Services\Pm;

use App\Models\PmActivity;
use App\Models\PmCard;
use App\Models\PmTaskmanduEvent;
use Illuminate\Support\Carbon;

class TaskmanduActivityMinutesService
{
    /**
     * A daily meeting draft, grouped the way a daily standup actually reads:
     * - completed:   finished since the window opened — report it, stop carrying it
     * - progress:    still open, has new activity in this window
     * - in_progress: still open, no new activity — shown so it isn't silently dropped,
     *                not treated as a problem on its own
     * - due:         due today or already overdue — highlighted regardless of activity
     * - blocked:     Blocked status, or no movement for 3+ days — highlighted regardless of due date
     * - new_work:    first appeared on the board during this window
     *
     * A task is in exactly one bucket, checked in that order (blocked/overdue beats a quiet
     * "still in progress", but a quiet task is never promoted to "problem" just for being quiet).
     * Every item keeps its real project_id/task_id when the card has one, so pushing it again
     * updates the existing Taskmandu task instead of creating a duplicate.
     */
    public function build(string $from, string $to): array
    {
        $start = Carbon::parse($from)->startOfDay();
        $end = Carbon::parse($to)->endOfDay();
        $today = now()->startOfDay()->toDateString();

        [$groups, $attendees, $summary, $completedInWindow, $eventCount] = $this->groupEvents($start, $end);

        // Live board state for every still-relevant card, so a task with zero activity in this
        // window still shows up as "still in progress" instead of vanishing.
        $cards = PmCard::query()
            ->where(fn ($q) => $q->whereNotIn('status', ['Cancelled'])->orWhere('last_activity_at', '>=', $start))
            ->get()
            ->keyBy(fn (PmCard $c) => $this->key($c->project_id, $c->task_id));

        $newCardIds = PmActivity::query()
            ->where('type', 'created')->whereBetween('occurred_at', [$start, $end])
            ->pluck('card_id')->filter()->unique()->all();
        $newKeys = $cards->filter(fn (PmCard $c) => in_array($c->id, $newCardIds, true))->keys()->all();

        $sections = ['completed' => [], 'progress' => [], 'in_progress' => [], 'due' => [], 'blocked' => [], 'new_work' => []];
        $allKeys = array_unique(array_merge(array_keys($groups), $cards->keys()->all()));

        foreach ($allKeys as $key) {
            $card = $cards->get($key);
            $g = $groups[$key] ?? null;
            if (! $card && ! $g) {
                continue;
            }
            if ($card && $card->status === 'Cancelled') {
                continue;
            }

            $item = [
                'owner' => $card->assignee ?? ($g['owner'] ?? ''),
                'project' => $card->project_name ?? ($g['project'] ?? ''),
                // Kept when a real card matched, so pushing updates the existing task instead of
                // name-matching a project and risking a duplicate.
                'project_id' => $card->project_id ?? null,
                'requirement' => $card->title ?? ($g['requirement'] ?? 'Taskmandu activity'),
                'discussion' => $g['discussion'] ?? '',
                'due_date' => $card?->due_at?->toDateString(),
                'action_items' => [],
            ];

            if (($card && $card->status === 'Completed') || ($completedInWindow[$key] ?? false)) {
                $sections['completed'][] = $item + ['note' => 'Completed'.($item['due_date'] ? ' — was due '.$item['due_date'] : '')];
                continue;
            }

            if (in_array($key, $newKeys, true)) {
                $sections['new_work'][] = $item + ['note' => 'New on the board since '.$from];
                continue;
            }

            if ($card && $card->status === 'Blocked') {
                $sections['blocked'][] = $item + ['note' => 'Blocked'];
                continue;
            }
            if ($card && $card->last_activity_at && $card->last_activity_at->lte(now()->subDays(3)) && in_array($card->status, ['In Progress', 'Pending'], true)) {
                $days = (int) $card->last_activity_at->diffInDays(now(), true);
                $sections['blocked'][] = $item + ['note' => "No movement {$days} ".($days === 1 ? 'day' : 'days').' — at risk'];
                continue;
            }

            if ($item['due_date'] && $item['due_date'] < $today) {
                $days = (int) $card->due_at->diffInDays(now()->startOfDay(), true);
                $sections['due'][] = $item + ['note' => $days.' '.($days === 1 ? 'day' : 'days').' overdue'];
                continue;
            }
            if ($item['due_date'] === $today) {
                $sections['due'][] = $item + ['note' => 'Due today'];
                continue;
            }

            if ($g) {
                $sections['progress'][] = $item + ['note' => 'New update since '.$from];
            } else {
                $sections['in_progress'][] = $item + ['note' => 'No new update since last meeting'];
            }
        }

        return [
            'from' => $from,
            'to' => $to,
            'title' => 'Daily meeting — '.$to,
            'activity_count' => $eventCount,
            'attendees' => array_values($attendees),
            'summary' => $summary,
            'sections' => $sections,
        ];
    }

    private function key(?string $projectId, ?string $taskId): string
    {
        return ($projectId ?? 'no-project').':'.($taskId ?? 'no-task');
    }

    /** @return array{0: array<string, array<string, mixed>>, 1: array<string, string>, 2: array<string, int>, 3: array<string, bool>, 4: int} */
    private function groupEvents(Carbon $start, Carbon $end): array
    {
        $events = PmTaskmanduEvent::query()->whereBetween('occurred_at', [$start, $end])->orderBy('occurred_at')->get();
        $groups = [];
        $attendees = [];
        $summary = ['comments' => 0, 'task_status_changes' => 0, 'subtask_status_changes' => 0];
        $completedInWindow = [];

        foreach ($events as $event) {
            $key = $this->key($event->project_id, $event->task_id);
            if (! isset($groups[$key])) {
                $groups[$key] = [
                    'owner' => $event->owner_name ?? '',
                    'project' => $event->project_name ?? '',
                    'project_id' => $event->project_id,
                    'requirement' => $event->task_title ?? 'Taskmandu activity',
                    'discussion' => '',
                ];
            } elseif (blank($groups[$key]['owner']) && filled($event->owner_name)) {
                $groups[$key]['owner'] = $event->owner_name;
            }

            $at = $event->occurred_at?->format('Y-m-d H:i') ?? '';
            $actor = trim((string) $event->actor_name);
            if ($actor !== '') {
                $attendees[$actor] = $actor;
            }

            if ($event->event_type === 'comment') {
                $summary['comments']++;
                $prefix = $event->subtask_title ? 'Subtask "'.$event->subtask_title.'" comment' : 'Task comment';
                $line = '['.$at.'] '.($actor !== '' ? $actor.': ' : '').$prefix.': '.trim((string) $event->body);
            } elseif ($event->event_type === 'subtask_status') {
                $summary['subtask_status_changes']++;
                $line = '['.$at.'] Subtask "'.($event->subtask_title ?: 'Untitled subtask').'" status: '.($event->status_from ?: '—').' → '.($event->status_to ?: '—');
            } else {
                $summary['task_status_changes']++;
                $line = '['.$at.'] Task status: '.($event->status_from ?: '—').' → '.($event->status_to ?: '—');
                if ($event->status_to === 'Completed') {
                    $completedInWindow[$key] = true;
                }
            }

            $groups[$key]['discussion'] .= ($groups[$key]['discussion'] !== '' ? "\n" : '').$line;
        }

        return [$groups, $attendees, $summary, $completedInWindow, $events->count()];
    }
}
