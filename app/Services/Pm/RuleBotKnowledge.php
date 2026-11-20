<?php

namespace App\Services\Pm;

use App\Models\PmBusiness;
use Carbon\Carbon;
use Illuminate\Support\Str;

/**
 * Everything in the PM that is not a Taskmandu task: templates, packs, minutes extras, drafts, reports,
 * QA, businesses, waiting-on-client, health, contacts, sub-tasks, Taskmandu activity, Git, plus "where do I…" guides.
 * Used by RuleBot; reads through PmKnowledge so the AI tool returns the same facts.
 */
trait RuleBotKnowledge
{
    private function kb(): PmKnowledge
    {
        return app(PmKnowledge::class);
    }

    /** @return array<string, mixed>|null  null = not a question about these areas */
    private function knowledge(string $raw, string $n): ?array
    {
        $hasProject = (bool) $this->project($n);
        $mentionsTask = (bool) preg_match('/\btasks?\b|\btickets?\b/', $n);

        if (preg_match('/\b(what data|what do you know|what can you see|what all|everything you (have|know)|what is in (the )?(pm|dashboard|app|system)|whats in (the )?(pm|dashboard|app|system)|data you have|what do you have)\b/', $n)) {
            return $this->kbInventory();
        }
        if (preg_match('/\b(waiting|awaiting|pending|chasing)\b.*\bclients?\b|\bclients?\b.*\b(reply|response|feedback|approval|waiting)\b/', $n)) {
            return $this->kbList('waiting_client', $this->kbTerm($n, ['waiting', 'awaiting', 'client', 'clients', 'reply', 'response', 'feedback', 'approval', 'pending', 'chasing']));
        }
        if (preg_match('/\btemplates?\b|\bticket packs?\b|\bpacks?\b|\brecurring meetings?\b/', $n)) {
            return $this->kbTemplates($n);
        }
        if (preg_match('/\bqa\b|\bretest(s|ing)?\b|\b(bug|bugs|defect|defects)\b/', $n) && ! $mentionsTask) {
            return $this->kbQa($n);
        }
        if (preg_match('/\b(daily|weekly)\b.*\b(report|summary|digest)\b|\breports?\b/', $n) && ! $hasProject && ! preg_match('/\bstatus report\b/', $n)) {
            return $this->kbReport($n);
        }
        if (preg_match('/\b(drafts?|briefs?)\b/', $n) && ! preg_match('/\b(meeting|meetings|minutes)\b/', $n)) {
            return $this->kbList('drafts', $this->kbTerm($n, ['draft', 'drafts', 'brief', 'briefs', 'ticket', 'tickets']), ['status' => preg_match('/\bpushed\b/', $n) ? 'pushed' : (preg_match('/\bpartial\b/', $n) ? 'partial' : null)]);
        }
        if (preg_match('/\b(businesses|business|clients|client|customers?|companies)\b/', $n) && ! preg_match('/\b(requests?|ideas?|intake)\b/', $n) && ! $mentionsTask) {
            return $this->kbBusinesses($n);
        }
        if (preg_match('/\b(health|risk|at risk|risky|score|red projects?|amber)\b/', $n) && ! $hasProject && ! $mentionsTask) {
            return $this->kbList('project_health', '');
        }
        if (preg_match('/\b(contacts?|e-?mails?|email address)\b/', $n) && ! preg_match('/\b(send|draft|write)\b/', $n)) {
            return $this->kbList('contacts', $this->personIn($n) ?: $this->kbTerm($n, ['contact', 'contacts', 'email', 'emails', 'mail', 'address', 'addresses', 'for', 'whats', 'whos', 'list', 'all', 'show']));
        }
        if (preg_match('/\bsub-?\s?tasks?\b/', $n)) {
            return $this->kbSubtasks($n);
        }
        if ((preg_match('/\b(comments?|commented)\b/', $n) && preg_match('/\b(what|which|who|show|list|latest|recent|any|new|last)\b/', $n))
            || preg_match('/\btaskmandu (activity|events?|updates?)\b/', $n)) {
            return $this->kbFeed($n);
        }
        if (preg_match('/\bgit\b|\bbranch(es)?\b|\bcommits?\b|\b(ahead|behind) (of )?(origin|remote|main)\b/', $n) && ! $mentionsTask) {
            return $this->kbList('git', '');
        }
        if (preg_match('/\b(follow-?\s?ups?|carry-?\s?over|open action items?|action items? (not|still)|unfinished action)\b/', $n)) {
            return $this->kbFollowUp();
        }

        return null;
    }

