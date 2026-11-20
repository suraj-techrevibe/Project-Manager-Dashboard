<?php

namespace App\Services\Pm;

use App\Models\MeetingMinutes;
use App\Models\PmActivity;
use App\Models\PmCard;
use App\Models\PmIntake;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Str;

/**
 * The built-in PM assistant. No AI model, no API key: it understands plain-English requests with
 * rules (keywords, dates, people / project / task name matching) and answers from the synced board.
 *
 *  - Questions are answered immediately from live data.
 *  - Requests to change something are turned into "pending actions" (via $queue) that the person
 *    confirms in the chat — exactly like the AI-driven path, so nothing changes without a click.
 *  - When it can't understand or something is missing, it says exactly what it needs.
 */
class RuleBot
{
    use RuleBotKnowledge;

    /** A reply starting with this means "I need more details" — the next short message is merged with the previous one. */
    public const NEED_MORE = 'I need a bit more';

    private const STOP = [
        'a', 'an', 'the', 'to', 'of', 'for', 'in', 'on', 'at', 'and', 'or', 'is', 'are', 'was', 'be', 'this', 'that', 'these', 'those', 'it', 'its',
        'my', 'me', 'i', 'please', 'can', 'you', 'could', 'would', 'task', 'tasks', 'ticket', 'card', 'as', 'with', 'by', 'from', 'due', 'date',
        'assign', 'assigned', 'status', 'mark', 'set', 'move', 'change', 'update', 'make', 'new', 'add', 'create', 'comment', 'subtask', 'sub',
        'reassign', 'give', 'project', 'called', 'named', 'titled', 'about', 'all', 'now', 'then', 'also', 'just', 'need', 'want', 'like', 'todo',
        'priority', 'deadline', 'finish', 'finished', 'complete', 'completed', 'done', 'close', 'closed', 'block', 'blocked', 'start', 'started',
        'reschedule', 'postpone', 'push', 'extend', 'snooze', 'hide', 'mute', 'note', 'under', 'into', 'over', 'out', 'up', 'down',
    ];

    private const MONTHS = ['jan' => 1, 'feb' => 2, 'mar' => 3, 'apr' => 4, 'may' => 5, 'jun' => 6, 'jul' => 7, 'aug' => 8, 'sep' => 9, 'sept' => 9, 'oct' => 10, 'nov' => 11, 'dec' => 12];

    private const DAYS = [
        'monday' => Carbon::MONDAY, 'tuesday' => Carbon::TUESDAY, 'wednesday' => Carbon::WEDNESDAY, 'thursday' => Carbon::THURSDAY,
        'friday' => Carbon::FRIDAY, 'saturday' => Carbon::SATURDAY, 'sunday' => Carbon::SUNDAY,
        'mon' => Carbon::MONDAY, 'tue' => Carbon::TUESDAY, 'tues' => Carbon::TUESDAY, 'wed' => Carbon::WEDNESDAY, 'thu' => Carbon::THURSDAY,
        'thur' => Carbon::THURSDAY, 'thurs' => Carbon::THURSDAY, 'fri' => Carbon::FRIDAY, 'sat' => Carbon::SATURDAY, 'sun' => Carbon::SUNDAY,
    ];

    private const STATUS_WORDS = [
        'Completed' => ['completed', 'complete', 'done', 'finished', 'finish', 'closed', 'close'],
        'Blocked' => ['blocked', 'block'],
        'In Progress' => ['in progress', 'started', 'start', 'working'],
        'Pending' => ['pending'],
        'Assigned' => ['assigned'],
        'Cancelled' => ['cancelled', 'canceled', 'cancel'],
    ];

    private User $user;

    /** @var callable */
    private $queue;

    private Collection $cards;

    private ?array $employees = null;

    private array $used = [];

    private array $suggest = [];

    /** True when nothing understood the question — lets the assistant hand it to the AI model (hybrid mode). */
    private bool $unhandled = false;

    public function __construct(private FlagService $flags, private TaskmanduSync $taskmandu) {}

    /* ================================================================== */
    /* Entry point                                                         */
    /* ================================================================== */

    /**
     * @param  array<int, array{role: string, content: string}>  $history
     * @param  callable(string, array, User): array  $queue  parks a write action, returns the action card
     * @return array{reply: string, actions: array, tools: array, suggestions: array}
     */
    public function respond(array $history, User $user, callable $queue): array
    {
        $this->user = $user;
        $this->queue = $queue;
        $this->used = [];
        $this->suggest = [];
        $this->unhandled = false;
        $this->employees = null;
        $this->cards = PmCard::query()->get();

        $turns = array_values($history);
        $raw = trim((string) (end($turns)['content'] ?? ''));
        $prevAssistant = (string) ($turns[count($turns) - 2]['content'] ?? '');
        $prevUser = (string) ($turns[count($turns) - 3]['content'] ?? '');

        // "I need a bit more…" → the person is answering my question; read both messages together.
        if (str_starts_with($prevAssistant, self::NEED_MORE) && $prevUser !== ''
            && ! preg_match('/^\s*(create|add|new|make|log|assign|mark|show|list|what|who|how|which|where|when|sync|snooze|move|set|comment|find|search)\b/i', $raw)) {
            $raw = $prevUser.' '.$raw;
        }

        if ($raw === '') {
            return $this->out($this->help());
        }

        try {
            return $this->route($raw);
        } catch (\Throwable $e) {
            report($e);

            return $this->out("Something went wrong while I was working that out ({$e->getMessage()}). Try rephrasing, or type **help**.");
        }
    }

    private function route(string $raw): array
    {
        $n = $this->norm($raw);

        if (preg_match('/^ (hi|hello|hey|yo|hiya|good (morning|afternoon|evening)|help|commands|what can you do|how do i use|menu)\b/', $n)
            || preg_match('/\bwhat can you (do|help)|\bhow (does|do) this work/', $n)) {
            return $this->out($this->help());
        }
        if (preg_match('/^ (thanks|thank you|thx|cheers|great|perfect|nice|cool|ok|okay)\b/', $n) && str_word_count($n) <= 4) {
            return $this->out("Anytime. Ask me anything else about the board, or tell me what to change.");
        }

        // ---- changes (always confirmed) ----
        if (preg_match('/^ (how|where) (do|can|could|should|would|to|is|are)\b/', $n) && ($g = $this->guide($n))) {
            return $g;
        }
        if (preg_match('/^ (please )?(sync|refresh|reload|pull)\b/', $n) || preg_match('/\b(sync|refresh) (the )?(board|taskmandu|tasks|data)\b/', $n) && ! str_contains($n, '?')) {
            return $this->doSync();
        }
        if (preg_match('/\b(add|create|new|make)\b.*\bsub-?\s?tasks?\b/', $n) || preg_match('/^ sub-?\s?task\b/', $n)) {
            return $this->doCreateSubtask($raw);
        }
        if (preg_match('/\b(log|add|create|new|capture|record|raise)\b.*\b(request|idea)\b/', $n) && ! preg_match('/\b(show|list|what|which|how many|any)\b/', $n)) {
            return $this->doCreateIntake($raw, $n);
        }
        if (preg_match('/^ (please )?(add|create|new|make|raise)\b.*\b(tasks?|tickets?|to-?dos?)\b/', $n) || preg_match('/^ (please )?open (a|an|new) (new )?(task|ticket)\b/', $n) || preg_match('/^ (new|create) (a )?(task|ticket)\b/', $n)) {
            return $this->doCreateTask($raw);
        }
        if (preg_match('/^ (please )?(add (a )?)?(comment|note)\b|\b(comment|note) on\b|\bleave a comment\b/', $n)) {
            return $this->doComment($raw);
        }
        if (preg_match('/^ (please )?(snooze|hide|mute)\b/', $n)) {
            return $this->doSnooze($raw);
        }
        if (preg_match('/\b(reassign|assign|allocate|hand over|handover)\b/', $n) || preg_match('/^ (please )?give\b.* to\b/', $n)) {
            return $this->doAssign($raw);
        }
        if ($this->looksLikePriorityChange($n)) {
            return $this->doPriority($raw);
        }
        if (preg_match('/\b(reschedule|postpone|push back|push out|extend|defer)\b/', $n) || preg_match('/\b(move|change|set|update|push)\b.*\b(due|deadline|due date)\b/', $n)
            || (preg_match('/^ (please )?(move|push)\b/', $n) && $this->findDate($n))) {
            return $this->doReschedule($raw);
        }
        if ($this->statusFromText($n, true) && preg_match('/^ (please )?(mark|set|move|change|update|make|complete|finish|close|block|start|cancel|flag)\b/', $n)) {
            return $this->doStatus($raw);
        }
        if (preg_match('/^ (please )?(delete|remove|erase)\b/', $n)) {
            return $this->out("I can't delete anything — that's deliberate. I can **mark a task as Cancelled** instead. Try: *cancel \"task name\"*.");
        }

        // ---- questions ----
        return $this->answer($raw, $n);
    }

