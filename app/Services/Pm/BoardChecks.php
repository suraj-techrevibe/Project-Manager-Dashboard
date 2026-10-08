<?php

namespace App\Services\Pm;

use App\Models\PmCard;
use Illuminate\Support\Collection;
use Illuminate\Support\Str;

/**
 * Predefined "checklist" questions for the Ask tab. Every answer is computed
 * straight from the local pm_cards table (the copy `php artisan pm:sync`
 * pulls from Taskmandu) — no AI call, no API key.
 *
 * Unlike the Today tab, these ignore snoozing: asking "what is overdue?"
 * should list a snoozed task too (it is just marked "snoozed").
 */
class BoardChecks
{
    private const OVERLOAD_TASKS = 5;   // open tasks per person
    private const OVERLOAD_HOURS = 30;  // estimated hours per person
    private const STUCK_DAYS = 3;
    private const SOON_DAYS = 7;
    private const UNVERIFIED_DAYS = 14; // same window FlagService uses

    private const CHECKS = [
        'overdue' => 'What is overdue?',
        'due_soon' => 'What is due in the next 7 days?',
        'overloaded' => "Who's overloaded?",
        'blocked' => 'What is blocked?',
        'stuck' => 'What has no movement?',
        'unassigned' => 'What is unassigned?',
        'high_priority' => 'High-priority open tasks',
        'no_due_date' => 'Open tasks with no due date',
        'unverified' => 'Done but not verified',
        'by_project' => 'Progress by project',
        'snoozed' => 'What is snoozed?',
        'subtasks_incomplete' => 'Completed tasks with unfinished sub-tasks',
    ];

    public function list(): array
    {
        $out = [];
        foreach (self::CHECKS as $key => $label) {
            $out[] = ['key' => $key, 'label' => $label];
        }

        return $out;
    }

    public function has(string $key): bool
    {
        return array_key_exists($key, self::CHECKS);
    }

    public function run(string $key): array
    {
        $today = now()->startOfDay();

        return match ($key) {
            'overdue' => $this->overdue($today),
            'due_soon' => $this->dueSoon($today),
            'overloaded' => $this->overloaded($today),
            'blocked' => $this->blocked($today),
            'stuck' => $this->stuck($today),
            'unassigned' => $this->unassigned($today),
            'high_priority' => $this->highPriority($today),
            'no_due_date' => $this->noDueDate($today),
            'unverified' => $this->unverified($today),
            'by_project' => $this->byProject(),
            'snoozed' => $this->snoozed($today),
            'subtasks_incomplete' => $this->subtasksIncomplete(),
        };
    }

    /* ------------------------------------------------------------------ */

    private function open(): Collection
    {
        return PmCard::query()->whereNotIn('status', ['Completed', 'Cancelled'])->get();
    }

    private function overdue($today): array
    {
        $cards = $this->open()
            ->filter(fn ($c) => $c->due_at && $c->due_at->lt($today))
            ->sortBy(fn ($c) => $c->due_at->timestamp);

        $rows = $cards->map(function ($c) use ($today) {
            $d = (int) $c->due_at->diffInDays($today, true);

            return $this->row($c, $today, $d.' '.Str::plural('day', $d).' overdue · due '.$c->due_at->toDateString(), 'danger');
        });

        return $this->result('overdue', $rows, $rows->count().' overdue '.Str::plural('task', $rows->count()).', oldest first.', 'Nothing is overdue.');
    }

    private function dueSoon($today): array
    {
        $end = $today->copy()->addDays(self::SOON_DAYS);
        $cards = $this->open()
            ->filter(fn ($c) => $c->due_at && $c->due_at->gte($today) && $c->due_at->lte($end))
            ->sortBy(fn ($c) => $c->due_at->timestamp);

        $rows = $cards->map(function ($c) use ($today) {
            $d = (int) $today->diffInDays($c->due_at, true);
            $when = $d === 0 ? 'due today' : 'due in '.$d.' '.Str::plural('day', $d);

            return $this->row($c, $today, $when.' · '.$c->due_at->toDateString(), $d <= 1 ? 'warning' : 'neutral');
        });

        return $this->result('due_soon', $rows, $rows->count().' '.Str::plural('task', $rows->count()).' due within '.self::SOON_DAYS.' days.', 'Nothing is due in the next '.self::SOON_DAYS.' days.');
    }