    /* ---------------- shared bits ---------------- */

    private function kbTerm(string $n, array $extra = []): string
    {
        $term = $this->searchTerms($n, $extra);
        // people / project names are filters elsewhere, not search text
        return trim($term);
    }

    private function kbInventory(): array
    {
        $this->used[] = 'lookup_pm_data';
        $i = $this->kb()->inventory();
        $cards = $this->cards;
        $open = $this->open();

        return $this->out(implode("\n", [
            'Here is everything I can read, and how much is in it:',
            "- **Tasks** — {$cards->count()} synced ({$open->count()} open), across ".$cards->pluck('project_name')->filter()->unique()->count().' projects',
            "- **Sub-tasks** — {$i['subtasks_open']} open of {$i['subtasks_total']}",
            "- **Meeting minutes** — {$i['meeting_minutes']}".($i['latest_minutes'] ? " (latest: {$i['latest_minutes']})" : ''),
            "- **Meeting templates** — {$i['meeting_templates']} · **Ticket packs** — {$i['ticket_packs']}",
            "- **Drafts (Brief)** — {$i['drafts']}",
            "- **Reports** — {$i['reports']}".($i['latest_report'] ? " (latest: {$i['latest_report']})" : ''),
            "- **QA issues** — {$i['qa_open']} open of {$i['qa_total']}",
            "- **Businesses** — {$i['businesses']} · **Open requests & ideas** — {$i['open_intakes']}",
            "- **Waiting on client** — {$i['waiting_on_client']}",
            "- **Contacts** — {$i['contacts']} · **Taskmandu activity events** — {$i['taskmandu_events']}",
            '- **Git** status and branches, **team workload**, **project health**',
            '',
            'Ask about any of them in plain English, e.g. *show meeting templates*, *latest weekly report*, *open QA issues*, *who is waiting on a client?*',
        ]));
    }

    /** Generic "list rows of this kind" renderer. */
    private function kbList(string $kind, string $term, array $opts = []): array
    {
        $this->used[] = 'lookup_pm_data';
        $res = $this->kb()->fetch($kind, array_filter(['term' => $term, 'limit' => 12] + $opts, fn ($v) => $v !== null && $v !== ''));
        $rows = $res['rows'];
        $label = ['waiting_client' => 'waiting on a client', 'drafts' => 'drafts', 'project_health' => 'projects with a health score', 'contacts' => 'contacts', 'git' => 'git status'][$kind] ?? $kind;

        if (! $rows) {
            if ($kind === 'git') {
                return $this->out("Git isn't available on this server (it has no repository checkout).");
            }
            $this->unhandled = $term !== '';

            return $this->out($term !== '' ? "Nothing in {$label} matches “{$term}”." : "Nothing in {$label} yet.");
        }

        $line = match ($kind) {
            'waiting_client' => fn ($r) => "- **{$r['title']}** — waiting {$r['days_waiting']} day".($r['days_waiting'] === 1 ? '' : 's').' (since '.Carbon::parse($r['waiting_since'])->format('j M').')'.($r['last_checked'] ? ', last checked '.Carbon::parse($r['last_checked'])->format('j M') : ''),
            'drafts' => fn ($r) => "- **{$r['title']}** — {$r['status']} · {$r['ticket_count']} ticket".($r['ticket_count'] === 1 ? '' : 's').($r['created_by'] ? " · by {$r['created_by']}" : '')." · {$r['updated']}".($r['tickets'] ? "\n  Tickets: ".implode('; ', array_slice($r['tickets'], 0, 4)).($r['ticket_count'] > 4 ? '…' : '') : ''),
            'project_health' => fn ($r) => "- **{$r['project']}** — {$r['health']} (score {$r['score']}) · {$r['overdue']} overdue · idle {$r['idle_days']}d · {$r['as_of']}",
            'contacts' => fn ($r) => "- **{$r['name']}** — {$r['email']}",
            'git' => fn ($r) => "Branch **{$r['branch']}** · {$r['ahead']} ahead / {$r['behind']} behind · {$r['uncommitted_files']} uncommitted file".($r['uncommitted_files'] === 1 ? '' : 's')
                .($r['last_commit']['hash'] ? "\nLast commit: {$r['last_commit']['hash']} — {$r['last_commit']['subject']} ({$r['last_commit']['author']}, {$r['last_commit']['when']})" : '')
                .($r['branches'] ? "\nBranches: ".implode(', ', $r['branches']) : ''),
            default => fn ($r) => '- '.json_encode($r),
        };

        $head = $kind === 'git' ? '' : "**{$res['total']}** {$label}".($term !== '' ? " matching “{$term}”" : '').":\n";
        $body = implode("\n", array_map($line, $rows));
        $more = $res['total'] > count($rows) ? "\n…and ".($res['total'] - count($rows)).' more.' : '';

        return $this->out($head.$body.$more);
    }

