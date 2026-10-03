<?php

namespace App\Services\Pm;

use App\Models\PmActivity;
use App\Models\PmCard;
use App\Models\PmReport;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use RuntimeException;

/**
 * Builds the daily and weekly reports.
 *
 * Daily = what CHANGED that day (completed, moved, newly blocked/overdue, comments),
 * plus a one-line board summary and a short "needs attention" list for things that
 * have been stuck for a while. A task that takes four days does not appear four
 * times: it shows up on the day it moves and, if it stalls, once in the ageing list.
 *
 * Weekly = the standing picture: completed by project, what is still open and for
 * how long, blocked/overdue, team workload, and a comparison with last week.
 *
 * Everything except the custom-text split comes straight from the database (no AI).
 * Honest limits: status changes and new comments are seen at sync time, so they
 * are as precise as the sync interval; "still open" lists show the board as of
 * generation; a task worked on all day with no status change and no comment
 * leaves no trace unless it is mentioned in the custom text.
 */
class ReportService
{
    private const OPEN_EXCLUDED = ['Completed', 'Cancelled'];

    /** Tasks blocked/overdue this many days or more get a line in the daily "needs attention". */
    private const AGEING_DAYS = 3;

    public function __construct(private ClaudeClient $claude) {}

    public static function normalizeDate(Carbon $date, string $kind): Carbon
    {
        return $kind === 'weekly' ? $date->copy()->startOfWeek(Carbon::MONDAY) : $date->copy()->startOfDay();
    }

    /** Builds, renders and saves the report (replacing any existing one of that kind and date). */
    public function generate(Carbon $date, ?string $notes, string $preparedBy, bool $auto = false, string $kind = 'daily'): PmReport
    {
        $kind = $kind === 'weekly' ? 'weekly' : 'daily';
        $date = self::normalizeDate($date, $kind);
        $notes = filled($notes) ? trim($notes) : null;

        $content = $kind === 'weekly'
            ? $this->buildWeekly($date, $notes, $preparedBy)
            : $this->buildDaily($date, $notes, $preparedBy);

        return PmReport::updateOrCreate(
            ['kind' => $kind, 'report_date' => $date->toDateString()],
            [
                'content' => $content,
                'body' => $this->render($content),
                'notes' => $notes,
                'generated_by' => $preparedBy,
                'auto' => $auto,
            ]
        );
    }

    /* ================================================================== */
    /* Daily                                                                */
    /* ================================================================== */

