<?php

namespace App\Services\Pm;

use App\Models\PmCard;
use Illuminate\Support\Collection;
use Illuminate\Support\Str;

class FlagService
{
    public function all(): Collection
    {
        $today = now()->startOfDay();

        $cards = PmCard::query()
            ->where(fn ($q) => $q->whereNull('snoozed_until')->orWhere('snoozed_until', '<', $today))
            ->get();

        $flags = collect();

        // Statuses match Taskmandu's TASK_STATUSES enum: Assigned, Pending,
        // In Progress, Blocked, Completed, Cancelled.
        foreach ($cards as $c) {
            if ($c->status === 'Cancelled') {
                continue; // dead task, nothing to flag
            }

            if ($c->status === 'Completed') {
                if (! $c->verified && $c->last_activity_at?->gte(now()->subDays(14))) {
                    $flags->push($this->flag($c, 'unverified', 'neutral', 'Marked done, not verified'));
                }
                continue;
            }

            if ($c->due_at && $c->due_at->lt($today)) {
                $d = (int) $c->due_at->diffInDays($today, true);
                $flags->push($this->flag($c, 'overdue', 'danger', $d.' '.Str::plural('day', $d).' overdue'));
            }

            if ($c->status === 'Blocked') {
                $flags->push($this->flag($c, 'blocked', 'warning', 'Blocked'));
            }

            if (in_array($c->status, ['In Progress', 'Pending'], true)
                && $c->last_activity_at?->lte(now()->subDays(3))) {
                $d = (int) $c->last_activity_at->diffInDays(now(), true);
                $flags->push($this->flag($c, 'stuck', 'warning', "No movement {$d} days"));
            }

            if (! $c->assignee) {
                $flags->push($this->flag($c, 'unassigned', 'warning', 'Unassigned'));
            }
        }

        $rank = ['danger' => 0, 'warning' => 1, 'neutral' => 2];

        return $flags->sortBy(fn ($f) => $rank[$f['severity']])->values();
    }

    public function metrics(Collection $flags): array
    {
        $n = $flags->countBy('type');

        return [
            'overdue' => $n['overdue'] ?? 0,
            'stuck' => $n['stuck'] ?? 0,
            'blocked' => $n['blocked'] ?? 0,
            'unverified' => $n['unverified'] ?? 0,
            'unassigned' => $n['unassigned'] ?? 0,
        ];
    }

    /**
     * Open (not done / cancelled) cards per person — snoozed cards still count,
     * snoozing only hides a flag, it doesn't lighten anyone's load.
     *
     * @return array<int, array{name: string, open: int, overdue: int, blocked: int}>
     */
    public function workload(): array
    {
        $today = now()->startOfDay();
        $rows = [];

        PmCard::query()
            ->whereNotIn('status', ['Completed', 'Cancelled'])
            ->whereNotNull('assignee')
            ->get()
            ->each(function ($c) use (&$rows, $today) {
                foreach (array_filter(array_map('trim', explode(',', $c->assignee))) as $name) {
                    $rows[$name] ??= ['name' => $name, 'open' => 0, 'overdue' => 0, 'blocked' => 0];
                    $rows[$name]['open']++;

                    if ($c->due_at && $c->due_at->lt($today)) {
                        $rows[$name]['overdue']++;
                    }
                    if ($c->status === 'Blocked') {
                        $rows[$name]['blocked']++;
                    }
                }
            });

        return collect($rows)->sortByDesc('open')->values()->all();
    }

    public function snapshot(): string
    {
        $byCard = $this->all()->groupBy('card_id');

        return PmCard::query()
            ->where(fn ($q) => $q->whereNotIn('status', ['Completed', 'Cancelled'])->orWhere('last_activity_at', '>=', now()->subDays(14)))
            ->get()
            ->map(fn ($c) => [
                'id' => $c->id,
                'title' => $c->title,
                'project' => $c->project_name,
                'assignee' => $c->assignee,
                'status' => $c->status,
                'priority' => $c->priority,
                'due' => $c->due_at?->toDateString(),
                'last_activity' => $c->last_activity_at?->toDateString(),
                'subtasks' => $c->subtasks_count,
                'verified' => $c->verified,
                'flags' => $byCard->get($c->id, collect())->pluck('detail')->all(),
            ])
            ->toJson();
    }

    private function flag(PmCard $c, string $type, string $severity, string $detail): array
    {
        return [
            'card_id' => $c->id,
            'title' => $c->title,
            'assignee' => $c->assignee,
            'type' => $type,
            'severity' => $severity,
            'detail' => $detail,
            'url' => $c->url,
            'project_id' => $c->project_id,
            'project_name' => $c->project_name,
            'task_id' => $c->task_id,
            'status' => $c->status,
            'priority' => $c->priority,
            'due_at' => $c->due_at?->toDateString(),
            'estimated_hours' => $c->estimated_hours,
            'tags' => $c->tags ?? [],
            'subtasks_count' => $c->subtasks_count,
            'comments_count' => $c->comments_count,
            'assigned_by' => $c->assigned_by,
            'last_activity_at' => $c->last_activity_at?->toIso8601String(),
            'description' => $c->description ? Str::limit(trim(strip_tags($c->description)), 160) : null,
        ];
    }
}