    /* ---------------- templates & packs ---------------- */

    private function kbTemplates(string $n): array
    {
        $this->used[] = 'lookup_pm_data';
        $wantPacks = (bool) preg_match('/\bpacks?\b/', $n);
        $wantMeet = (bool) preg_match('/\b(meeting|meetings|recurring|weekly|standup|minutes)\b/', $n);
        $term = $this->kbTerm($n, ['template', 'templates', 'meeting', 'meetings', 'minutes', 'recurring', 'ticket', 'tickets', 'pack', 'packs', 'saved', 'active', 'inactive', 'existing', 'available', 'weekly', 'standup']);
        $out = [];

        if (! $wantPacks || $wantMeet) {
            $r = $this->kb()->fetch('meeting_templates', ['term' => $term, 'limit' => 12]);
            if ($r['rows']) {
                $out[] = "**Meeting templates** ({$r['total']}) — these create a draft minutes entry automatically on their weekday:\n".implode("\n", array_map(
                    fn ($t) => "- **{$t['name']}** — every {$t['weekday']}".($t['time'] ? " at {$t['time']}" : '').($t['project'] ? " · {$t['project']}" : '').($t['active'] ? '' : ' · *paused*')
                        .($t['attendees'] ? "\n  Attendees: ".implode(', ', $t['attendees']) : '').($t['topics'] ? "\n  Agenda: ".implode('; ', $t['topics']) : ''),
                    $r['rows']
                ));
            } elseif (! $wantPacks) {
                $out[] = $term !== '' ? "No meeting template matches “{$term}”." : 'No meeting templates are saved yet.';
            }
        }
        if ($wantPacks || ! $wantMeet) {
            $r = $this->kb()->fetch('ticket_packs', ['term' => $term, 'limit' => 12]);
            if ($r['rows']) {
                $out[] = "**Ticket packs** ({$r['total']}) — reusable sets of tickets:\n".implode("\n", array_map(
                    fn ($p) => "- **{$p['name']}** — {$p['ticket_count']} ticket".($p['ticket_count'] === 1 ? '' : 's').($p['description'] ? " · {$p['description']}" : '')
                        .($p['tickets'] ? "\n  ".implode('; ', array_slice($p['tickets'], 0, 6)).($p['ticket_count'] > 6 ? '…' : '') : ''),
                    $r['rows']
                ));
            } else {
                $out[] = $term !== '' ? "No ticket pack matches “{$term}”." : 'No ticket packs are saved yet.';
            }
        }
        $this->suggest = ['Show last meeting minutes', 'Show drafts'];

        return $this->out(implode("\n\n", $out));
    }

    /* ---------------- QA ---------------- */

    private function kbQa(string $n): array
    {
        $this->used[] = 'lookup_pm_data';
        $o = ['limit' => 12, 'open' => true];
        if (preg_match('/\b(critical|high|medium|low)\b/', $n, $m)) {
            $o['severity'] = ucfirst($m[1]);
        }
        foreach (['ready for retest' => 'Ready for Retest', 'retest' => 'Ready for Retest', 'fixing' => 'Fixing', 'passed' => 'Passed', 'failed' => 'Failed', 'reported' => 'Reported', 'draft' => 'Draft'] as $w => $status) {
            if (preg_match('/\b'.$w.'\b/', $n)) {
                $o['status'] = $status;
                break;
            }
        }
        if (preg_match('/\b(all|every|history|closed)\b/', $n)) {
            $o['open'] = false;
        }
        $biz = $this->kbBusinessIn($n);
        $o['term'] = $biz ?: $this->kbTerm($n, ['qa', 'issue', 'issues', 'bug', 'bugs', 'defect', 'defects', 'retest', 'retests', 'critical', 'high', 'medium', 'low', 'severity', 'failed', 'passed', 'fixing', 'reported', 'draft', 'ready', 'open', 'closed', 'history', 'center', 'centre', 'testing', 'test']);

        $r = $this->kb()->fetch('qa_issues', $o);
        if (! $r['rows']) {
            return $this->out('No QA issues match that.'.(! empty($o['term']) ? " (searched for “{$o['term']}”)" : ''));
        }
        $count = preg_match('/\bhow many|number of|count\b/', $n);
        $head = "**{$r['total']}** QA issue".($r['total'] === 1 ? '' : 's').(isset($o['status']) ? " — {$o['status']}" : ($o['open'] ? ' open' : '')).(isset($o['severity']) ? " · {$o['severity']}" : '').':';
        if ($count) {
            return $this->out(rtrim($head, ':').'.');
        }
        $lines = array_map(fn ($i) => "- **{$i['title']}** — {$i['severity']} · {$i['status']}".($i['business'] ? " · {$i['business']}" : '').($i['site_app'] ? " / {$i['site_app']}" : '').($i['assignee'] ? " · {$i['assignee']}" : ''), $r['rows']);
        $this->suggest = ['Show critical QA issues', 'Which QA issues are ready for retest?'];

        return $this->out($head."\n".implode("\n", $lines).($r['total'] > count($r['rows']) ? "\n…and ".($r['total'] - count($r['rows'])).' more in the QA Center.' : ''));
    }