    public function buildDaily(Carbon $day, ?string $notes, string $preparedBy): array
    {
        $dayEnd = $day->copy()->endOfDay();
        $activities = $this->activities($day, $dayEnd);

        $cards = PmCard::query()->get();
        $byId = $cards->keyBy('id');
        $open = $cards->reject(fn ($c) => in_array($c->status, self::OPEN_EXCLUDED, true));

        // ---- What changed --------------------------------------------
        [$completed, $moved, $newlyBlocked, $unblocked] = $this->classify($activities, $byId);

        // Finished before status history existed (or between syncs): fall back to last activity that day.
        $tracked = PmActivity::query()->where('type', 'status_change')->pluck('card_id')->filter()->unique()->flip();
        foreach ($cards as $c) {
            if ($c->status === 'Completed' && ! $tracked->has($c->id) && ! $completed->has($c->id)
                && $c->last_activity_at && $c->last_activity_at->between($day, $dayEnd)) {
                $completed->put($c->id, $this->item($c));
            }
        }
        $completed = $completed->values();

        $newTasks = $activities->whereIn('type', ['created', 'pushed'])
            ->unique('card_id')
            ->map(fn ($a) => $this->item($byId->get($a->card_id), $a->title, $a->meta))
            ->values();

        $comments = $activities->where('type', 'comment')->groupBy('card_id')
            ->map(fn ($g) => $this->item($byId->get($g->first()->card_id), $g->first()->title, $g->first()->meta, [
                'comments' => (int) $g->sum(fn ($a) => $a->meta['count'] ?? 1),
            ]))
            ->values();

        $yesterday = $day->copy()->subDay()->toDateString();
        $newlyOverdue = $open
            ->filter(fn ($c) => $c->due_at?->toDateString() === $yesterday)
            ->map(fn ($c) => $this->item($c, extra: ['due' => $c->due_at->toDateString()]))
            ->values();

        // ---- Board summary (numbers only) + things stuck for a while -------
        $board = [
            'open' => $open->count(),
            'in_progress' => $open->where('status', 'In Progress')->count(),
            'blocked' => $open->where('status', 'Blocked')->count(),
            'overdue' => $open->filter(fn ($c) => $c->due_at && $c->due_at->lt($day))->count(),
        ];
        $prev = PmReport::query()->where('kind', 'daily')->where('report_date', '<', $day->toDateString())
            ->orderByDesc('report_date')->first()?->content['board'] ?? null;

        $ageing = $this->ageing($open, $day, self::AGEING_DAYS);
        $attention = collect($ageing['blocked'])->merge($ageing['overdue'])
            ->sortByDesc('days')->take(10)->values()->all();

        // ---- Notes, my actions, plan ------------------------------------------
        $split = $this->splitIfAny($notes);

        $plan = [];
        $tomorrow = $day->copy()->addDay()->toDateString();
        foreach ($open->filter(fn ($c) => $c->due_at?->toDateString() === $tomorrow) as $c) {
            $plan[] = 'Due tomorrow: “'.$c->title.'”'.($c->assignee ? ' ('.$c->assignee.')' : ' (unassigned)');
        }
        $plan = array_merge($plan, $split['plan']);

        $summary = [
            'completed' => $completed->count(),
            'moved' => $moved->count(),
            'newly_blocked' => $newlyBlocked->count(),
            'newly_overdue' => $newlyOverdue->count(),
            'new_tasks' => $newTasks->count(),
        ];

        return [
            'kind' => 'daily',
            'date' => $day->toDateString(),
            'label' => $day->format('l, j F Y'),
            'prepared_by' => $preparedBy,
            'summary' => $summary,
            'summary_text' => $this->dailySummaryText($summary, $unblocked->count()),
            'pills' => $this->pills([
                [$summary['completed'], 'done', 'green'],
                [$summary['moved'], 'moved', 'slate'],
                [$summary['newly_blocked'], 'newly blocked', 'red'],
                [$summary['newly_overdue'], 'newly overdue', 'amber'],
            ]),
            'board' => $board,
            'board_text' => $this->boardText($board, $prev),
            'completed' => $completed->all(),
            'new_tasks' => $newTasks->all(),
            'moved' => $moved->all(),
            'comments' => $comments->all(),
            'newly_blocked' => $newlyBlocked->all(),
            'blocker_notes' => $split['blockers'],
            'unblocked' => $unblocked->all(),
            'newly_overdue' => $newlyOverdue->all(),
            'attention' => $attention,
            'team' => $this->teamToday($completed, $moved, $newlyBlocked, $comments),
            'my_actions' => array_merge($this->actionLines($activities), $split['my_actions']),
            'plan' => $plan,
            'notes' => $split['notes'],
            'notes_ai' => $split['ai'],
            'notes_warning' => $split['warning'],
        ];
    }

    private function dailySummaryText(array $s, int $unblocked): string
    {
        $parts = [];
        foreach ([
            [$s['completed'], 'completed'], [$s['moved'], 'moved'], [$s['newly_blocked'], 'newly blocked'],
            [$unblocked, 'unblocked'], [$s['newly_overdue'], 'newly overdue'], [$s['new_tasks'], 'new'],
        ] as [$n, $text]) {
            if ($n > 0) {
                $parts[] = $n.' '.$text;
            }
        }

        return $parts ? ucfirst(implode(' · ', $parts)) : 'No board changes recorded for this day.';
    }

    private function boardText(array $b, ?array $prev): string
    {
        $part = function (string $key, string $label) use ($b, $prev) {
            $d = $prev && isset($prev[$key]) ? $b[$key] - $prev[$key] : null;

            return $b[$key].' '.$label.($d === null ? '' : ' ('.($d > 0 ? '+'.$d : ($d < 0 ? '−'.abs($d) : '±0')).')');
        };

        return implode(', ', [$part('overdue', 'overdue'), $part('blocked', 'blocked'), $part('in_progress', 'in progress'), $part('open', 'open')])
            .($prev ? ' — change since the previous daily report' : '');
    }