    /* ================================================================== */
    /* Questions                                                           */
    /* ================================================================== */

    private function answer(string $raw, string $n): array
    {
        if (preg_match('/\b(overview|summary|summarise|summarize|big picture|status report|stand-?up|how are we doing|how is everything|whats going on|what is going on|catch me up|where are we|health check|dashboard)\b/', $n)
            && ! $this->project($n) && ! $this->personIn($n)) {
            return $this->overview();
        }
        if (preg_match('/\b(workload|capacity|overloaded|overbooked|overworked|underused|free|available|availability|spare|bandwidth|has time|have time|has capacity|busiest|busy|least busy|most tasks|fewest tasks|who can take|who can pick)\b/', $n)
            && preg_match('/\b(who|whos|which|team|people|everyone|capacity|workload|anyone|staff)\b/', $n)) {
            return $this->workload($n);
        }
        if (preg_match('/\b(team|staff|people|employees|members|who works|who is on|who are)\b/', $n) && preg_match('/\b(list|show|all|who|our|the)\b/', $n)
            && ! preg_match('/\btasks?\b|overdue|blocked|working on/', $n)) {
            return $this->people();
        }
        if ($kb = $this->knowledge($raw, $n)) {
            return $kb;
        }
        if (preg_match('/\b(meeting|meetings|minutes|standup notes|discussed|decisions?|action items?)\b/', $n)) {
            return $this->meetings($n);
        }
        if (preg_match('/\b(requests?|ideas?|intake|enquir(y|ies)|inbox)\b/', $n) && ! preg_match('/\btasks?\b/', $n)) {
            return $this->intakes($n);
        }
        if (preg_match('/\b(activity|history|log|what changed|whats changed|what happened|recent changes|audit)\b/', $n)) {
            return $this->activity();
        }
        if (preg_match('/\b(list|show|all|what|which|our)\b.*\bprojects\b/', $n) && ! $this->project($n)) {
            return $this->projects();
        }
        if (($p = $this->project($n)) && preg_match('/\b(status|progress|how is|hows|how are|going|summary|update|health|doing|overview|state|where is|where are|report)\b/', $n)
            && ! preg_match('/\b(list|show me (all )?tasks|overdue|blocked|unassigned|due)\b/', $n)) {
            return $this->projectSummary($p);
        }

        return $this->taskQuery($raw, $n);
    }

    /* ---------- overview ---------- */

    private function overview(): array
    {
        $this->used[] = 'board_overview';
        $m = $this->flags->metrics($this->flags->all());
        $open = $this->open();
        $done = $this->cards->where('status', 'Completed')->count();
        $work = collect($this->flags->workload());
        $over = $work->filter(fn ($w) => ($w['week_hours'] ?? 0) > ($w['capacity'] ?? 40))->pluck('name')->all();

        $lines = ["**Board right now** — {$open->count()} open task".($open->count() === 1 ? '' : 's').", {$done} completed."];
        $lines[] = "- Overdue: **{$m['overdue']}** · Blocked: **{$m['blocked']}** · Due today: **{$m['due_today']}** · Due soon: **{$m['due_soon']}**";
        $lines[] = "- Stuck (no movement): **{$m['stuck']}** · No owner: **{$m['unassigned']}** · Waiting for verification: **{$m['unverified']}**";
        if ($over) {
            $lines[] = '- Over weekly capacity: **'.implode(', ', $over).'**';
        }

        $worst = $this->flags->all()->whereIn('type', ['overdue', 'blocked'])->take(4);
        if ($worst->isNotEmpty()) {
            $lines[] = "\nMost urgent:";
            foreach ($worst as $f) {
                $lines[] = "- **{$f['title']}** — {$f['project_name']} · ".($f['assignee'] ?: 'unassigned').' · '.$f['detail'];
            }
        }
        $this->suggest = ["What's overdue?", 'Who has capacity this week?', 'Which tasks have no owner?'];

        return $this->out(implode("\n", $lines));
    }

    /* ---------- workload / people ---------- */

    private function workload(string $n): array
    {
        $this->used[] = 'team_workload';
        $rows = collect($this->flags->workload());
        if ($rows->isEmpty()) {
            return $this->out('Nobody has open work on the synced board yet.');
        }
        $cap = fn ($w) => (float) ($w['capacity'] ?? 40);
        $line = fn ($w) => "- **{$w['name']}** — {$w['open']} open".($w['overdue'] ? ", {$w['overdue']} overdue" : '').($w['blocked'] ? ", {$w['blocked']} blocked" : '').", {$w['week_hours']}h of {$cap($w)}h this week";

        if (preg_match('/\b(free|available|availability|spare|capacity|bandwidth|least|fewest|underused|can take|can pick|has time|have time)\b/', $n)) {
            $free = $rows->sortBy(fn ($w) => [$w['week_hours'], $w['open']])->take(5);
            $list = $free->map(fn ($w) => "- **{$w['name']}** — {$w['open']} open, {$w['week_hours']}h of {$cap($w)}h this week (".max(0, round($cap($w) - $w['week_hours'], 1)).'h free)');
            $this->suggest = ["What is {$free->first()['name']} working on?", 'Show unassigned tasks'];

            return $this->out("People with the most room this week:\n".$list->implode("\n"));
        }
        if (preg_match('/\b(overloaded|overbooked|overworked|too much|most|busiest|busy)\b/', $n)) {
            $over = $rows->filter(fn ($w) => $w['week_hours'] > $cap($w));
            $head = $over->isNotEmpty() ? "Over weekly capacity:\n".$over->map($line)->implode("\n") : "Nobody is over capacity. The busiest are:\n".$rows->take(3)->map($line)->implode("\n");

            return $this->out($head);
        }

        return $this->out("Workload this week:\n".$rows->take(12)->map($line)->implode("\n"));
    }

    private function people(): array
    {
        $this->used[] = 'list_employees';
        $emps = $this->employees();
        $names = $emps ? collect($emps)->map(fn ($e) => '- **'.$e['name'].'**'.($e['designation'] ? " — {$e['designation']}" : '')) : $this->assignees()->map(fn ($a) => "- **{$a}**");

        return $this->out($names->isEmpty() ? "I can't see any team members yet — sync the board first." : "Team:\n".$names->take(40)->implode("\n"));
    }

    /* ---------- projects ---------- */

    private function projects(): array
    {
        $this->used[] = 'list_projects';
        $groups = $this->cards->whereNotNull('project_id')->groupBy('project_id');
        if ($groups->isEmpty()) {
            return $this->out('No projects on the synced board yet. Try **sync**.');
        }
        $lines = $groups->map(function ($cs) {
            $active = $cs->where('status', '!=', 'Cancelled');
            $done = $active->where('status', 'Completed')->count();
            $pct = $active->count() ? (int) round($done / $active->count() * 100) : 0;
            $late = $this->openOf($active)->filter(fn ($c) => $this->isOverdue($c))->count();

            return '- **'.($cs->first()->project_name ?: 'Project')."** — {$pct}% ({$done}/{$active->count()})".($late ? ", {$late} overdue" : '');
        })->sort()->values();
        $this->suggest = ['How is '.$groups->first()->first()->project_name.' going?'];

        return $this->out("Projects:\n".$lines->take(25)->implode("\n"));
    }

    private function projectSummary(array $p): array
    {
        $this->used[] = 'get_project';
        $cs = $this->cards->where('project_id', $p['id'])->where('status', '!=', 'Cancelled');
        $open = $this->openOf($cs);
        $done = $cs->where('status', 'Completed')->count();
        $pct = $cs->count() ? (int) round($done / $cs->count() * 100) : 0;
        $late = $open->filter(fn ($c) => $this->isOverdue($c));
        $blocked = $open->where('status', 'Blocked');
        $unowned = $open->filter(fn ($c) => trim((string) $c->assignee) === '');
        $people = $open->flatMap(fn ($c) => $this->splitNames($c->assignee))->countBy()->sortDesc()->take(5);
        $next = $open->filter(fn ($c) => $c->due_at && ! $this->isOverdue($c))->sortBy('due_at')->first();

        $lines = ["**{$p['name']}** — **{$pct}%** done ({$done} of {$cs->count()} tasks)."];
        $lines[] = "- Open: {$open->count()} · Overdue: **{$late->count()}** · Blocked: **{$blocked->count()}** · No owner: **{$unowned->count()}**";
        if ($people->isNotEmpty()) {
            $lines[] = '- Who is on it: '.$people->map(fn ($c, $name) => "{$name} ({$c})")->implode(', ');
        }
        if ($next) {
            $lines[] = "- Next due: **{$next->title}** — ".$this->fmtDate($next->due_at).($next->assignee ? " ({$next->assignee})" : '');
        }
        foreach ($late->sortBy('due_at')->take(5) as $c) {
            $lines[] = "- Overdue: **{$c->title}** — ".($c->assignee ?: 'unassigned').', '.$this->dueText($c);
        }
        $this->suggest = ["Show overdue tasks in {$p['name']}", "Show unassigned tasks in {$p['name']}"];

        return $this->out(implode("\n", $lines));
    }