    /* ---------------- reports ---------------- */

    private function kbReport(string $n): array
    {
        $this->used[] = 'lookup_pm_data';
        $kind = preg_match('/\bweekly|week\b/', $n) ? 'weekly' : (preg_match('/\bdaily|day|today|yesterday\b/', $n) ? 'daily' : null);
        $o = ['limit' => 1];
        if ($kind) {
            $o['kind'] = $kind;
        }
        if ($hit = $this->findDate($n)) {
            $o['date'] = ReportService::normalizeDate($hit[0], $kind ?? 'daily')->toDateString();
        }

        if (preg_match('/\b(list|all|history|how many|previous|past)\b/', $n)) {
            $o['limit'] = 8;
            $r = $this->kb()->fetch('reports', $o);
            if (! $r['rows']) {
                return $this->out('No reports saved yet. Generate one from the Reports page.');
            }

            return $this->out("**{$r['total']}** saved report".($r['total'] === 1 ? '' : 's').":\n".implode("\n", array_map(
                fn ($x) => "- **".ucfirst($x['kind']).'** — '.Carbon::parse($x['date'])->format('D j M Y').($x['auto'] ? ' · auto' : '').($x['generated_by'] ? " · {$x['generated_by']}" : ''),
                $r['rows']
            )));
        }

        $r = $this->kb()->fetch('reports', $o);
        if (! $r['rows']) {
            return $this->out(isset($o['date']) ? 'No '.($kind ?? '').' report was saved for that date.' : 'No reports saved yet. Generate one from the Reports page.');
        }
        $x = $r['rows'][0];
        $this->suggest = ['List reports', $x['kind'] === 'daily' ? 'Latest weekly report' : 'Latest daily report'];

        return $this->out('**'.ucfirst($x['kind']).' report** — '.Carbon::parse($x['date'])->format('D j M Y').($x['auto'] ? ' (auto-generated)' : '').($x['generated_by'] ? " by {$x['generated_by']}" : '')."\n\n".$x['body']);
    }

    /* ---------------- businesses ---------------- */

    private function kbBusinessIn(string $n): ?string
    {
        foreach (PmBusiness::query()->pluck('name') as $name) {
            if (preg_match('/\b'.preg_quote(Str::lower($name), '/').'\b/u', $n)) {
                return $name;
            }
        }

        return null;
    }

    private function kbBusinesses(string $n): array
    {
        $this->used[] = 'lookup_pm_data';
        $named = $this->kbBusinessIn($n);
        $term = $named ?: $this->kbTerm($n, ['business', 'businesses', 'client', 'clients', 'customer', 'customers', 'company', 'companies', 'list', 'all', 'show', 'our', 'details', 'info', 'about']);
        $r = $this->kb()->fetch('businesses', ['term' => $term, 'limit' => 15]);
        if (! $r['rows']) {
            return $this->out($term !== '' ? "No business matches “{$term}”." : 'No businesses are set up yet — add them in Operations.');
        }
        $lines = array_map(fn ($b) => "- **{$b['name']}** — {$b['status']} · {$b['open_requests']} open request".($b['open_requests'] === 1 ? '' : 's')
            .($b['projects'] ? ' · projects: '.implode(', ', $b['projects']) : ' · no projects linked').($named && $b['description'] ? "\n  {$b['description']}" : ''), $r['rows']);

        return $this->out("**{$r['total']}** business".($r['total'] === 1 ? '' : 'es').":\n".implode("\n", $lines));
    }