    private function overloaded($today): array
    {
        $people = [];

        foreach ($this->open() as $c) {
            if (! $c->assignee) {
                continue;
            }
            foreach (array_filter(array_map('trim', explode(',', $c->assignee))) as $name) {
                $people[$name] ??= ['tasks' => 0, 'hours' => 0.0, 'overdue' => 0];
                $people[$name]['tasks']++;
                $people[$name]['hours'] += (float) $c->estimated_hours;
                if ($c->due_at && $c->due_at->lt($today)) {
                    $people[$name]['overdue']++;
                }
            }
        }

        uasort($people, fn ($a, $b) => [$b['tasks'], $b['hours']] <=> [$a['tasks'], $a['hours']]);

        $overloaded = 0;
        $rows = collect($people)->map(function ($p, $name) use (&$overloaded) {
            $heavy = $p['tasks'] >= self::OVERLOAD_TASKS || $p['hours'] >= self::OVERLOAD_HOURS;
            $overloaded += $heavy ? 1 : 0;
            $detail = $p['tasks'].' open · '.rtrim(rtrim(number_format($p['hours'], 1), '0'), '.').'h estimated · '.$p['overdue'].' overdue';

            return $this->plain((string) $name, $detail.($heavy ? ' · overloaded' : ''), $heavy ? 'danger' : 'neutral');
        });

        $summary = $overloaded.' of '.$rows->count().' '.Str::plural('person', $rows->count()).' look overloaded (≥'.self::OVERLOAD_TASKS.' open tasks or ≥'.self::OVERLOAD_HOURS.'h estimated). Busiest first.';

        return $this->result('overloaded', $rows, $summary, 'No open tasks with an assignee.');
    }

    private function blocked($today): array
    {
        $rows = $this->open()
            ->filter(fn ($c) => $c->status === 'Blocked')
            ->map(fn ($c) => $this->row($c, $today, 'Blocked'.($c->last_activity_at ? ' · last activity '.$c->last_activity_at->toDateString() : ''), 'warning'));

        return $this->result('blocked', $rows, $rows->count().' blocked '.Str::plural('task', $rows->count()).'.', 'Nothing is blocked.');
    }

    private function stuck($today): array
    {
        $cutoff = now()->subDays(self::STUCK_DAYS);
        $cards = $this->open()
            ->filter(fn ($c) => in_array($c->status, ['In Progress', 'Pending'], true)
                && $c->last_activity_at && $c->last_activity_at->lte($cutoff))
            ->sortBy(fn ($c) => $c->last_activity_at->timestamp);

        $rows = $cards->map(function ($c) use ($today) {
            $d = (int) $c->last_activity_at->diffInDays(now(), true);

            return $this->row($c, $today, "No movement {$d} days · {$c->status}", 'warning');
        });

        return $this->result('stuck', $rows, $rows->count().' '.Str::plural('task', $rows->count()).' with no activity for '.self::STUCK_DAYS.'+ days, longest first.', 'Everything in progress has moved recently.');
    }

    private function unassigned($today): array
    {
        $rows = $this->open()
            ->filter(fn ($c) => ! $c->assignee)
            ->map(fn ($c) => $this->row($c, $today, 'Unassigned · '.$c->status, 'warning'));

        return $this->result('unassigned', $rows, $rows->count().' unassigned '.Str::plural('task', $rows->count()).'.', 'Every open task has an assignee.');
    }

    private function highPriority($today): array
    {
        $rank = ['Critical' => 0, 'High' => 1];
        $cards = $this->open()
            ->filter(fn ($c) => isset($rank[$c->priority]))
            ->sortBy(fn ($c) => [$rank[$c->priority], $c->due_at ? $c->due_at->timestamp : PHP_INT_MAX]);

        $rows = $cards->map(function ($c) use ($today) {
            $due = $c->due_at ? 'due '.$c->due_at->toDateString() : 'no due date';

            return $this->row($c, $today, "{$c->priority} · {$due} · {$c->status}", $c->priority === 'Critical' ? 'danger' : 'warning');
        });

        return $this->result('high_priority', $rows, $rows->count().' High/Critical open '.Str::plural('task', $rows->count()).'.', 'No open High or Critical tasks.');
    }

    private function noDueDate($today): array
    {
        $rows = $this->open()
            ->filter(fn ($c) => ! $c->due_at)
            ->map(fn ($c) => $this->row($c, $today, 'No due date · '.$c->status));

        return $this->result('no_due_date', $rows, $rows->count().' open '.Str::plural('task', $rows->count()).' without a due date.', 'Every open task has a due date.');
    }

    private function unverified($today): array
    {
        $cards = PmCard::query()
            ->where('status', 'Completed')
            ->where('verified', false)
            ->get()
            ->filter(fn ($c) => $c->last_activity_at && $c->last_activity_at->gte(now()->subDays(self::UNVERIFIED_DAYS)))
            ->sortBy(fn ($c) => $c->last_activity_at->timestamp);

        $rows = $cards->map(fn ($c) => $this->row($c, $today, 'Marked done · last activity '.$c->last_activity_at->toDateString()));

        return $this->result('unverified', $rows, $rows->count().' completed '.Str::plural('task', $rows->count()).' still unverified (last '.self::UNVERIFIED_DAYS.' days).', 'No completed tasks waiting for verification.');
    }