    /** One line per person who actually did something that day. */
    private function teamToday(Collection $completed, Collection $moved, Collection $blocked, Collection $comments): array
    {
        $rows = [];
        $names = fn (?string $a) => $a ? array_values(array_filter(array_map('trim', explode(',', $a)))) : ['Unassigned'];
        $add = function (array $item, string $bucket, string $text) use (&$rows, $names) {
            foreach ($names($item['assignee'] ?? null) as $n) {
                $rows[$n] ??= ['name' => $n, 'done' => [], 'moved' => [], 'blocked' => [], 'discussed' => []];
                $rows[$n][$bucket][] = $text;
            }
        };

        foreach ($completed as $c) {
            $add($c, 'done', $c['title']);
        }
        foreach ($moved as $c) {
            $add($c, 'moved', $c['title'].' → '.($c['to'] ?? '?'));
        }
        foreach ($blocked as $c) {
            $add($c, 'blocked', $c['title']);
        }
        foreach ($comments as $c) {
            $add($c, 'discussed', $c['title']);
        }

        return collect($rows)->sortBy('name')->values()->all();
    }

    /* ================================================================== */
    /* Weekly                                                               */
    /* ================================================================== */

    public function buildWeekly(Carbon $start, ?string $notes, string $preparedBy): array
    {
        $end = $start->copy()->addDays(6)->endOfDay();
        $prevStart = $start->copy()->subDays(7);
        $prevEnd = $start->copy()->subDay()->endOfDay();
        $asOf = $end->lt(now()) ? $end->copy() : now();

        $activities = $this->activities($start, $end);
        $prevActivities = $this->activities($prevStart, $prevEnd);

        $cards = PmCard::query()->get();
        $byId = $cards->keyBy('id');
        $open = $cards->reject(fn ($c) => in_array($c->status, self::OPEN_EXCLUDED, true));

        [$completed] = $this->classify($activities, $byId);
        [$prevCompleted] = $this->classify($prevActivities, $byId);

        $tracked = PmActivity::query()->where('type', 'status_change')->pluck('card_id')->filter()->unique()->flip();
        foreach ($cards as $c) {
            if ($c->status === 'Completed' && ! $tracked->has($c->id) && ! $completed->has($c->id)
                && $c->last_activity_at && $c->last_activity_at->between($start, $end)) {
                $completed->put($c->id, $this->item($c));
            }
        }

        $byProject = $completed->values()->groupBy(fn ($i) => $i['project'] ?? 'Standalone tasks')
            ->map(fn ($g, $project) => ['project' => $project, 'items' => $g->values()->all()])
            ->sortByDesc(fn ($g) => count($g['items']))->values()->all();

        $newCount = $activities->whereIn('type', ['created', 'pushed'])->unique('card_id')->count();
        $prevNew = $prevActivities->whereIn('type', ['created', 'pushed'])->unique('card_id')->count();

        // Still open: how long each has been in progress (since it last entered that status).
        $inProgressCards = $open->where('status', 'In Progress');
        $since = $this->lastEntered($inProgressCards->pluck('id'), 'In Progress');
        $inProgress = $inProgressCards->map(fn ($c) => $this->item($c, extra: [
            'days' => $since->has($c->id) ? (int) $since->get($c->id)->copy()->startOfDay()->diffInDays($asOf->copy()->startOfDay(), true) : null,
            'due' => $c->due_at?->toDateString(),
        ]))->sortByDesc('days')->values()->all();

        $ageing = $this->ageing($open, $asOf, 0);

        // Team workload.
        $names = fn (?string $a) => $a ? array_values(array_filter(array_map('trim', explode(',', $a)))) : ['Unassigned'];
        $rows = [];
        $row = function (string $n) use (&$rows) {
            $rows[$n] ??= ['name' => $n, 'completed' => 0, 'open' => 0, 'in_progress' => 0, 'blocked' => 0, 'overdue' => 0];
        };
        foreach ($completed as $i) {
            foreach ($names($i['assignee']) as $n) {
                $row($n);
                $rows[$n]['completed']++;
            }
        }
        foreach ($open as $c) {
            foreach ($names($c->assignee) as $n) {
                $row($n);
                $rows[$n]['open']++;
                $rows[$n]['in_progress'] += $c->status === 'In Progress' ? 1 : 0;
                $rows[$n]['blocked'] += $c->status === 'Blocked' ? 1 : 0;
                $rows[$n]['overdue'] += ($c->due_at && $c->due_at->lt($asOf->copy()->startOfDay())) ? 1 : 0;
            }
        }
        $team = collect($rows)->sortBy([fn ($a, $b) => $b['completed'] <=> $a['completed'], fn ($a, $b) => $b['open'] <=> $a['open']])->values()->all();

        // Next week.
        $nextStart = $start->copy()->addDays(7)->startOfDay();
        $nextEnd = $start->copy()->addDays(13)->endOfDay();
        $split = $this->splitIfAny($notes);
        $plan = [];
        foreach ($open->filter(fn ($c) => $c->due_at && $c->due_at->between($nextStart, $nextEnd))->sortBy('due_at') as $c) {
            $plan[] = 'Due '.$c->due_at->format('D j M').': “'.$c->title.'”'.($c->assignee ? ' ('.$c->assignee.')' : ' (unassigned)');
        }
        $plan = array_merge($plan, $split['plan']);

        $stats = [
            'completed' => $completed->count(),
            'prev_completed' => $prevCompleted->count(),
            'new_tasks' => $newCount,
            'prev_new_tasks' => $prevNew,
            'blocked' => count($ageing['blocked']),
            'overdue' => count($ageing['overdue']),
            'in_progress' => count($inProgress),
        ];

        $label = $start->format('D j M').' – '.$start->copy()->addDays(6)->format('D j M Y');

        return [
            'kind' => 'weekly',
            'date' => $start->toDateString(),
            'label' => $label,
            'prepared_by' => $preparedBy,
            'summary' => $stats,
            'summary_text' => implode(' · ', [
                $stats['completed'].' completed (last week '.$stats['prev_completed'].')',
                $stats['new_tasks'].' new (last week '.$stats['prev_new_tasks'].')',
                $stats['blocked'].' blocked',
                $stats['overdue'].' overdue',
            ]),
            'pills' => $this->pills([
                [$stats['completed'], 'done', 'green'],
                [$stats['in_progress'], 'in progress', 'slate'],
                [$stats['blocked'], 'blocked', 'red'],
                [$stats['overdue'], 'overdue', 'amber'],
            ]),
            'completed_by_project' => $byProject,
            'in_progress' => $inProgress,
            'blocked' => $ageing['blocked'],
            'overdue' => $ageing['overdue'],
            'blocker_notes' => $split['blockers'],
            'team' => $team,
            'my_actions' => array_merge($this->actionLines($activities), $split['my_actions']),
            'plan' => $plan,
            'notes' => $split['notes'],
            'notes_ai' => $split['ai'],
            'notes_warning' => $split['warning'],
        ];
    }