    /* ---------- meetings / requests / activity ---------- */

    private function meetings(string $n): array
    {
        $this->used[] = 'list_meeting_minutes';
        $q = MeetingMinutes::query()->latest('meeting_date')->latest('id');
        $term = $this->searchTerms($n, ['meeting', 'meetings', 'minutes', 'last', 'latest', 'recent', 'discussed', 'decisions', 'decision', 'action', 'items', 'item', 'what', 'did', 'we', 'show', 'tell', 'from', 'about', 'draft', 'drafts', 'list', 'all', 'every', 'history']);
        if ($term !== '') {
            $q->where(fn ($w) => $w->where('title', 'like', "%{$term}%")->orWhere('discussion', 'like', "%{$term}%")->orWhere('raw_notes', 'like', "%{$term}%"));
        }
        if (preg_match('/\bdrafts?\b/', $n)) {
            $q->where('status', 'draft');
        }
        if (preg_match('/\b(list|all|how many|every|history|which meetings|meetings (did|have) we)\b/', $n) && ! preg_match('/\b(decisions?|action items?|discussed)\b/', $n)) {
            $total = (clone $q)->count();
            $all = $q->limit(15)->get();
            if ($all->isEmpty()) {
                return $this->out($term !== '' ? "No meeting minutes mention “{$term}”." : 'No meeting minutes saved yet.');
            }

            return $this->out("**{$total}** meeting".($total === 1 ? '' : 's').":\n".$all->map(fn ($m) => '- **'.$m->title.'** — '.Carbon::parse($m->meeting_date)->format('D j M Y').' · '.($m->status ?: 'final')
                .' · '.count((array) $m->decisions).' decisions · '.count((array) $m->action_items).' actions')->implode("\n").($total > 15 ? "\n…and ".($total - 15).' more.' : ''));
        }
        $rows = $q->limit(preg_match('/\b(last|latest|recent|previous)\b/', $n) && $term === '' ? 1 : 4)->get();
        if ($rows->isEmpty()) {
            return $this->out($term !== '' ? "No meeting minutes mention “{$term}”." : 'No meeting minutes saved yet.');
        }

        $out = [];
        foreach ($rows as $m) {
            $d = fn ($v) => collect((array) $v)->filter()->map(fn ($x) => is_array($x) ? trim(($x['task'] ?? '').(! empty($x['owner']) ? " — {$x['owner']}" : '').(! empty($x['due_date']) ? " (due {$x['due_date']})" : '')) : (string) $x);
            $block = ["**{$m->title}** — ".Carbon::parse($m->meeting_date)->format('j M Y').($m->status === 'draft' ? ' *(draft)*' : '')];
            if ($att = array_values(array_filter((array) $m->attendees))) {
                $block[] = 'Attendees: '.implode(', ', $att);
            }
            if ($tp = collect((array) $m->topics)->map(fn ($x) => is_array($x) ? trim((string) ($x['title'] ?? '')) : trim((string) $x))->filter()->take(8)->all()) {
                $block[] = 'Topics: '.implode('; ', $tp);
            }
            if ($dec = $d($m->decisions)->take(6)->all()) {
                $block[] = "Decisions:\n".implode("\n", array_map(fn ($x) => "- {$x}", $dec));
            }
            if ($act = $d($m->action_items)->take(8)->all()) {
                $block[] = "Action items:\n".implode("\n", array_map(fn ($x) => "- {$x}", $act));
            }
            if (! $dec && ! $act && $m->discussion) {
                $block[] = Str::limit(trim(strip_tags((string) $m->discussion)), 300);
            }
            $out[] = implode("\n", $block);
        }

        return $this->out(implode("\n\n", $out));
    }

    private function intakes(string $n): array
    {
        $this->used[] = 'list_intakes';
        $kind = preg_match('/\bideas?\b/', $n) ? 'idea' : (preg_match('/\brequests?\b/', $n) ? 'request' : null);
        $q = PmIntake::query()->with('business:id,name')->latest('updated_at');
        if ($kind) {
            $q->where('kind', $kind);
        }
        $closedWanted = preg_match('/\b(rejected|deferred|closed|all)\b/', $n);
        if (! $closedWanted) {
            $q->whereNotIn('status', ['rejected', 'deferred', 'planned']);
        }
        if (preg_match('/\b(decision|review|waiting|pending|awaiting)\b/', $n)) {
            $q->whereIn('status', ['in_review', 'under_review', 'needs_clarification', 'received', 'captured']);
        }
        $rows = $q->limit(40)->get();
        if (preg_match('/\boverdue\b/', $n)) {
            $rows = $rows->filter(fn ($i) => $i->requested_due_at && substr((string) $i->requested_due_at, 0, 10) < today()->toDateString());
        }
        $label = $kind ? "{$kind}s" : 'requests and ideas';
        if ($rows->isEmpty()) {
            return $this->out("No open {$label} match that.");
        }
        $lines = $rows->take(12)->map(fn ($i) => "- **{$i->title}** — ".($i->kind === 'idea' ? 'Idea' : 'Request').' · '.str_replace('_', ' ', $i->status)
            .($i->business?->name ? " · {$i->business->name}" : '').($i->linked_project_name ? " · {$i->linked_project_name}" : '')
            .($i->requested_due_at ? ' · due '.Carbon::parse($i->requested_due_at)->format('j M') : ''));

        return $this->out("**{$rows->count()}** open {$label}:\n".$lines->implode("\n").($rows->count() > 12 ? "\n…and ".($rows->count() - 12).' more in Operations.' : ''));
    }

    private function activity(): array
    {
        $this->used[] = 'recent_activity';
        $rows = PmActivity::query()->latest()->limit(12)->get();
        if ($rows->isEmpty()) {
            return $this->out('No activity logged yet.');
        }

        return $this->out("Latest activity:\n".$rows->map(fn ($a) => '- '.str_replace('_', ' ', $a->type).($a->title ? ": {$a->title}" : '').' · '.$a->created_at?->diffForHumans())->implode("\n"));
    }

    /* ---------- the general task question ---------- */

    private function taskQuery(string $raw, string $n): array
    {
        $this->used[] = 'search_tasks';
        $f = $this->filters($n);

        $isWho = preg_match('/^ who\b/', $n) && ! $f['person'];
        $hasFilter = $f['person'] || $f['project'] || $f['status'] || $f['overdue'] || $f['unassigned'] || $f['stuck'] || $f['range'] || $f['priority'];
        $asksTasks = preg_match('/\b(tasks?|tickets?|cards?|work|working on|assigned|due|overdue|blocked|late|unassigned|stuck|stalled|todo|to-do|open|completed|done|pending|list|show|find|search)\b/', $n);

        if (! $hasFilter && $f['terms'] === '' && ! $asksTasks) {
            return $this->out($this->notUnderstood());
        }

        $rows = $this->applyFilters($f);
        $total = $rows->count();

        if ($total === 0 && ! $hasFilter && $f['terms'] !== '') {
            // maybe a free-text word that matched nothing
            return $this->kbSearchAll($f['terms']) ?? $this->out("I couldn't find anything matching “{$f['terms']}”.\n\n".$this->notUnderstood(short: true));
        }

        $title = $this->describe($f);
        $count = preg_match('/\bhow many|number of|count\b/', $n);
        if ($total === 0) {
            $this->suggest = ["What's overdue?", 'Show blocked tasks'];

            return $this->out("No tasks {$title}. 🎉");
        }

        if ($isWho) {
            $by = $rows->flatMap(fn ($c) => $this->splitNames($c->assignee) ?: ['Unassigned'])->countBy()->sortDesc();

            return $this->out("**{$total}** task".($total === 1 ? '' : 's')." {$title}, by person:\n".$by->map(fn ($c, $name) => "- **{$name}** — {$c}")->take(12)->implode("\n"));
        }

        $sorted = $rows->sortBy([[fn ($c) => $c->due_at ? $c->due_at->timestamp : PHP_INT_MAX, 'asc']])->values();
        $head = $count ? "**{$total}** task".($total === 1 ? '' : 's')." {$title}." : "**{$total}** task".($total === 1 ? '' : 's')." {$title}:";
        $lines = $sorted->take(10)->map(fn ($c) => $this->taskLine($c))->implode("\n");
        $more = $total > 10 ? "\n…and ".($total - 10).' more. Narrow it down by adding a person, project or date.' : '';
        if ($f['overdue'] && $total > 0) {
            $this->suggest = ['Move all overdue tasks to next Monday'];
        }

        return $this->out($head."\n".$lines.$more);
    }

