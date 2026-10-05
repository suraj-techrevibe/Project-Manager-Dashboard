<?php

namespace App\Services\Pm;

use App\Models\PmActivity;
use App\Models\PmCard;
use App\Models\PmSubtask;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Str;

class FlagService
{
    private const DUE_SOON_DAYS = 3;

    /** card_id => ISO time of the last nudge, filled by all() for flag(). */
    private array $nudged = [];

    public function all(): Collection
    {
        $today = now()->startOfDay();
        $this->nudged = $this->lastNudges();

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

            // Not late yet, but about to be — the cheapest moment to act.
            if ($c->due_at && $c->due_at->gte($today)) {
                $in = (int) $today->diffInDays($c->due_at, true);
                if ($in === 0) {
                    $flags->push($this->flag($c, 'due_today', 'warning', 'Due today'));
                } elseif ($in <= self::DUE_SOON_DAYS) {
                    $flags->push($this->flag($c, 'due_soon', 'neutral', "Due in {$in} ".Str::plural('day', $in)));
                }
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
            'due_today' => $n['due_today'] ?? 0,
            'due_soon' => $n['due_soon'] ?? 0,
        ];
    }

    /**
     * Open sub-tasks that need a decision: nobody assigned, or blocked. Unassigned comes first —
     * those are the ones that silently never get done. Snoozed ones are hidden for 3 days.
     *
     * @return array<int, array<string, mixed>>
     */
    public function subtasks(): array
    {
        $today = now()->startOfDay();

        return PmSubtask::query()
            ->whereNotIn('status', ['Completed', 'Cancelled'])
            ->where(fn ($q) => $q->whereNull('snoozed_until')->orWhere('snoozed_until', '<', $today))
            ->get()
            ->map(function (PmSubtask $s) use ($today) {
                $issues = [];
                if (! $s->assignee) {
                    $issues[] = 'unassigned';
                }
                if ($s->status === 'Blocked') {
                    $issues[] = 'blocked';
                }
                if (! $issues) {
                    return null;
                }

                return [
                    'id' => $s->id,
                    'issues' => $issues,
                    'title' => $s->title,
                    'status' => $s->status,
                    'assignee' => $s->assignee,
                    'assigned_by' => $s->assigned_by,
                    'comments_count' => $s->comments_count,
                    'project_id' => $s->project_id,
                    'project_name' => $s->project_name,
                    'task_id' => $s->task_id,
                    'subtask_id' => $s->subtask_id,
                    'parent_title' => $s->parent_title,
                    'parent_assignee' => $s->parent_assignee,
                    'parent_due_at' => $s->parent_due_at?->toDateString(),
                    'parent_overdue' => (bool) ($s->parent_due_at && $s->parent_due_at->lt($today)),
                    'age_days' => $s->remote_created_at ? (int) $s->remote_created_at->diffInDays(now(), true) : null,
                ];
            })
            ->filter()
            // Unassigned first, then the ones sitting under an overdue parent, then oldest.
            ->sortBy(fn ($r) => [
                in_array('unassigned', $r['issues'], true) ? 0 : 1,
                $r['parent_overdue'] ? 0 : 1,
                -($r['age_days'] ?? 0),
            ])
            ->values()
            ->all();
    }

    /** @return array<int, string> card_id => ISO timestamp of its latest nudge */
    private function lastNudges(): array
    {
        try {
            return PmActivity::query()
                ->where('type', 'nudge')
                ->whereNotNull('card_id')
                ->selectRaw('card_id, max(occurred_at) as last_at')
                ->groupBy('card_id')
                ->pluck('last_at', 'card_id')
                ->map(fn ($at) => Carbon::parse($at)->toIso8601String())
                ->all();
        } catch (\Throwable $e) {
            report($e);

            return [];
        }
    }

    /**
     * Open (not done / cancelled) cards per person — snoozed cards still count,
     * snoozing only hides a flag, it doesn't lighten anyone's load.
     *
     * Hours: a card's estimate is split evenly between its assignees.
     *  - hours      = all open work
     *  - week_hours = open work due by the end of this week (overdue included)
     * Pass the Taskmandu staff list to also get people with no open tasks at all.
     *
     * @param  array<int, array{name: string, designation?: ?string}>  $staff
     * @return array<int, array<string, mixed>>
     */
    public function workload(array $staff = []): array
    {
        $today = now()->startOfDay();
        $weekEnd = now()->endOfWeek()->startOfDay();
        $capacity = (float) config('pm.weekly_capacity_hours', 40);
        $rows = [];

        $blank = fn (string $name, ?string $designation = null) => [
            'name' => $name,
            'designation' => $designation,
            'open' => 0,
            'overdue' => 0,
            'blocked' => 0,
            'due_today' => 0,
            'hours' => 0.0,
            'week_hours' => 0.0,
            'no_estimate' => 0,
            'subtasks' => 0,
            'capacity' => $capacity,
        ];

        PmCard::query()
            ->whereNotIn('status', ['Completed', 'Cancelled'])
            ->whereNotNull('assignee')
            ->get()
            ->each(function ($c) use (&$rows, $today, $weekEnd, $blank) {
                $names = array_values(array_filter(array_map('trim', explode(',', $c->assignee))));
                $share = $names ? ((float) $c->estimated_hours) / count($names) : 0.0;

                foreach ($names as $name) {
                    $rows[$name] ??= $blank($name);
                    $rows[$name]['open']++;
                    $rows[$name]['hours'] += $share;

                    if (! $c->estimated_hours) {
                        $rows[$name]['no_estimate']++;
                    }
                    if ($c->due_at && $c->due_at->lte($weekEnd)) {
                        $rows[$name]['week_hours'] += $share;
                    }
                    if ($c->due_at && $c->due_at->lt($today)) {
                        $rows[$name]['overdue']++;
                    }
                    if ($c->due_at && $c->due_at->equalTo($today)) {
                        $rows[$name]['due_today']++;
                    }
                    if ($c->status === 'Blocked') {
                        $rows[$name]['blocked']++;
                    }
                }
            });

        PmSubtask::query()
            ->whereNotIn('status', ['Completed', 'Cancelled'])
            ->whereNotNull('assignee')
            ->get()
            ->each(function ($s) use (&$rows, $blank) {
                foreach (array_filter(array_map('trim', explode(',', $s->assignee))) as $name) {
                    $rows[$name] ??= $blank($name);
                    $rows[$name]['open']++;
                    $rows[$name]['subtasks'] = ($rows[$name]['subtasks'] ?? 0) + 1;
                    if ($s->status === 'Blocked') {
                        $rows[$name]['blocked']++;
                    }
                }
            });

        foreach ($staff as $s) {
            $name = trim((string) ($s['name'] ?? ''));
            if ($name === '') {
                continue;
            }
            $rows[$name] ??= $blank($name);
            $rows[$name]['designation'] = $s['designation'] ?? null;
        }

        return collect($rows)
            ->map(fn ($r) => array_merge($r, [
                'hours' => round($r['hours'], 1),
                'week_hours' => round($r['week_hours'], 1),
            ]))
            ->sort(fn ($a, $b) => [$b['week_hours'], $b['open']] <=> [$a['week_hours'], $a['open']])
            ->values()
            ->all();
    }