    /* ================================================================== */
    /* Shared helpers                                                       */
    /* ================================================================== */

    private function activities(Carbon $from, Carbon $to): Collection
    {
        return PmActivity::query()->whereBetween('occurred_at', [$from, $to])->orderBy('occurred_at')->get();
    }

    /**
     * Collapses each card's status changes in the window to one net change
     * (first "from" -> last "to"), so a card that went Assigned -> In Progress
     * -> Blocked shows once, as newly blocked.
     *
     * @return array{0: Collection, 1: Collection, 2: Collection, 3: Collection} completed (keyed by card id), moved, newly blocked, unblocked
     */
    private function classify(Collection $activities, Collection $byId): array
    {
        $completed = collect();
        $moved = collect();
        $blocked = collect();
        $unblocked = collect();

        $activities->where('type', 'status_change')->filter(fn ($a) => $a->card_id)->groupBy('card_id')
            ->each(function ($group, $cardId) use ($byId, $completed, $moved, $blocked, $unblocked) {
                $group = $group->sortBy('occurred_at')->values();
                $from = $group->first()->meta['from'] ?? null;
                $to = $group->last()->meta['to'] ?? null;
                if ($from === $to) {
                    return;
                }

                $first = $group->first();
                $item = fn (array $extra = []) => $this->item($byId->get($cardId), $first->title, $first->meta, $extra);

                if ($to === 'Completed') {
                    $completed->put($cardId, $item());
                } elseif ($to === 'Blocked') {
                    $blocked->push($item(['from' => $from, 'to' => $to]));
                } elseif ($from === 'Blocked') {
                    $unblocked->push($item(['from' => $from, 'to' => $to]));
                } else {
                    $moved->push($item(['from' => $from, 'to' => $to]));
                }
            });

        return [$completed, $moved, $blocked, $unblocked];
    }

