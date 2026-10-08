<?php

namespace App\Services\Pm;

use App\Models\MeetingMinutes;
use App\Models\PmCard;
use App\Models\PmSubtask;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Str;

/**
 * Closes the loop between meetings and the board.
 *
 *  - latest(): where each Work Item of the most recent meeting stands now (done, in progress, overdue,
 *    blocked, stuck, not pushed) — shown on Today and in the morning digest.
 *  - carryOver(): what to start the next meeting's minutes with — the unfinished Work Items of the last
 *    meeting plus overdue / blocked / stuck tasks that were never on a meeting.
 *
 * A Work Item is matched to its Taskmandu task the same way Brief's push does: same project and same title
 * (case, punctuation and spacing ignored), so nothing has to be stored on the minutes.
 */
class MeetingFollowUpService
{
    /** Lower rank = needs you sooner. */
    private const RANK = [
        'blocked' => 0, 'overdue' => 1, 'stuck' => 2, 'not_pushed' => 3,
        'not_started' => 4, 'in_progress' => 5, 'done' => 6, 'cancelled' => 7,
    ];

    public function __construct(private FlagService $flags) {}

    /**
     * @return array{meeting: array<string, mixed>, items: array<int, array<string, mixed>>, counts: array<string, int>}|null
     */
    public function latest(): ?array
    {
        $minute = $this->latestMinute();
        if (! $minute) {
            return null;
        }

        $items = collect($this->evaluate($minute))
            ->map(fn (array $r) => $r['item'])
            ->sortBy(fn (array $i) => self::RANK[$i['state']])
            ->values()
            ->all();

        $counts = ['total' => count($items)] + array_fill_keys(array_keys(self::RANK), 0);
        foreach ($items as $i) {
            $counts[$i['state']]++;
        }

        return ['meeting' => $this->describe($minute), 'items' => $items, 'counts' => $counts];
    }

    /**
     * Work Items for a new meeting's minutes, shaped like MeetingWorkItem (plus a `note` saying why each is here).
     *
     * @return array{from: ?array<string, mixed>, work_items: array<int, array<string, mixed>>, from_meeting: int, from_board: int}
     */
    public function carryOver(): array
    {
        $minute = $this->latestMinute();
        $today = now()->toDateString();
        $workItems = [];
        $covered = [];

        if ($minute) {
            foreach ($this->evaluate($minute) as $r) {
                if ($r['card']) {
                    $covered[$r['card']->id] = true;
                }
                if (in_array($r['item']['state'], ['done', 'cancelled'], true)) {
                    continue;
                }

                $w = $r['w'];
                // The discussion is carried over unchanged: pushing the item again updates the task's
                // description, so it must not be replaced by a note about why the item is back.
                // Taskmandu sub-tasks have no due-date field of their own, so when the leftover action
                // items come from the live board (not from the original minutes), recover each one's due
                // date — if it has one — from the matching action item of the meeting it came from.
                $actions = $r['card'] && $r['subs']->isNotEmpty()
                    ? $this->openSubtaskActions($r['subs'], $w['action_items'] ?? [], $today)
                    : array_values(array_map(
                        fn (array $a) => ['task' => trim((string) $a['task']), 'due_date' => $this->future($a['due_date'] ?? null, $today)],
                        array_filter($w['action_items'] ?? [], fn ($a) => trim((string) ($a['task'] ?? '')) !== '')
                    ));

                $workItems[] = [
                    'owner' => trim((string) ($w['owner'] ?? '')),
                    'project' => trim((string) ($w['project'] ?? '')),
                    'project_id' => null,
                    'requirement' => trim((string) $w['requirement']),
                    'discussion' => (string) ($w['discussion'] ?? ''),
                    'due_date' => $this->future($w['due_date'] ?? null, $today),
                    'action_items' => $actions,
                    'note' => 'From “'.$minute->title.'”: '.$r['item']['detail'],
                ];
            }
        }
        $fromMeeting = count($workItems);

        $limit = max(0, (int) config('pm.followup.carry_board_limit', 12));
        $byCard = $this->flags->all()->whereIn('type', ['overdue', 'blocked', 'stuck'])->groupBy('card_id');
        $cards = PmCard::query()->whereIn('id', $byCard->keys()->all())->get()->keyBy('id');
        $fromBoard = 0;

        foreach ($byCard as $cardId => $flags) {
            $card = $cards->get($cardId);
            if (! $card || isset($covered[$cardId]) || $fromBoard >= $limit) {
                continue;
            }

            $subs = $card->task_id ? PmSubtask::query()->where('task_id', $card->task_id)->get() : collect();
            $workItems[] = [
                // assignee can be "A, B" for a multi-assignee task — the Owner field is a single-select of
                // exact employee names, so a joined string matches nothing and shows up as if no owner carried.
                'owner' => $this->firstName($card->assignee),
                'project' => (string) ($card->project_name ?? ''),
                'project_id' => null,
                'requirement' => $card->title,
                'discussion' => (string) ($card->description ?? ''),
                'due_date' => $card->due_at?->toDateString(),
                'action_items' => $this->openSubtaskActions($subs, [], $today),
                'note' => 'On the board: '.$flags->pluck('detail')->unique()->implode(' · '),
            ];
            $fromBoard++;
        }

        return [
            'from' => $minute ? $this->describe($minute) : null,
            'work_items' => $workItems,
            'from_meeting' => $fromMeeting,
            'from_board' => $fromBoard,
        ];
    }