    private function byProject(): array
    {
        $today = now()->startOfDay();
        $groups = PmCard::query()->where('status', '!=', 'Cancelled')->get()
            ->groupBy(fn ($c) => $this->projectId($c) ?? 'standalone');

        $rows = $groups->map(function (Collection $cards, $key) use ($today) {
            $done = $cards->where('status', 'Completed')->count();
            $open = $cards->count() - $done;
            $overdue = $cards->filter(fn ($c) => $c->status !== 'Completed' && $c->due_at && $c->due_at->lt($today))->count();
            $blocked = $cards->where('status', 'Blocked')->count();
            $pct = $cards->count() ? (int) round($done / $cards->count() * 100) : 0;
            $name = $key === 'standalone' ? 'Standalone tasks' : ($cards->first()->project_name ?: 'Unnamed project');

            return $this->plain(
                $name,
                "{$pct}% done · {$open} open · {$done} done · {$overdue} overdue · {$blocked} blocked",
                $overdue > 0 ? 'danger' : ($blocked > 0 ? 'warning' : 'neutral'),
                $key === 'standalone' ? null : (string) $key,
                $overdue,
            );
        })->sortByDesc('_sort')->values();

        return $this->result('by_project', $rows, $rows->count().' '.Str::plural('project', $rows->count()).', most overdue first.', 'No tasks synced yet — run php artisan pm:sync.');
    }

    private function subtasksIncomplete(): array
    {
        $cards = PmCard::query()
            ->where('status', 'Completed')
            ->where('subtasks_count', '>', 0)
            ->whereColumn('subtasks_completed_count', '<', 'subtasks_count')
            ->orderByDesc('subtasks_count')
            ->get();

        $rows = $cards->map(fn ($c) => $this->row(
            $c,
            now()->startOfDay(),
            "Completed task still has ".max(0, (int) $c->subtasks_count - (int) $c->subtasks_completed_count)." unfinished sub-task".((int) $c->subtasks_count - (int) $c->subtasks_completed_count === 1 ? '' : 's'),
            'warning'
        ));

        return $this->result(
            'subtasks_incomplete',
            $rows,
            $rows->count().' completed '.Str::plural('task', $rows->count()).' still have unfinished sub-tasks.',
            'All completed tasks have all sub-tasks completed.'
        );
    }

    private function snoozed($today): array
    {
        $rows = PmCard::query()->whereDate('snoozed_until', '>=', $today)->get()
            ->sortBy(fn ($c) => $c->snoozed_until->timestamp)
            ->map(fn ($c) => $this->row($c, $today, 'Hidden from Today until '.$c->snoozed_until->toDateString().' · '.$c->status));

        return $this->result('snoozed', $rows, $rows->count().' snoozed '.Str::plural('task', $rows->count()).'.', 'Nothing is snoozed.');
    }

    /* ------------------------------------------------------------------ */

    private function result(string $key, Collection $rows, string $summary, string $empty): array
    {
        return [
            'key' => $key,
            'label' => self::CHECKS[$key],
            'summary' => $rows->isEmpty() ? $empty : $summary,
            'rows' => $rows->map(fn ($r) => collect($r)->except('_sort')->all())->values()->all(),
        ];
    }

    /** A row for one task card. */
    private function row(PmCard $c, $today, string $detail, string $severity = 'neutral'): array
    {
        if ($c->snoozed_until && $c->snoozed_until->gte($today)) {
            $detail .= ' · snoozed';
        }

        return [
            'title' => $c->title,
            'sub' => $c->project_name ?: 'Standalone task',
            'assignee' => $c->assignee ?: 'Unassigned',
            'detail' => $detail,
            'severity' => $severity,
            'project_id' => $this->projectId($c),
            'task_id' => $c->task_id,
            'url' => $c->url,
        ];
    }

    /** A row that isn't a single task (a person, a project). */
    private function plain(string $title, string $detail, string $severity, ?string $projectId = null, int $sort = 0): array
    {
        return [
            'title' => $title,
            'sub' => null,
            'assignee' => null,
            'detail' => $detail,
            'severity' => $severity,
            'project_id' => $projectId,
            'task_id' => null,
            'url' => null,
            '_sort' => $sort,
        ];
    }

    /** Older cards may lack project_id but carry ".../projects/<id>" in url. */
    private function projectId(PmCard $c): ?string
    {
        if ($c->project_id) {
            return $c->project_id;
        }

        return preg_match('#/projects/([0-9a-fA-F]{24})#', (string) $c->url, $m) ? $m[1] : null;
    }
}