    /** When each card last entered $status (any time in history). @return Collection<int, Carbon> */
    private function lastEntered(Collection $cardIds, string $status): Collection
    {
        if ($cardIds->isEmpty()) {
            return collect();
        }

        return PmActivity::query()->where('type', 'status_change')->whereIn('card_id', $cardIds->all())
            ->orderBy('occurred_at')->get()
            ->filter(fn ($a) => ($a->meta['to'] ?? null) === $status)
            ->groupBy('card_id')
            ->map(fn ($g) => $g->last()->occurred_at);
    }

    /**
     * Blocked / overdue tasks and for how long. $min filters out the recent ones
     * (daily report: only things stuck 3+ days).
     *
     * @return array{blocked: array, overdue: array}
     */
    private function ageing(Collection $open, Carbon $asOf, int $min): array
    {
        $today = $asOf->copy()->startOfDay();

        $blockedCards = $open->where('status', 'Blocked');
        $since = $this->lastEntered($blockedCards->pluck('id'), 'Blocked');
        $blocked = $blockedCards->map(function ($c) use ($since, $today) {
            $from = $since->get($c->id) ?? $c->last_activity_at;

            return $this->item($c, extra: [
                'kind' => 'blocked',
                'days' => $from ? (int) $from->copy()->startOfDay()->diffInDays($today, true) : null,
            ]);
        });

        $overdue = $open->filter(fn ($c) => $c->due_at && $c->due_at->lt($today))->map(fn ($c) => $this->item($c, extra: [
            'kind' => 'overdue',
            'days' => (int) $c->due_at->copy()->startOfDay()->diffInDays($today, true),
        ]));

        $keep = fn (Collection $items) => $items
            ->filter(fn ($i) => $i['days'] === null ? $min === 0 : $i['days'] >= $min)
            ->sortByDesc(fn ($i) => $i['days'] ?? -1)
            ->take(30)->values()->all();

        return ['blocked' => $keep($blocked), 'overdue' => $keep($overdue)];
    }

    private function pills(array $defs): array
    {
        return collect($defs)->filter(fn ($d) => $d[0] > 0)->map(fn ($d) => ['text' => $d[0].' '.$d[1], 'tone' => $d[2]])->values()->all();
    }

    private function item(?PmCard $c, ?string $title = null, array $meta = [], array $extra = []): array
    {
        return [
            'title' => $c?->title ?? $title ?? 'Untitled task',
            'project' => $c?->project_name ?? ($meta['project'] ?? null),
            'assignee' => $c?->assignee ?? ($meta['assignee'] ?? null),
        ] + $extra;
    }

    /** @return array{my_actions: string[], blockers: string[], plan: string[], notes: string[], ai: ?bool, warning: ?string} */
    private function splitIfAny(?string $notes): array
    {
        if (! filled($notes)) {
            return ['my_actions' => [], 'blockers' => [], 'plan' => [], 'notes' => [], 'ai' => null, 'warning' => null];
        }

        [$split, $ai, $warning] = $this->splitNotes($notes);

        return $split + ['ai' => $ai, 'warning' => $warning];
    }

    /** What the PM did in this app that day, from the activity log. */
    private function actionLines(Collection $activities): array
    {
        $lines = [];

        $pushed = $activities->where('type', 'pushed');
        if ($pushed->count()) {
            $lines[] = 'Created '.$pushed->count().' '.str('task')->plural($pushed->count()).' from a client brief: '
                .$this->listed($pushed->map(fn ($a) => '“'.$a->title.'”'.(($a->meta['assignee'] ?? null) ? ' → '.$a->meta['assignee'] : '')));
        }

        $nudges = $activities->where('type', 'nudge');
        if ($nudges->count()) {
            $lines[] = 'Followed up on '.$nudges->count().' '.str('task')->plural($nudges->count()).' with the team: '
                .$this->listed($nudges->map(fn ($a) => '“'.$a->title.'”'.(($a->meta['assignee'] ?? null) ? ' ('.$a->meta['assignee'].')' : '')));
        }

        $verified = $activities->where('type', 'verify');
        if ($verified->count()) {
            $lines[] = 'Verified '.$verified->count().' completed '.str('task')->plural($verified->count()).': '
                .$this->listed($verified->map(fn ($a) => '“'.$a->title.'”'));
        }

        $snoozed = $activities->where('type', 'snooze');
        if ($snoozed->count()) {
            $lines[] = 'Snoozed '.$snoozed->count().' '.str('flag')->plural($snoozed->count()).' for 3 days: '
                .$this->listed($snoozed->map(fn ($a) => '“'.$a->title.'”'));
        }

        return $lines;
    }

