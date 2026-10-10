<?php

namespace App\Services\Pm;

use App\Models\PmTaskmanduEvent;
use Illuminate\Support\Carbon;

class TaskmanduActivityMinutesService
{
    public function build(string $from, string $to): array
    {
        $start = Carbon::parse($from)->startOfDay();
        $end = Carbon::parse($to)->endOfDay();
        $events = PmTaskmanduEvent::query()->whereBetween('occurred_at', [$start, $end])->orderBy('occurred_at')->get();
        $groups = [];
        $attendees = [];
        $summary = ['comments' => 0, 'task_status_changes' => 0, 'subtask_status_changes' => 0];

        foreach ($events as $event) {
            $key = ($event->project_id ?? 'no-project').':'.($event->task_id ?? 'no-task');
            if (!isset($groups[$key])) {
                $groups[$key] = [
                    'owner' => $event->owner_name ?? '',
                    'project' => $event->project_name ?? '',
                    'project_id' => $event->project_id,
                    'requirement' => $event->task_title ?? 'Taskmandu activity',
                    'discussion' => '',
                    'action_items' => [],
                    'due_date' => null,
                ];
            } elseif (blank($groups[$key]['owner']) && filled($event->owner_name)) {
                $groups[$key]['owner'] = $event->owner_name;
            }

            $at = $event->occurred_at?->format('Y-m-d H:i') ?? '';
            $actor = trim((string) $event->actor_name);
            if ($actor !== '') $attendees[$actor] = $actor;

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
            }

            $groups[$key]['discussion'] .= ($groups[$key]['discussion'] !== '' ? "\n" : '').$line;
        }

        $items = array_values($groups);
        usort($items, fn ($a, $b) => strcmp($a['project'].' '.$a['requirement'], $b['project'].' '.$b['requirement']));

        return [
            'from' => $from,
            'to' => $to,
            'title' => 'Taskmandu activity review — '.$from.' to '.$to,
            'activity_count' => $events->count(),
            'attendees' => array_values($attendees),
            'summary' => $summary,
            'work_items' => $items,
        ];
    }
}