    /** @return array{person:?string, project:?array, status:array, overdue:bool, unassigned:bool, stuck:bool, range:?array, priority:?string, terms:string, includeDone:bool} */
    private function filters(string $n): array
    {
        $w = $n;
        $project = $this->takeProject($w);
        $person = $this->takePerson($w);
        $range = $this->takeRange($w);
        $priority = $this->takePriority($w);

        $status = [];
        foreach (['blocked|blocking|blockers?|blocker' => 'Blocked', 'in progress' => 'In Progress', 'pending' => 'Pending'] as $kw => $st) {
            if (preg_match('/\b('.$kw.')\b/', $w)) {
                $status[] = $st;
                $w = preg_replace('/\b('.$kw.')\b/', ' ', $w);
            }
        }
        $includeDone = false;
        if (preg_match('/\b(completed?|done|finished|closed)\b/', $w) && ! preg_match('/\bnot (yet )?(done|completed|finished)\b/', $w)) {
            $status[] = 'Completed';
            $includeDone = true;
            $w = preg_replace('/\b(completed?|done|finished|closed)\b/', ' ', $w);
        }

        $reOver = '/\b(overdue|late|past due|behind|missed)\b/';
        $reNone = '/\b(unassigned|no owner|no owners|nobody|no one|without (an )?(owner|assignee)|not assigned|unowned|orphan\w*)\b/';
        $reStuck = '/\b(stuck|stalled|idle|inactive|no movement|not moving|no activity|stale)\b/';
        $overdue = (bool) preg_match($reOver, $w);
        $unassigned = (bool) preg_match($reNone, $w);
        $stuck = (bool) preg_match($reStuck, $w);
        $w = preg_replace([$reOver, $reNone, $reStuck], ' ', $w);

        return [
            'person' => $person, 'project' => $project, 'status' => $status, 'overdue' => $overdue, 'unassigned' => $unassigned, 'stuck' => $stuck,
            'range' => $range, 'priority' => $priority, 'includeDone' => $includeDone,
            'terms' => $this->searchTerms($w, ['overdue', 'late', 'past', 'due', 'behind', 'missed', 'unassigned', 'owner', 'nobody', 'stuck', 'stalled', 'idle', 'inactive', 'stale', 'movement', 'activity', 'not', 'moving']),
        ];
    }

    private function applyFilters(array $f): Collection
    {
        $rows = $this->cards->where('status', '!=', 'Cancelled');
        $rows = $f['includeDone'] ? $rows->where('status', 'Completed') : $rows->reject(fn ($c) => $c->status === 'Completed');
        if ($f['status'] && ! $f['includeDone']) {
            $rows = $rows->whereIn('status', $f['status']);
        }
        if ($f['project']) {
            $rows = $rows->where('project_id', $f['project']['id']);
        }
        if ($f['person']) {
            $rows = $rows->filter(fn ($c) => in_array(Str::lower($f['person']), array_map('strtolower', $this->splitNames($c->assignee)), true));
        }
        if ($f['unassigned']) {
            $rows = $rows->filter(fn ($c) => trim((string) $c->assignee) === '');
        }
        if ($f['overdue']) {
            $rows = $rows->filter(fn ($c) => $this->isOverdue($c));
        }
        if ($f['stuck']) {
            $days = (int) config('pm.automation.idle_days', 3);
            $rows = $rows->filter(fn ($c) => $c->status !== 'Completed' && $c->last_activity_at && $c->last_activity_at->lt(now()->subDays($days)));
        }
        if ($f['priority']) {
            $rows = $rows->filter(fn ($c) => Str::lower((string) $c->priority) === $f['priority']);
        }
        if ($f['range']) {
            [$from, $to] = $f['range'];
            $rows = $rows->filter(function ($c) use ($f, $from, $to) {
                $d = $f['includeDone'] ? ($c->last_activity_at ?? $c->updated_at) : $c->due_at;

                return $d && $d->copy()->startOfDay()->between($from, $to);
            });
        }
        if ($f['terms'] !== '') {
            $rows = $rows->filter(fn ($c) => $this->matchesTerms($c, $f['terms']));
        }

        return $rows->values();
    }

    private function describe(array $f): string
    {
        $bits = [];
        if ($f['includeDone']) {
            $bits[] = 'completed';
        }
        foreach ($f['status'] as $s) {
            if ($s !== 'Completed') {
                $bits[] = strtolower($s);
            }
        }
        if ($f['overdue']) {
            $bits[] = 'overdue';
        }
        if ($f['unassigned']) {
            $bits[] = 'with no owner';
        }
        if ($f['stuck']) {
            $bits[] = 'with no movement for '.(int) config('pm.automation.idle_days', 3).'+ days';
        }
        if ($f['priority']) {
            $bits[] = "with {$f['priority']} priority";
        }
        $s = $bits ? implode(' and ', $bits) : 'open';
        $s = $f['unassigned'] || $f['stuck'] ? 'open '.$s : $s;
        if ($f['person']) {
            $s .= " for {$f['person']}";
        }
        if ($f['project']) {
            $s .= " in {$f['project']['name']}";
        }
        if ($f['range']) {
            $s .= ' '.($f['includeDone'] ? 'finished ' : 'due ').$f['range'][2];
        }
        if ($f['terms'] !== '') {
            $s .= " matching “{$f['terms']}”";
        }

        return $s;
    }

    /* ================================================================== */
    /* Changes (all queued for confirmation)                               */
    /* ================================================================== */

    private function doSync(): array
    {
        return $this->withActions('I can pull the latest from Taskmandu. Confirm to run it:', [['sync_board', ['summary' => 'Sync the board from Taskmandu']]]);
    }

    private function doCreateTask(string $raw): array
    {
        [$quoted, $text] = $this->quoted($raw);
        $w = $this->norm($text);

        $date = $this->takeDate($w);
        $priority = $this->takePriority($w);
        $project = $this->takeProject($w);
        $personName = $this->takePerson($w, true);

        // title: quoted text wins; otherwise what's left after the verbs / filler
        if ($quoted) {
            $title = $quoted;
        } else {
            $lead = '/^\s*(please\s+)?(can you\s+)?(create|add|make|raise|open|new)\s+(a\s+|an\s+)?(new\s+)?(task|ticket|to-?do)\s*(called|named|titled|to|for|about|:|-)?\s*/';
            $title = preg_replace('/\s+(and|then|with)\s*$/', '', trim(preg_replace($lead, '', $w)));
            $title = ucfirst(trim($title, " \t\n\r.,:;-"));
        }

        $missing = [];
        if (mb_strlen($title) < 3) {
            $missing[] = 'what the task is (give it a title, ideally in quotes)';
        }
        $projects = $this->projectList();
        if (! $project) {
            if ($projects->count() === 1) {
                $project = $projects->first();
            } else {
                $missing[] = 'which project'.($projects->isNotEmpty() ? ' ('.$projects->pluck('name')->take(8)->implode(', ').')' : '');
            }
        }
        if (! $date) {
            $missing[] = 'a due date (e.g. *friday*, *25 nov*, *in 3 days*)';
        }
        if ($missing) {
            return $this->out(self::NEED_MORE.": ".implode(' and ', $missing).'. Just reply with that and I\'ll finish setting the task up.');
        }

        $args = ['project_id' => $project['id'], 'title' => Str::limit($title, 200, ''), 'due_date' => $date[0]->toDateString()];
        $bits = ['due '.$date[0]->format('D j M')];
        if ($priority) {
            $args['priority'] = ucfirst($priority);
            $bits[] = ucfirst($priority).' priority';
        }
        if ($personName) {
            $emp = $this->employeeByName($personName);
            if (! $emp) {
                return $this->out("I couldn't look up **{$personName}** in Taskmandu to assign them (Taskmandu may be unreachable). I can create the task unassigned — say *create task \"{$title}\" in {$project['name']} due {$date[0]->format('j M')}* — or try again in a moment.");
            }
            $args['assignee_ids'] = [$emp['id']];
            $bits[] = "assigned to {$emp['name']}";
        }
        $args['summary'] = "Create task “{$args['title']}” in {$project['name']} (".implode(', ', $bits).')';
        $args['project'] = $project['name'];

        return $this->withActions('Ready to create this task:', [['create_task', $args]]);
    }