    private function listed(Collection $items, int $max = 5): string
    {
        $items = $items->values();
        $shown = $items->take($max)->implode('; ');

        return $items->count() > $max ? $shown.'; +'.($items->count() - $max).' more' : $shown;
    }

    /**
     * Splits the free text into report sections. Uses Claude when it is set up;
     * otherwise (or if the call fails) falls back to simple line rules and says so.
     *
     * @return array{0: array{my_actions: string[], blockers: string[], plan: string[], notes: string[]}, 1: bool, 2: ?string}
     */
    private function splitNotes(string $notes): array
    {
        try {
            $out = $this->claude->json(
                'You turn a project manager\'s rough end-of-day notes into report sections. '
                .'my_actions = things the PM did for the team or for clients. blockers = problems, risks or things waiting on someone. '
                .'plan = what happens next / tomorrow. notes = anything that fits none of those. '
                .'Keep the PM\'s own facts and names; fix grammar lightly and shorten each item to one clear sentence. '
                .'Never add information that is not in the notes. Omit empty sections. '
                .'Shape: {"my_actions":[""],"blockers":[""],"plan":[""],"notes":[""]}',
                $notes,
                1200
            );

            return [$this->cleanSplit($out), true, null];
        } catch (RuntimeException $e) {
            return [$this->ruleSplit($notes), false, 'Split with simple rules instead of AI: '.$e->getMessage()];
        }
    }

    private function cleanSplit(array $out): array
    {
        $clean = fn ($v) => collect(is_array($v) ? $v : [])
            ->map(fn ($x) => trim(mb_substr(is_scalar($x) ? (string) $x : '', 0, 300)))
            ->filter()
            ->take(20)
            ->values()
            ->all();

        return [
            'my_actions' => $clean($out['my_actions'] ?? []),
            'blockers' => $clean($out['blockers'] ?? []),
            'plan' => $clean($out['plan'] ?? []),
            'notes' => $clean($out['notes'] ?? []),
        ];
    }

    private function ruleSplit(string $notes): array
    {
        $out = ['my_actions' => [], 'blockers' => [], 'plan' => [], 'notes' => []];

        foreach (preg_split('/\r?\n/', $notes) as $line) {
            $line = trim(preg_replace('/^\s*(?:[-*•–—]|\d+[.)])\s*/u', '', $line));
            if (mb_strlen($line) < 3) {
                continue;
            }
            $line = mb_substr($line, 0, 300);

            $bucket = match (true) {
                (bool) preg_match('/^(tomorrow|next|plan|will|todo|to do|need to|going to)\b/i', $line) => 'plan',
                (bool) preg_match('/\b(block|blocked|waiting on|stuck|risk|issue|delay|problem|pending from)\b/i', $line) => 'blockers',
                default => 'my_actions',
            };
            $out[$bucket][] = $line;
        }

        return array_map(fn ($v) => array_slice($v, 0, 20), $out);
    }

    /* ------------------------------------------------------------------ */
    /* Plain-text version (what "Copy as text" gives you)                   */
    /* ------------------------------------------------------------------ */

    public function render(array $c): string
    {
        return ($c['kind'] ?? 'daily') === 'weekly' ? $this->renderWeekly($c) : $this->renderDaily($c);
    }

    private function section(array &$out, string $title, array $lines, ?string $empty = 'None.'): void
    {
        if (! $lines && $empty === null) {
            return; // optional section with nothing in it
        }
        $out[] = strtoupper($title);
        $out[] = $lines ? implode("\n", array_map(fn ($l) => '• '.$l, $lines)) : $empty;
        $out[] = '';
    }

    private function taskLine(array $t): string
    {
        return $t['title'].(($t['project'] ?? null) ? ' ['.$t['project'].']' : '').' — '.($t['assignee'] ?? 'unassigned');
    }