    /**
     * What changed since the last working day, from pm_activities (written at
     * every sync). Also names the people with nothing open — the morning
     * stand-up in one strip.
     *
     * @param  array<int, array<string, mixed>>  $workload
     */
    public function sinceLastWorkday(array $workload = []): array
    {
        $today = now()->startOfDay();
        $since = $today->copy()->subDay();
        while ($since->isWeekend()) {
            $since->subDay();
        }

        $acts = PmActivity::query()
            ->where('occurred_at', '>=', $since)
            ->whereIn('type', ['status_change', 'created'])
            ->orderByDesc('occurred_at')
            ->get();

        $cards = PmCard::query()
            ->whereIn('id', $acts->pluck('card_id')->filter()->unique()->all())
            ->get()
            ->keyBy('id');

        $item = fn (PmCard $c, $at = null) => [
            'card_id' => $c->id,
            'title' => $c->title,
            'assignee' => $c->assignee,
            'project_id' => $c->project_id,
            'project_name' => $c->project_name,
            'task_id' => $c->task_id,
            'url' => $c->url,
            'at' => $at ? Carbon::parse($at)->toIso8601String() : null,
        ];

        $completed = $blocked = $created = [];
        foreach ($acts as $a) {
            $c = $cards->get($a->card_id);
            if (! $c) {
                continue;
            }
            $to = ($a->meta ?? [])['to'] ?? null;

            if ($a->type === 'created' && $c->status !== 'Cancelled' && $c->status !== 'Completed') {
                $created[$c->id] ??= $item($c, $a->occurred_at);
            } elseif ($to === 'Completed' && $c->status === 'Completed') {
                $completed[$c->id] ??= $item($c, $a->occurred_at);
            } elseif ($to === 'Blocked' && $c->status === 'Blocked') {
                $blocked[$c->id] ??= $item($c, $a->occurred_at);
            }
        }

        $overdue = PmCard::query()
            ->whereNotIn('status', ['Completed', 'Cancelled'])
            ->whereDate('due_at', '>=', $since)
            ->whereDate('due_at', '<', $today)
            ->get()
            ->map(fn ($c) => $item($c))
            ->all();

        $group = fn (array $items) => ['count' => count($items), 'items' => array_slice(array_values($items), 0, 8)];

        return [
            'since' => $since->toDateString(),
            'label' => $since->isYesterday() ? 'yesterday' : $since->format('l'),
            'tracked' => PmActivity::query()->exists(),
            'completed' => $group($completed),
            'blocked' => $group($blocked),
            'created' => $group($created),
            'overdue' => $group($overdue),
            'idle' => collect($workload)->where('open', 0)->pluck('name')->values()->all(),
        ];
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
        return $this->taskFields($c) + [
            'type' => $type,
            'severity' => $severity,
            'detail' => $detail,
        ];
    }

    /** The task fields every card needs, whether or not the task is flagged. */
    private function taskFields(PmCard $c): array
    {
        return [
            'card_id' => $c->id,
            'title' => $c->title,
            'assignee' => $c->assignee,
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
            'last_nudged_at' => $this->nudged[$c->id] ?? null,
            'description' => $c->description ? Str::limit(trim(strip_tags($c->description)), 160) : null,
        ];
    }

    /**
     * Every synced task — flagged or not, open or done, snoozed or not (only
     * Cancelled ones are left out) — for the Today tab's "All tasks" view.
     * Same shape as a flag's task fields, minus type/severity/detail.
     */
    public function tasks(int $limit = 1000): array
    {
        $this->nudged = $this->nudged ?: $this->lastNudges();

        return PmCard::query()
            ->where(fn ($q) => $q->whereNull('status')->orWhere('status', '!=', 'Cancelled'))
            ->orderByRaw('due_at is null')
            ->orderBy('due_at')
            ->limit($limit)
            ->get()
            ->map(fn ($c) => $this->taskFields($c))
            ->values()
            ->all();
    }
}