    private function doCreateSubtask(string $raw): array
    {
        // add subtask "Write tests" to "Fix login"   /   add subtask Write tests to Fix login
        $q = '["“”‘’\']';
        if (preg_match('/sub-?\s?tasks?\s*(?:called|named|titled|:)?\s*'.$q.'(.+?)'.$q.'\s+(?:to|under|on|for|in)\s+(?:the\s+)?(?:task\s+)?(.+)$/isu', $raw, $m)
            || preg_match('/sub-?\s?tasks?\s*(?:called|named|titled|:)?\s*(.+?)\s+(?:to|under|on|for|in)\s+(?:the\s+)?(?:task\s+)?(.+)$/isu', $raw, $m)) {
            $subTitle = trim($m[1], " \t\n\r\"“”‘’'.:;-");
            $taskText = trim($m[2], " \t\n\r\"“”‘’'.");
        } else {
            return $this->out(self::NEED_MORE.': the sub-task title and which task it belongs to. Try *add subtask "Write tests" to "Fix login"*.');
        }
        if (mb_strlen($subTitle) < 2) {
            return $this->out(self::NEED_MORE.': the sub-task title. Try *add subtask "Write tests" to "Fix login"*.');
        }

        [$card, $reply] = $this->resolveTask($taskText, $taskText);
        if (! $card) {
            return $reply;
        }

        return $this->withActions('Ready to add this sub-task:', [['create_subtask', [
            'project_id' => $card->project_id, 'task_id' => $card->task_id, 'title' => Str::limit($subTitle, 200, ''),
            'summary' => "Add sub-task “{$subTitle}” to “{$card->title}”",
        ]]]);
    }

    private function doCreateIntake(string $raw, string $n): array
    {
        [$quoted, $text] = $this->quoted($raw);
        $kind = preg_match('/\bidea\b/', $n) ? 'idea' : 'request';
        $w = $this->norm($text);
        $date = $this->takeDate($w);
        $priority = $this->takePriority($w);
        $project = $this->takeProject($w);

        $title = $quoted ?: trim(preg_replace('/^.*?\b(request|idea)\b\s*(called|named|titled|about|for|from [\w ]+?:|:|-)?\s*/iu', '', $text));
        $title = trim($title, " \t\n\r.,:;-");
        if (mb_strlen($title) < 3) {
            return $this->out(self::NEED_MORE.": what the {$kind} is. Try *log a client request: add dark mode to the portal*.");
        }
        $title = $this->stripPhrases($title, $date ? $date[1] : null, $priority);

        $args = ['kind' => $kind, 'title' => Str::limit($title, 200, ''), 'priority' => $priority ?: 'medium'];
        if (preg_match('/\bfrom (client|boss|team)\b/', $n, $m)) {
            $args['source_type'] = $m[1];
        } elseif (preg_match('/\b(client|boss)\b/', $n, $m)) {
            $args['source_type'] = $m[1];
        }
        if ($date) {
            $args['requested_due_at'] = $date[0]->toDateString();
        }
        if ($project) {
            $args['linked_project_id'] = $project['id'];
            $args['linked_project_name'] = $project['name'];
        }
        $args['summary'] = "Log {$kind} “{$args['title']}”".($project ? " for {$project['name']}" : '').($date ? ' (needed by '.$date[0]->format('D j M').')' : '');

        return $this->withActions("Ready to log this {$kind}:", [['create_intake', $args]]);
    }

    private function doComment(string $raw): array
    {
        [$quoted, $text] = $this->quoted($raw);
        // comment on "<task>": <text>  /  comment on "<task>" saying <text>
        if (preg_match('/(?:comment|note)\s+(?:on|to|for)\s+(?:the\s+)?(?:task\s+)?["“]([^"”]{2,200})["”]\s*(?::|-|saying|that|with)?\s*(.+)$/isu', $raw, $mq)) {
            $taskText = trim($mq[1]);
            $body = trim($mq[2], " \"“”");
        } elseif (preg_match('/(?:comment|note)\s+(?:on|to|for)\s+(?:the\s+)?(?:task\s+)?(.+?)\s*(?::|\s-\s|\bsaying\b|\bthat\b|\bwith\b)\s*(.+)$/isu', $text, $m)) {
            $taskText = trim($m[1], " \"“”'‘’");
            $body = trim($m[2], " \"“”");
        } elseif ($quoted && preg_match('/(?:comment|note)\s+(?:on|to|for)\s+(?:the\s+)?(?:task\s+)?(.+)$/isu', $text, $m)) {
            // comment on Fix login "text"  — quoted piece is the body
            $taskText = trim(str_replace($quoted, '', $m[1]), " \"“”'‘’:");
            $body = $quoted;
        } else {
            return $this->out(self::NEED_MORE.': which task and what to say. Try *comment on "Fix login": waiting on client feedback*.');
        }
        [$card, $reply] = $this->resolveTask($taskText, $taskText);
        if (! $card) {
            return $reply;
        }

        return $this->withActions('Ready to post this comment:', [['add_task_comment', [
            'project_id' => $card->project_id, 'task_id' => $card->task_id, 'text' => Str::limit($body, 2000, ''),
            'summary' => "Comment on “{$card->title}”: ".Str::limit($body, 80),
        ]]]);
    }

    private function doSnooze(string $raw): array
    {
        [$quoted, $text] = $this->quoted($raw);
        $w = $this->norm($text);
        $this->takeDate($w);
        [$card, $reply] = $this->resolveTask($quoted ?: $this->residualTitle($w, $text), $text);
        if (! $card) {
            return $reply;
        }

        return $this->withActions('Ready to snooze:', [['snooze_task', ['card_id' => $card->id, 'summary' => "Hide “{$card->title}” from the Today flags for 3 days"]]]);
    }

    private function doAssign(string $raw): array
    {
        [$quoted, $text] = $this->quoted($raw);
        $w = $this->norm($text);
        $f = $this->filters($w);
        $bulk = preg_match('/\ball\b/', $w) && ($f['overdue'] || $f['unassigned'] || $f['project'] || $f['status'] || $f['stuck']);

        // the person is whoever follows "to"/"assign"; strip them out before looking for the task
        $w2 = $w;
        $project = $this->takeProject($w2);
        $personName = $this->takePerson($w2, true);
        if (! $personName) {
            return $this->out(self::NEED_MORE.': who to assign it to. Try *assign "Fix login" to Priya*.');
        }
        $emp = $this->employeeByName($personName);
        if (! $emp) {
            return $this->out("I couldn't find **{$personName}** in Taskmandu's employee list to assign them. Check the spelling, or that Taskmandu is reachable.");
        }

        if ($bulk) {
            $f['person'] = null; // "assign all overdue tasks to X": the person is the target, not a filter
            $targets = $this->applyFilters($f)->take(15);
            if ($targets->isEmpty()) {
                return $this->out('No tasks match that, so nothing to assign.');
            }
        } else {
            [$card, $reply] = $this->resolveTask($quoted ?: $this->residualTitle($w2, $text), $text);
            if (! $card) {
                return $reply;
            }
            $targets = collect([$card]);
        }

        $actions = $targets->map(fn ($c) => ['update_task', [
            'project_id' => $c->project_id, 'task_id' => $c->task_id, 'assignee_ids' => [$emp['id']],
            'summary' => "Assign “{$c->title}” to {$emp['name']}".($c->assignee ? " (replaces {$c->assignee})" : ''),
        ]])->all();

        return $this->withActions($targets->count() > 1 ? "Ready to assign {$targets->count()} tasks to **{$emp['name']}**:" : 'Ready to assign:', $actions);
    }

    private function doReschedule(string $raw): array
    {
        [$quoted, $text] = $this->quoted($raw);
        $w = $this->norm($text);
        $f = $this->filters($w);
        $date = $this->takeDate($w);
        if (! $date) {
            return $this->out(self::NEED_MORE.': the new due date (e.g. *friday*, *next week*, *30 nov*). Try *move "Fix login" to friday*.');
        }
        $bulk = preg_match('/\ball\b/', $w) && ($f['overdue'] || $f['unassigned'] || $f['project'] || $f['person'] || $f['status'] || $f['stuck']);
        if ($bulk) {
            $f['range'] = null;
            $targets = $this->applyFilters($f)->take(15);
            if ($targets->isEmpty()) {
                return $this->out('No tasks match that, so nothing to move.');
            }
        } else {
            $w2 = $w;
            $this->takeProject($w2);
            [$card, $reply] = $this->resolveTask($quoted ?: $this->residualTitle($w2, $text), $text);
            if (! $card) {
                return $reply;
            }
            $targets = collect([$card]);
        }
        $to = $date[0]->format('D j M');
        $actions = $targets->map(fn ($c) => ['update_task', [
            'project_id' => $c->project_id, 'task_id' => $c->task_id, 'due_date' => $date[0]->toDateString(),
            'summary' => "Move “{$c->title}” due date to {$to}".($c->due_at ? ' (was '.$c->due_at->format('j M').')' : ''),
        ]])->all();

        return $this->withActions($targets->count() > 1 ? "Ready to move {$targets->count()} tasks to **{$to}**:" : 'Ready to reschedule:', $actions);
    }