    private function renderDaily(array $c): string
    {
        $out = ['DAILY REPORT — '.$c['label'], 'Prepared by: '.$c['prepared_by'], ''];
        $t = fn (array $x) => $this->taskLine($x);

        $out[] = 'TODAY AT A GLANCE';
        $out[] = $c['summary_text'];
        $out[] = 'Board: '.$c['board_text'];
        $out[] = '';

        $this->section($out, 'Completed today', array_map($t, $c['completed']), 'Nothing completed.');
        $this->section($out, 'New tasks', array_map($t, $c['new_tasks']), null);
        $this->section($out, 'Progress today', array_merge(
            array_map(fn ($x) => $t($x).': '.($x['from'] ?? '?').' → '.($x['to'] ?? '?'), $c['moved']),
            array_map(fn ($x) => $t($x).': '.$x['comments'].' new '.str('comment')->plural($x['comments']), $c['comments'])
        ), 'No status changes today.');
        $this->section($out, 'New blockers', array_merge(array_map($t, $c['newly_blocked']), $c['blocker_notes']), null);
        $this->section($out, 'Unblocked', array_map($t, $c['unblocked']), null);
        $this->section($out, 'Newly overdue', array_map(fn ($x) => $t($x).' (was due '.$x['due'].')', $c['newly_overdue']), null);
        $this->section($out, 'Needs attention (stuck '.self::AGEING_DAYS.'+ days)', array_map(
            fn ($x) => $t($x).' — '.$x['kind'].' '.$x['days'].'d', $c['attention']
        ), null);

        $this->section($out, 'Team today', array_map(function ($p) {
            $bits = [];
            if ($p['done']) {
                $bits[] = 'finished '.implode(', ', $p['done']);
            }
            if ($p['moved']) {
                $bits[] = 'moved '.implode(', ', $p['moved']);
            }
            if ($p['blocked']) {
                $bits[] = 'blocked on '.implode(', ', $p['blocked']);
            }
            if ($p['discussed']) {
                $bits[] = 'discussed '.implode(', ', $p['discussed']);
            }

            return $p['name'].': '.implode('; ', $bits);
        }, $c['team']), 'No team activity recorded.');

        $this->section($out, 'What I did for the team', $c['my_actions'], 'Nothing logged.');
        $this->section($out, 'Tomorrow', $c['plan'], 'Nothing planned yet.');
        $this->section($out, 'Notes', $c['notes'], null);

        return rtrim(implode("\n", $out))."\n";
    }

    private function renderWeekly(array $c): string
    {
        $out = ['WEEKLY REPORT — '.$c['label'], 'Prepared by: '.$c['prepared_by'], ''];
        $t = fn (array $x) => $this->taskLine($x);
        $days = fn (array $x) => ($x['days'] ?? null) === null ? '' : ' — '.$x['days'].'d';

        $out[] = 'THIS WEEK AT A GLANCE';
        $out[] = $c['summary_text'];
        $out[] = '';

        $out[] = 'COMPLETED THIS WEEK';
        if ($c['completed_by_project']) {
            foreach ($c['completed_by_project'] as $g) {
                $out[] = $g['project'].' ('.count($g['items']).')';
                foreach ($g['items'] as $i) {
                    $out[] = '  • '.$i['title'].' — '.($i['assignee'] ?? 'unassigned');
                }
            }
        } else {
            $out[] = 'Nothing completed.';
        }
        $out[] = '';

        $this->section($out, 'Still in progress', array_map(fn ($x) => $t($x).(($x['days'] ?? null) !== null ? ' — '.$x['days'].'d in progress' : ''), $c['in_progress']));
        $this->section($out, 'Blocked', array_merge(array_map(fn ($x) => $t($x).$days($x).' blocked', $c['blocked']), $c['blocker_notes']), 'Nothing blocked.');
        $this->section($out, 'Overdue', array_map(fn ($x) => $t($x).' — '.$x['days'].'d overdue', $c['overdue']), 'Nothing overdue.');

        $this->section($out, 'Team workload', array_map(
            fn ($p) => $p['name'].' — '.$p['completed'].' completed | '.$p['open'].' open'
                .($p['in_progress'] ? ', '.$p['in_progress'].' in progress' : '')
                .($p['blocked'] ? ', '.$p['blocked'].' blocked' : '')
                .($p['overdue'] ? ', '.$p['overdue'].' overdue' : ''),
            $c['team']
        ), 'No team activity.');

        $this->section($out, 'What I did for the team', $c['my_actions'], 'Nothing logged.');
        $this->section($out, 'Next week', $c['plan'], 'Nothing planned yet.');
        $this->section($out, 'Notes', $c['notes'], null);

        return rtrim(implode("\n", $out))."\n";
    }
}