    /** The newest meeting with Work Items that is still recent enough to follow up on. */
    private function latestMinute(): ?MeetingMinutes
    {
        $cutoff = now()->subDays(max(1, (int) config('pm.followup.max_age_days', 14)))->toDateString();

        foreach (MeetingMinutes::query()->orderByDesc('meeting_date')->orderByDesc('id')->limit(15)->get() as $m) {
            if ($m->meeting_date && $m->meeting_date->toDateString() < $cutoff) {
                return null; // newest first, so everything after this is older still
            }
            if ($this->workItems($m)) {
                return $m;
            }
        }

        return null;
    }

    /** @return array<int, array<string, mixed>> */
    private function workItems(MeetingMinutes $m): array
    {
        return array_values(array_filter(
            is_array($m->work_items) ? $m->work_items : [],
            fn ($w) => is_array($w) && trim((string) ($w['requirement'] ?? '')) !== ''
        ));
    }

    /** @return array<string, mixed> */
    private function describe(MeetingMinutes $m): array
    {
        $date = $m->meeting_date;

        return [
            'id' => $m->id,
            'title' => $m->title,
            'meeting_date' => $date?->toDateString(),
            'days_ago' => $date ? (int) $date->diffInDays(now()->startOfDay(), true) : null,
        ];
    }

    /**
     * Each Work Item with the task it became (if any), its state and its sub-tasks.
     *
     * @return array<int, array{w: array<string, mixed>, card: ?PmCard, subs: Collection, item: array<string, mixed>}>
     */
    private function evaluate(MeetingMinutes $minute): array
    {
        $today = now()->startOfDay();
        $cards = PmCard::query()->whereNotNull('task_id')->orderBy('id')->get();

        $pairs = array_map(fn (array $w) => [$w, $this->cardFor($w, $cards)], $this->workItems($minute));

        $taskIds = collect($pairs)->map(fn (array $p) => $p[1]?->task_id)->filter()->unique()->values()->all();
        $subs = $taskIds ? PmSubtask::query()->whereIn('task_id', $taskIds)->get()->groupBy('task_id') : collect();

        $rows = [];
        foreach ($pairs as [$w, $card]) {
            [$state, $detail] = $this->state($card, $today);
            $own = $card ? $subs->get($card->task_id, collect())->where('status', '!=', 'Cancelled') : collect();

            $rows[] = [
                'w' => $w,
                'card' => $card,
                'subs' => $own,
                'item' => [
                    'requirement' => trim((string) $w['requirement']),
                    'owner' => trim((string) ($w['owner'] ?? '')) ?: null,
                    'assignee' => $card?->assignee,
                    'project' => $card?->project_name ?: (trim((string) ($w['project'] ?? '')) ?: null),
                    'state' => $state,
                    'detail' => $detail,
                    'due' => $card?->due_at?->toDateString() ?? ($w['due_date'] ?? null),
                    'subtasks' => $own->isNotEmpty() ? ['done' => $own->where('status', 'Completed')->count(), 'total' => $own->count()] : null,
                    'url' => $card?->url,
                    'card_id' => $card?->id,
                ],
            ];
        }

        return $rows;
    }