    private function looksLikePriorityChange(string $n): bool
    {
        return (bool) (preg_match('/\b(set|make|change|mark|raise|bump|lower|update)\b/', $n) && preg_match('/\bpriority\b/', $n) && $this->takePriority($n));
    }

    private function doPriority(string $raw): array
    {
        [$quoted, $text] = $this->quoted($raw);
        $w = $this->norm($text);
        $prio = $this->takePriority($w);
        $this->takeProject($w);
        [$card, $reply] = $this->resolveTask($quoted ?: $this->residualTitle($w, $text), $text);
        if (! $card) {
            return $reply;
        }

        return $this->withActions('Ready to change priority:', [['update_task', [
            'project_id' => $card->project_id, 'task_id' => $card->task_id, 'priority' => ucfirst($prio),
            'summary' => "Set “{$card->title}” to ".ucfirst($prio).' priority'.($card->priority ? " (was {$card->priority})" : ''),
        ]]]);
    }

    private function doStatus(string $raw): array
    {
        [$quoted, $text] = $this->quoted($raw);
        $w = $this->norm($text);
        $status = $this->statusFromText($w, true);
        $f = $this->filters($w);
        $bulk = preg_match('/\ball\b/', $w) && ($f['overdue'] || $f['unassigned'] || $f['project'] || $f['person'] || $f['stuck']);

        if ($bulk) {
            $f['status'] = [];
            $f['includeDone'] = false;
            $targets = $this->applyFilters($f)->take(15);
            if ($targets->isEmpty()) {
                return $this->out('No tasks match that, so nothing to change.');
            }
        } else {
            $w2 = $w;
            $this->takeProject($w2);
            $this->takeDate($w2);
            [$card, $reply] = $this->resolveTask($quoted ?: $this->residualTitle($w2, $text), $text);
            if (! $card) {
                return $reply;
            }
            $targets = collect([$card]);
        }

        $actions = $targets->map(fn ($c) => ['update_task', [
            'project_id' => $c->project_id, 'task_id' => $c->task_id, 'status' => $status,
            'summary' => "Mark “{$c->title}” as {$status}".($c->status ? " (was {$c->status})" : ''),
        ]])->all();

        return $this->withActions($targets->count() > 1 ? "Ready to mark {$targets->count()} tasks as **{$status}**:" : 'Ready to update:', $actions);
    }

    /* ================================================================== */
    /* Task / project / person resolution                                  */
    /* ================================================================== */

    /**
     * Finds the one task the person means. Returns [card, null] or [null, reply] where the reply
     * asks them to be more specific.
     *
     * @return array{0: ?PmCard, 1: ?array}
     */
    private function resolveTask(string $query, string $context): array
    {
        $q = $this->tokens($query);
        if (! $q) {
            return [null, $this->out(self::NEED_MORE.': which task you mean. Put its name in quotes, e.g. *mark "Fix login" as done*.')];
        }

        $scored = $this->cards->filter(fn ($c) => $c->task_id && $c->project_id && $c->status !== 'Cancelled')->map(function ($c) use ($q, $query) {
            $t = $this->tokens($c->title);
            $hit = count(array_intersect($q, $t));
            $nt = trim($this->norm($c->title));
            $nq = trim($this->norm($query));
            $score = $nt === $nq ? 1.5
                : (Str::contains($nt, $nq) ? 1.0 : ($hit / max(1, count($q))) * 0.8 + ($hit / max(1, count($t))) * 0.2);
            // open tasks are what people usually mean
            if (in_array($c->status, ['Completed'], true)) {
                $score -= 0.05;
            }

            return ['card' => $c, 'score' => $score, 'hit' => $hit];
        })->filter(fn ($r) => $r['hit'] > 0 && $r['score'] >= 0.55)->sortByDesc('score')->values();

        if ($scored->isEmpty()) {
            return [null, $this->out("I couldn't find a task matching “".trim($query)."”. Try the exact title in quotes, or ask *show tasks about …* to find it.")];
        }
        $top = $scored->first();
        $second = $scored->get(1);
        if ($second && $second['score'] >= $top['score'] - 0.08 && $second['card']->id !== $top['card']->id && $top['score'] < 1.4) {
            $opts = $scored->take(5)->map(fn ($r) => '- **'.$r['card']->title.'** — '.$r['card']->project_name.' · '.($r['card']->assignee ?: 'unassigned'))->implode("\n");

            return [null, $this->out("A few tasks match that — which one?\n{$opts}\n\nSay it again with the exact title in quotes.")];
        }

        return [$top['card'], null];
    }

    /** Words left after removing the verbs/filler, as the likely task description. */
    private function residualTitle(string $normalized, string $raw): string
    {
        $words = array_filter(explode(' ', $normalized), fn ($w) => $w !== '' && ! in_array($w, self::STOP, true));

        return trim(implode(' ', $words));
    }

    private function matchesTerms(PmCard $c, string $terms): bool
    {
        $hay = $this->norm($c->title.' '.$c->project_name.' '.$c->assignee.' '.strip_tags((string) $c->description).' '.implode(' ', (array) $c->tags));
        foreach ($this->tokens($terms) as $t) {
            if (! str_contains($hay, $t)) {
                return false;
            }
        }

        return true;
    }

    /** @return array<int, string> */
    private function tokens(string $s): array
    {
        return array_values(array_unique(array_filter(
            preg_split('/\s+/', trim($this->norm($s))) ?: [],
            fn ($w) => mb_strlen($w) > 1 && ! in_array($w, self::STOP, true)
        )));
    }

    private function searchTerms(string $n, array $extraStop = []): string
    {
        $stop = array_merge(self::STOP, $extraStop, [
            'what', 'whats', 'which', 'who', 'whom', 'whose', 'how', 'many', 'much', 'show', 'list', 'find', 'search', 'tell', 'give', 'get', 'see', 'any', 'are', 'there',
            'do', 'does', 'did', 'have', 'has', 'had', 'we', 'us', 'our', 'your', 'they', 'them', 'their', 'with', 'work', 'working', 'open', 'where', 'when', 'tasks', 'task',
            'ticket', 'tickets', 'cards', 'number', 'count', 'total', 'currently', 'right', 'again', 'everything', 'anything', 'something', 'someone', 'one', 'ones', 'thing', 'things',
            'status', 'pending', 'progress', 'todo', 'assigned', 'looking', 'look', 'want', 'know', 'is', 'am', 'been', 'being', 'will', 'should', 'got', 'wheres',
        ]);

        return trim(implode(' ', array_filter(explode(' ', trim($n)), fn ($w) => $w !== '' && mb_strlen($w) > 1 && ! in_array($w, $stop, true) && ! preg_match('/^\d+$/', $w))));
    }

    /** @return array{id: string, name: string}|null  — and removes the matched words from $w */
    private function takeProject(string &$w): ?array
    {
        $hit = $this->project($w);
        if ($hit) {
            $w = preg_replace('/\b(in|for|on|under|from|within)?\s*(the\s+)?'.preg_quote($hit['matched'], '/').'\s*(project)?/u', ' ', $w, 1);
        }

        return $hit ? ['id' => $hit['id'], 'name' => $hit['name']] : null;
    }

    /** @return array{id: string, name: string, matched: string}|null */
    private function project(string $n): ?array
    {
        $best = null;
        foreach ($this->projectList() as $p) {
            $name = trim($this->norm($p['name']));
            if ($name === '') {
                continue;
            }
            $sig = $this->tokens($name);
            $matched = null;
            if (preg_match('/\b'.preg_quote($name, '/').'\b/u', $n)) {
                $matched = $name;
            } elseif ($sig && count($sig) >= 2 && ! array_diff($sig, preg_split('/\s+/', trim($n)))) {
                $matched = implode(' ', $sig);
            } elseif (count($sig) === 1 && mb_strlen($sig[0]) >= 4 && preg_match('/\b'.preg_quote($sig[0], '/').'\b/u', $n)) {
                $matched = $sig[0];
            }
            if ($matched !== null && (! $best || mb_strlen($matched) > mb_strlen($best['matched']))) {
                $best = $p + ['matched' => $matched];
            }
        }

        return $best;
    }