    /* ---------------- sub-tasks / activity ---------------- */

    private function kbSubtasks(string $n): array
    {
        $this->used[] = 'lookup_pm_data';
        $o = ['limit' => 12, 'status' => preg_match('/\b(completed?|done|finished)\b/', $n) ? 'completed' : (preg_match('/\bblocked\b/', $n) ? 'Blocked' : 'open')];
        if ($person = $this->personIn($n)) {
            $o['person'] = $person;
        }
        if ($p = $this->project($n)) {
            $o['project'] = $p['name'];
        }
        if (preg_match('/\b(unassigned|no owner|nobody|no one|without (an )?(owner|assignee))\b/', $n)) {
            $o['unassigned'] = true;
        }
        $term = $this->kbTerm($n, ['subtask', 'subtasks', 'sub', 'completed', 'complete', 'done', 'finished', 'blocked', 'unassigned', 'open', 'owner', 'nobody', 'assignee', 'without']);
        $o['term'] = ($person || $p) ? '' : $term;

        $r = $this->kb()->fetch('subtasks', $o);
        if (! $r['rows']) {
            return $this->out('No sub-tasks match that.');
        }
        if (preg_match('/\bhow many|number of|count\b/', $n)) {
            return $this->out("**{$r['total']}** sub-task".($r['total'] === 1 ? '' : 's').' match.');
        }
        $lines = array_map(fn ($s) => "- **{$s['title']}** — {$s['status']} · ".($s['assignee'] ?: '*unassigned*')." · under “{$s['task']}” ({$s['project']})".($s['task_due'] ? ' · due '.Carbon::parse($s['task_due'])->format('j M') : ''), $r['rows']);

        return $this->out("**{$r['total']}** sub-task".($r['total'] === 1 ? '' : 's').":\n".implode("\n", $lines).($r['total'] > count($r['rows']) ? "\n…and ".($r['total'] - count($r['rows'])).' more.' : ''));
    }

    private function kbFeed(string $n): array
    {
        $this->used[] = 'lookup_pm_data';
        $o = ['limit' => 10];
        if ($person = $this->personIn($n)) {
            $o['person'] = $person;
        }
        if ($p = $this->project($n)) {
            $o['project'] = $p['name'];
        }
        $o['term'] = ($person || $p) ? '' : $this->kbTerm($n, ['comment', 'comments', 'commented', 'latest', 'recent', 'new', 'last', 'taskmandu', 'activity', 'event', 'events', 'update', 'updates', 'any']);

        $r = $this->kb()->fetch('activity_feed', $o);
        if (! $r['rows']) {
            return $this->out('No Taskmandu activity matches that.');
        }
        $lines = array_map(function ($e) {
            $what = $e['subtask'] ? "{$e['subtask']} (sub-task of {$e['task']})" : ($e['task'] ?: $e['project']);
            $change = $e['from'] || $e['to'] ? " · {$e['from']} → {$e['to']}" : '';

            return "- {$e['when']} · **".str_replace('_', ' ', $e['type'])."** on {$what}".($e['by'] ? " by {$e['by']}" : '').$change.($e['text'] ? "\n  “{$e['text']}”" : '');
        }, $r['rows']);

        return $this->out("Latest Taskmandu activity ({$r['total']} matching):\n".implode("\n", $lines));
    }

    private function kbFollowUp(): array
    {
        $this->used[] = 'meeting_follow_up';
        $f = app(MeetingFollowUpService::class)->latest();
        if (! $f) {
            return $this->out('There is no recent meeting to follow up (follow-up covers meetings from the last '.config('pm.followup.max_age_days', 14).' days).');
        }
        $m = $f['meeting'];
        $c = $f['counts'];
        $lines = collect($f['items'])->take(12)->map(fn ($i) => '- '.str_replace('_', ' ', $i['state']).' · **'.($i['title'] ?? 'Work item').'**'.(! empty($i['owner']) ? " — {$i['owner']}" : '').(! empty($i['due']) ? ' · due '.Carbon::parse($i['due'])->format('j M') : ''));

        return $this->out("Follow-up for **{$m['title']}** ({$m['days_ago']} day".($m['days_ago'] === 1 ? '' : 's')." ago): {$c['total']} work items — ".collect($c)->except('total')->filter()->map(fn ($v, $k) => "{$v} ".str_replace('_', ' ', $k))->implode(', ').".\n".$lines->implode("\n"));
    }

    /* ---------------- search everything ---------------- */