    private function cardFor(array $w, Collection $cards): ?PmCard
    {
        $title = self::key((string) $w['requirement']);
        $sameTitle = $cards->filter(fn (PmCard $c) => self::key($c->title) === $title);

        // A project link saved with the minutes wins; otherwise the project's name decides.
        if (! empty($w['project_id']) && ($hit = $sameTitle->firstWhere('project_id', $w['project_id']))) {
            return $hit;
        }

        $project = self::key((string) ($w['project'] ?? ''));

        return $sameTitle->first(fn (PmCard $c) => $project === ''
            ? $c->project_id === null
            : self::key((string) $c->project_name) === $project);
    }

    /** @return array{0: string, 1: string} state and a short human detail */
    private function state(?PmCard $c, Carbon $today): array
    {
        if (! $c) {
            return ['not_pushed', 'Not in Taskmandu yet'];
        }

        $late = null;
        if ($c->due_at && $c->due_at->lt($today)) {
            $d = (int) $c->due_at->diffInDays($today, true);
            $late = $d.' '.Str::plural('day', $d).' overdue';
        }

        return match (true) {
            $c->status === 'Completed' => ['done', $c->verified ? 'Done · verified' : 'Done'],
            $c->status === 'Cancelled' => ['cancelled', 'Cancelled'],
            $c->status === 'Blocked' => ['blocked', 'Blocked'.($late ? ' · '.$late : '')],
            $late !== null => ['overdue', $late],
            in_array($c->status, ['In Progress', 'Pending'], true) && $c->last_activity_at?->lte(now()->subDays(3)) => [
                'stuck', 'No movement '.(int) $c->last_activity_at->diffInDays(now(), true).' days',
            ],
            $c->status === 'In Progress' => ['in_progress', 'In progress'],
            default => ['not_started', 'Not started'],
        };
    }

    /**
     * Leftover (not completed/cancelled) sub-tasks as action items. Taskmandu sub-tasks carry no due date of
     * their own, so each one's due date (if any) is recovered by matching its title against the original
     * meeting's action items — the only place a due date for it was ever recorded.
     *
     * @param  array<int, array<string, mixed>>  $originalActions
     * @return array<int, array{task: string, due_date: string|null}>
     */
    private function openSubtaskActions(Collection $subs, array $originalActions, string $today): array
    {
        $dueByTitle = collect($originalActions)
            ->filter(fn ($a) => trim((string) ($a['task'] ?? '')) !== '')
            ->mapWithKeys(fn ($a) => [self::key((string) $a['task']) => $a['due_date'] ?? null]);

        return $subs->whereNotIn('status', ['Completed', 'Cancelled'])
            ->map(fn ($s) => [
                'task' => (string) $s->title,
                'due_date' => $this->future($dueByTitle->get(self::key((string) $s->title)), $today),
            ])
            ->values()
            ->all();
    }

    /** "Jane Doe, Sam Lee" -> "Jane Doe" — a multi-assignee task has no single owner the Work Item form can select. */
    private function firstName(?string $names): string
    {
        if (! $names) {
            return '';
        }

        return trim(explode(',', $names)[0]);
    }

    private function future(?string $date, string $today): ?string
    {
        return $date && $date >= $today ? $date : null;
    }

    private static function key(string $s): string
    {
        return trim((string) preg_replace('/[^\p{L}\p{N}]+/u', ' ', Str::lower($s)));
    }
}