    /** @return Collection<int, array{id: string, name: string}> */
    private function projectList(): Collection
    {
        return $this->cards->filter(fn ($c) => $c->project_id)->groupBy('project_id')
            ->map(fn ($cs, $id) => ['id' => (string) $id, 'name' => (string) ($cs->first()->project_name ?: 'Project')])->values();
    }

    /** Distinct people seen as assignees. */
    private function assignees(): Collection
    {
        return $this->cards->flatMap(fn ($c) => $this->splitNames($c->assignee))->unique()->sort()->values();
    }

    /** @return array<int, array{id:?string,name:string,designation:?string}> */
    private function employees(): array
    {
        if ($this->employees === null) {
            try {
                $this->employees = $this->taskmandu->listEmployees();
            } catch (\Throwable) {
                $this->employees = [];
            }
        }

        return $this->employees;
    }

    private function employeeByName(string $name): ?array
    {
        $needle = Str::lower($name);
        $emps = collect($this->employees())->filter(fn ($e) => ! empty($e['id']));
        $exact = $emps->first(fn ($e) => Str::lower($e['name']) === $needle);
        if ($exact) {
            return $exact;
        }
        $m = $emps->filter(fn ($e) => Str::startsWith(Str::lower($e['name']), $needle) || in_array($needle, preg_split('/\s+/', Str::lower($e['name'])), true));

        return $m->count() === 1 ? $m->first() : null;
    }

    /** Full names + first names of people we know, preferring Taskmandu's list, else assignees on the board. */
    private function peopleNames(): Collection
    {
        $names = collect($this->employees())->pluck('name')->merge($this->assignees())->filter()->map(fn ($n) => trim($n))->unique();

        return $names->values();
    }

    /** Which known person (or "me") is mentioned? Returns the display name. */
    private function personIn(string $n): ?string
    {
        if (preg_match('/\b(me|my|mine|myself|i am|im|i have|ive)\b/', $n) && ! preg_match('/\b(tell me|show me|give me|let me|remind me|send me)\b(?! (my|mine))/', $n) || preg_match('/\b(my|mine)\b/', $n)) {
            $mine = $this->myName();
            if ($mine) {
                return $mine;
            }
        }
        $names = $this->peopleNames();
        // full names first, longest first
        foreach ($names->sortByDesc(fn ($x) => mb_strlen($x)) as $name) {
            if (preg_match('/\b'.preg_quote(Str::lower($name), '/').'(s)?\b/u', $n)) {
                return $name;
            }
        }
        // then unambiguous first names
        $firsts = $names->groupBy(fn ($x) => Str::lower(explode(' ', $x)[0]));
        foreach ($firsts as $first => $group) {
            if ($group->count() === 1 && mb_strlen($first) >= 3 && preg_match('/\b'.preg_quote($first, '/').'(s)?\b/u', $n)) {
                return $group->first();
            }
        }

        return null;
    }

    private function myName(): ?string
    {
        $mine = Str::lower($this->user->name);
        $first = explode(' ', $mine)[0];

        return $this->peopleNames()->first(fn ($x) => Str::lower($x) === $mine)
            ?? $this->peopleNames()->first(fn ($x) => explode(' ', Str::lower($x))[0] === $first);
    }

    private function takePerson(string &$w, bool $forAssignment = false): ?string
    {
        $name = $this->personIn($w);
        if ($name) {
            $first = preg_quote(Str::lower(explode(' ', $name)[0]), '/');
            $full = preg_quote(Str::lower($name), '/');
            $w = preg_replace('/\b(assign(?:ed)? to|reassign(?:ed)? to|hand over to|owned by|give|assign(?:ed)?|to|for|by|of|from)?\s*\b('.$full.'|'.$first.')(s)?\b/u', ' ', $w, 1);
            $w = preg_replace('/\b(me|my|mine|myself)\b/', ' ', $w);
        }

        return $name;
    }

    private function takePriority(string &$w): ?string
    {
        if (preg_match('/\b(critical|urgent|high|medium|low)\b(?: priority)?|\bpriority (critical|urgent|high|medium|low)\b/', $w, $m)) {
            $p = $m[1] ?: $m[2];
            $w = preg_replace('/\b(critical|urgent|high|medium|low)\b( priority)?|\bpriority (critical|urgent|high|medium|low)\b/', ' ', $w, 1);

            return $p === 'urgent' ? 'critical' : $p;
        }

        return null;
    }

    /** @return string|null  canonical status (Completed, Blocked…) found in text */
    private function statusFromText(string $n, bool $strict = false): ?string
    {
        foreach (self::STATUS_WORDS as $status => $words) {
            foreach ($words as $word) {
                if (preg_match('/\b'.preg_quote($word, '/').'\b/', $n)) {
                    if ($strict && $status === 'In Progress' && $word === 'working' && ! str_contains($n, 'working on')) {
                        continue;
                    }

                    return $status;
                }
            }
        }

        return null;
    }

    /* ================================================================== */
    /* Dates                                                               */
    /* ================================================================== */

    /** @return array{0: Carbon, 1: string}|null  [date, matched phrase] */
    private function findDate(string $n): ?array
    {
        $today = now()->startOfDay();
        $mon = implode('|', array_keys(self::MONTHS));
        $dow = implode('|', array_keys(self::DAYS));

        $rules = [
            ['/\b(today|tonight|eod|end of day|cob)\b/', fn () => $today->copy()],
            ['/\b(tomorrow|tmrw|tmr)\b/', fn () => $today->copy()->addDay()],
            ['/\byesterday\b/', fn () => $today->copy()->subDay()],
            ['/\b(next week)\b/', fn () => $today->copy()->next(Carbon::MONDAY)],
            ['/\b(end of (the )?week|eow|this friday)\b/', fn () => $today->copy()->isFriday() ? $today->copy() : $today->copy()->next(Carbon::FRIDAY)],
            ['/\b(next month)\b/', fn () => $today->copy()->addMonthNoOverflow()->startOfMonth()],
            ['/\b(end of (the )?month|eom)\b/', fn () => $today->copy()->endOfMonth()->startOfDay()],
            ['/\bin (\d{1,3}) (day|days|week|weeks)\b/', function ($m) use ($today) {
                return str_starts_with($m[2], 'week') ? $today->copy()->addWeeks((int) $m[1]) : $today->copy()->addDays((int) $m[1]);
            }],
            ['/\b(\d{4})-(\d{2})-(\d{2})\b/', fn ($m) => Carbon::createSafe((int) $m[1], (int) $m[2], (int) $m[3])?->startOfDay()],
            ['/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/', function ($m) use ($today) {
                $y = isset($m[3]) ? ((int) $m[3] < 100 ? 2000 + (int) $m[3] : (int) $m[3]) : $today->year;

                return Carbon::createSafe($y, (int) $m[2], (int) $m[1])?->startOfDay();
            }],
            ['/\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?('.$mon.')[a-z]*(?:\s+(\d{4}))?\b/', fn ($m) => $this->monthDay((int) $m[1], self::MONTHS[$m[2]], $m[3] ?? null)],
            ['/\b('.$mon.')[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s+(\d{4}))?\b/', fn ($m) => $this->monthDay((int) $m[2], self::MONTHS[$m[1]], $m[3] ?? null)],
            ['/\b(?:(next|this|coming)\s+)?('.implode('|', array_filter(array_keys(self::DAYS), fn ($d) => strlen($d) > 3)).')\b/', fn ($m) => $this->weekday($m[2], $m[1] ?? '')],
            ['/\b(?:due|by|on|until|till|before|next|this)\s+('.$dow.')\b/', fn ($m) => $this->weekday($m[1], str_contains($m[0], 'next') ? 'next' : '')],
        ];

        foreach ($rules as [$re, $fn]) {
            if (preg_match($re, $n, $m)) {
                $d = $fn($m);
                if ($d) {
                    return [$d, $m[0]];
                }
            }
        }

        return null;
    }

    private function monthDay(int $day, int $month, ?string $year): ?Carbon
    {
        $y = $year ? (int) $year : now()->year;
        $d = Carbon::createSafe($y, $month, $day);
        if ($d && ! $year && $d->lt(now()->startOfDay()->subDays(60))) {
            $d = $d->addYear();
        }

        return $d?->startOfDay();
    }

    private function weekday(string $name, string $mod): Carbon
    {
        $today = now()->startOfDay();
        $target = self::DAYS[$name];
        if ($mod === 'this' && $today->dayOfWeekIso <= $target) {
            return $today->copy()->startOfWeek()->addDays($target - 1);
        }

        return $today->copy()->next($target);
    }