    /** Last resort for "find X": looks through minutes, requests, QA, drafts, templates, businesses, contacts. */
    private function kbSearchAll(string $term): ?array
    {
        $term = trim($term);
        if ($term === '') {
            return null;
        }
        $this->used[] = 'lookup_pm_data';
        $sections = [];
        $labels = ['minutes' => 'Meeting minutes', 'qa_issues' => 'QA issues', 'drafts' => 'Drafts', 'meeting_templates' => 'Meeting templates', 'ticket_packs' => 'Ticket packs', 'businesses' => 'Businesses', 'contacts' => 'Contacts', 'subtasks' => 'Sub-tasks'];
        foreach ($labels as $kind => $label) {
            $o = ['term' => $term, 'limit' => 3] + ($kind === 'qa_issues' ? ['open' => false] : []) + ($kind === 'subtasks' ? ['status' => 'all'] : []);
            $r = $this->kb()->fetch($kind, $o);
            if ($r['rows']) {
                $sections[] = "**{$label}** ({$r['total']}): ".collect($r['rows'])->map(fn ($x) => $x['title'] ?? $x['name'])->implode('; ');
            }
        }
        $intakes = \App\Models\PmIntake::query()->where(fn ($q) => $q->whereRaw('LOWER(title) LIKE ?', ['%'.Str::lower($term).'%'])->orWhereRaw('LOWER(description) LIKE ?', ['%'.Str::lower($term).'%']))->limit(3)->get();
        if ($intakes->isNotEmpty()) {
            $sections[] = '**Requests & ideas**: '.$intakes->pluck('title')->implode('; ');
        }

        return $sections ? $this->out("No task matches “{$term}”, but I found it elsewhere:\n".implode("\n", array_map(fn ($s) => "- {$s}", $sections))) : null;
    }

    /* ---------------- where do I… ---------------- */

    private function guide(string $n): ?array
    {
        $topics = [
            '/\b(template|templates|recurring|pack|packs)\b/' => "**Meeting templates and ticket packs** are read by the daily automation: on a template's weekday it creates a draft entry in *Minutes* with the agenda and attendees filled in. There is no screen to create them yet — I can read and list them (*show meeting templates*), and I can add a screen for them if you want.",
            '/\b(minutes|meeting|meetings)\b/' => '**Minutes** (sidebar → Planning → Minutes): record a meeting with attendees, agenda, topics, decisions and action items; paste raw notes to get a draft; *carry over* open work from the last meeting; push action items to Taskmandu as tasks. Ask me *last meeting decisions* or *meeting follow-up*.',
            '/\b(brief|draft|drafts)\b/' => '**Brief** (sidebar → Planning → Brief): paste a client brief, it drafts tickets you can edit, then push them to a project board (pushes can be undone). Saved ones are *Drafts* — ask me *show drafts*.',
            '/\b(report|reports)\b/' => '**Reports** (sidebar → Oversight → Reports): generate a daily or weekly report from board activity, save it and copy it as text. Ask me *latest daily report* or *list reports*.',
            '/\bscope\b/' => '**Scope** (sidebar → Oversight → Scope): check a request against the agreed scope and optionally email the result.',
            '/\bgit\b/' => '**Git** (sidebar → Oversight → Git): branch, ahead/behind and uncommitted files, with fetch, pull, push and checkout. Ask me *git status*.',
            '/\bqa\b/' => '**QA Center** (sidebar → Oversight → QA): log issues with business, site/app, page, severity and status (Draft → Reported → Fixing → Ready for Retest → Passed/Failed). Ask me *open QA issues*.',
            '/\b(operations|request|requests|idea|ideas|business|businesses|intake)\b/' => '**Operations** (sidebar → Overview → Operations): businesses and their linked projects, plus the Requests & Ideas inbox. Tell me *log a client request: …* to add one.',
            '/\b(task|tasks)\b/' => '**Tasks** (sidebar → Overview → Tasks): every synced task with filters, plus Completed sub-tasks. I can find, create, assign, reschedule or complete tasks — always with a Confirm click.',
            '/\b(project|projects)\b/' => '**Projects** (sidebar → Overview → Projects): Taskmandu projects with members, tasks, documents and variables.',
            '/\b(sync|refresh)\b/' => 'Type **sync** and confirm to pull the latest from Taskmandu. Most answers come from the last sync.',
        ];
        foreach ($topics as $re => $text) {
            if (preg_match($re, $n)) {
                return $this->out($text);
            }
        }

        return null;
    }
}