    /** Takes a single due date out of $w. @return array{0: Carbon, 1: string}|null */
    private function takeDate(string &$w): ?array
    {
        $hit = $this->findDate($w);
        if ($hit) {
            $w = preg_replace('/\b(due|by|on|until|till|before|for|to|until)?\s*'.preg_quote($hit[1], '/').'/u', ' ', $w, 1);
        }

        return $hit;
    }

    /** A range for list questions ("this week", "next 7 days", "today"). @return array{0: Carbon, 1: Carbon, 2: string}|null */
    private function takeRange(string &$w): ?array
    {
        $t = now()->startOfDay();
        $map = [
            ['/\b(this week)\b/', [$t->copy()->startOfWeek(), $t->copy()->endOfWeek()->startOfDay(), 'this week']],
            ['/\b(next week)\b/', [$t->copy()->addWeek()->startOfWeek(), $t->copy()->addWeek()->endOfWeek()->startOfDay(), 'next week']],
            ['/\b(last week)\b/', [$t->copy()->subWeek()->startOfWeek(), $t->copy()->subWeek()->endOfWeek()->startOfDay(), 'last week']],
            ['/\b(this month)\b/', [$t->copy()->startOfMonth(), $t->copy()->endOfMonth()->startOfDay(), 'this month']],
            ['/\b(last month)\b/', [$t->copy()->subMonthNoOverflow()->startOfMonth(), $t->copy()->subMonthNoOverflow()->endOfMonth()->startOfDay(), 'last month']],
            ['/\b(due soon|coming up|upcoming)\b/', [$t->copy(), $t->copy()->addDays(3), 'in the next 3 days']],
        ];
        foreach ($map as [$re, $range]) {
            if (preg_match($re, $w)) {
                $w = preg_replace($re, ' ', $w, 1);

                return $range;
            }
        }
        if (preg_match('/\b(next|last|past) (\d{1,3}) days\b/', $w, $m)) {
            $w = preg_replace('/\b(next|last|past) (\d{1,3}) days\b/', ' ', $w, 1);

            return $m[1] === 'next' ? [$t->copy(), $t->copy()->addDays((int) $m[2]), "in the next {$m[2]} days"] : [$t->copy()->subDays((int) $m[2]), $t->copy(), "in the last {$m[2]} days"];
        }
        if ($hit = $this->findDate($w)) {
            $w = preg_replace('/\b(due|by|on|until|till|before|for|to)?\s*'.preg_quote($hit[1], '/').'/u', ' ', $w, 1);
            if (preg_match('/\b('.implode('|', array_keys(self::DAYS)).')\b/', $hit[1]) && ! str_contains($hit[1], 'next') && (int) abs($hit[0]->diffInDays(now()->startOfDay())) === 7) {
                $hit[0] = now()->startOfDay(); // asking about "friday" on a Friday means today
            }

            return [$hit[0], $hit[0], $hit[0]->isToday() ? 'today' : ($hit[0]->isTomorrow() ? 'tomorrow' : ($hit[0]->isYesterday() ? 'yesterday' : 'on '.$hit[0]->format('D j M')))];
        }

        return null;
    }

    /* ================================================================== */
    /* Formatting + plumbing                                               */
    /* ================================================================== */

    private function taskLine(PmCard $c): string
    {
        return '- **'.$c->title.'** — '.($c->project_name ?: 'No project').' · '.($c->assignee ?: 'unassigned').' · '.$c->status.' · '.$this->dueText($c);
    }

    private function dueText(PmCard $c): string
    {
        if (! $c->due_at) {
            return 'no due date';
        }
        $days = (int) $c->due_at->copy()->startOfDay()->diffInDays(now()->startOfDay(), false);
        $d = $this->fmtDate($c->due_at);

        return $this->isOverdue($c) ? "due {$d} (".abs($days).'d late)' : ($c->due_at->isToday() ? 'due today' : "due {$d}");
    }

    private function fmtDate(Carbon $d): string
    {
        return $d->year === now()->year ? $d->format('D j M') : $d->format('j M Y');
    }

    private function isOverdue(PmCard $c): bool
    {
        return $c->due_at && $c->due_at->copy()->startOfDay()->lt(now()->startOfDay()) && ! in_array($c->status, ['Completed', 'Cancelled'], true);
    }

    private function open(): Collection
    {
        return $this->openOf($this->cards);
    }

    private function openOf(Collection $c): Collection
    {
        return $c->reject(fn ($x) => in_array($x->status, ['Completed', 'Cancelled'], true));
    }

    /** @return array<int, string> */
    private function splitNames(?string $s): array
    {
        return array_values(array_filter(array_map('trim', explode(',', (string) $s))));
    }

    /** Lowercases and strips punctuation, padding with spaces so " word " patterns work. @return string */
    private function norm(string $s): string
    {
        $s = Str::lower($s);
        $s = str_replace(["’", "'", '`'], '', $s);
        $s = preg_replace('/[^\p{L}\p{N}\s\/\-:]/u', ' ', $s);
        $s = preg_replace('/(?<=\s):|:(?=\s|$)/', ' ', $s);

        return ' '.trim(preg_replace('/\s+/', ' ', $s)).' ';
    }

    /** Pulls a "quoted title" out of the text. @return array{0: ?string, 1: string}  [quoted, text without it] */
    private function quoted(string $raw): array
    {
        if (preg_match('/["“”]([^"“”]{2,200})["“”]/u', $raw, $m) || preg_match('/(?<![\w])[‘\']([^‘’\']{2,200})[’\'](?![\w])/u', $raw, $m)) {
            return [trim($m[1]), trim(str_replace($m[0], ' ', $raw))];
        }

        return [null, $raw];
    }

    private function stripPhrases(string $title, ?string $datePhrase, ?string $priority): string
    {
        foreach (array_filter([$datePhrase, $priority ? "{$priority} priority" : null]) as $p) {
            $title = trim(preg_replace('/\b(due|by|on|needed by)?\s*'.preg_quote($p, '/').'/iu', '', $title, 1), " ,.-");
        }

        return $title;
    }

    private function withActions(string $intro, array $specs): array
    {
        $actions = [];
        foreach ($specs as [$tool, $args]) {
            $actions[] = ($this->queue)($tool, $args, $this->user);
        }
        $this->suggest = [];

        return $this->out($intro, $actions);
    }

    private function out(string $reply, array $actions = []): array
    {
        return ['reply' => $reply, 'actions' => $actions, 'tools' => array_values(array_unique($this->used)), 'suggestions' => $this->suggest, 'unhandled' => $this->unhandled];
    }

    private function notUnderstood(bool $short = false): string
    {
        $this->unhandled = true;
        $this->suggest = ["What's overdue?", 'Who has capacity this week?', 'Show unassigned tasks', 'help'];

        return ($short ? '' : "I didn't quite get that. ").'I can answer things like *what\'s overdue*, *what is Priya working on*, *how is the Salon site going*, and do things like *create task "Fix login" in Salon Site due friday*. Type **help** for the full list.';
    }

    private function help(): string
    {
        $this->suggest = ['Give me an overview', "What's overdue?", 'Who has capacity this week?', 'Show unassigned tasks'];

        return <<<'TXT'
Hi! I'm the built-in PM assistant — no AI service, I work straight from your board. Ask in plain English.

**Ask me**
- *Give me an overview* · *what's overdue?* · *what's blocked?* · *what's due this week?*
- *What is Priya working on?* · *my tasks* · *tasks in Salon Site due friday*
- *Who has capacity?* · *who is overloaded?* · *which tasks have no owner?*
- *How is Salon Site going?* · *list projects*
- *Open requests* · *ideas to review* · *last meeting decisions* · *list meetings* · *meeting follow-up*
- *Show meeting templates* · *ticket packs* · *show drafts* · *latest weekly report* · *list reports*
- *Open QA issues* · *critical QA bugs* · *who is waiting on a client?* · *list businesses*
- *Show sub-tasks for Priya* · *latest comments* · *project health* · *git status* · *contacts*
- *What do you know?* lists everything I can read · *where do I find reports?*

**Tell me to do things** (I always ask you to confirm first)
- *Create task "Fix login" in Salon Site due friday assign to Priya priority high*
- *Mark "Fix login" as done* · *block "Fix login"*
- *Move "Fix login" to next monday* · *move all overdue tasks to friday*
- *Assign "Fix login" to Priya* · *assign all unassigned tasks in Salon Site to Sam*
- *Comment on "Fix login": waiting on client* · *add subtask "Write tests" to "Fix login"*
- *Log a client request: add dark mode* · *snooze "Fix login"* · *sync*

Tip: put task names in quotes so I always pick the right one.
TXT;
    }
}
