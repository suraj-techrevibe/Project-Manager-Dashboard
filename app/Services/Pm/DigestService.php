<?php

namespace App\Services\Pm;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;
use Throwable;

/**
 * The morning digest: the few things worth knowing before you open the app,
 * built from the same data as the Today tab (flags, workload, since-yesterday).
 */
class DigestService
{
    public function __construct(private FlagService $flags) {}

    /** True when at least one delivery channel is configured. */
    public function channels(): array
    {
        return [
            'slack' => filled(config('pm.digest.slack_webhook')),
            'email' => count($this->recipients()) > 0,
        ];
    }

    /**
     * @param  array<int, array{name: string, designation?: ?string}>  $staff  Taskmandu staff, so people with no tasks are found
     */
    public function build(array $staff = []): array
    {
        $flags = $this->flags->all();
        $workload = $this->flags->workload($staff);
        $since = $this->flags->sinceLastWorkday($workload);

        $ofType = fn (string $type) => $flags->where('type', $type)->values()->all();

        // Oldest overdue first — those are the ones that hurt most.
        $overdue = $flags->where('type', 'overdue')->sortBy('due_at')->values()->all();

        $capacity = (float) config('pm.weekly_capacity_hours', 40);

        return [
            'date' => now()->toDateString(),
            'metrics' => $this->flags->metrics($flags),
            'overdue' => $overdue,
            'due_today' => $ofType('due_today'),
            'blocked' => $ofType('blocked'),
            'unassigned' => $ofType('unassigned'),
            'unverified' => $ofType('unverified'),
            'since' => $since,
            'idle' => collect($workload)->where('open', 0)->pluck('name')->values()->all(),
            'over_capacity' => collect($workload)
                ->filter(fn ($w) => $capacity > 0 && $w['week_hours'] > $capacity)
                ->map(fn ($w) => ['name' => $w['name'], 'hours' => $w['week_hours'], 'capacity' => $capacity])
                ->values()
                ->all(),
        ];
    }

    /**
     * Plain text for email / copying; $slack = true uses Slack's *bold* and escapes < > &.
     */
    public function text(array $d, bool $slack = false): string
    {
        $max = max(1, (int) config('pm.digest.max_items', 5));
        $bold = fn (string $s) => $slack ? "*{$s}*" : $s;
        $esc = fn (string $s) => $slack ? str_replace(['&', '<', '>'], ['&amp;', '&lt;', '&gt;'], $s) : $s;

        $day = \Illuminate\Support\Carbon::parse($d['date'])->format('D j M');
        $lines = [$bold("Morning digest — {$day}")];

        $m = $d['metrics'];
        $attention = ($m['overdue'] ?? 0) + ($m['blocked'] ?? 0) + ($m['due_today'] ?? 0);
        if ($attention === 0 && empty($d['idle']) && empty($d['over_capacity']) && empty($d['unassigned'])) {
            $lines[] = 'All clear: nothing overdue, blocked or due today.';
        }

        $since = $d['since'];
        if (! empty($since['tracked'])) {
            $lines[] = sprintf(
                'Since %s: %d completed, %d newly blocked, %d went overdue, %d new.',
                $since['label'],
                $since['completed']['count'],
                $since['blocked']['count'],
                $since['overdue']['count'],
                $since['created']['count']
            );
        }

        $section = function (string $title, array $items) use (&$lines, $bold, $esc, $max, $slack) {
            if (! $items) {
                return;
            }
            $lines[] = '';
            $lines[] = $bold($title.' ('.count($items).')');
            foreach (array_slice($items, 0, $max) as $f) {
                $who = $f['assignee'] ?: 'Unassigned';
                $where = $f['project_name'] ? $f['project_name'].' · ' : '';
                $detail = in_array($f['type'], ['overdue'], true) ? ' — '.$f['detail'] : '';
                $lines[] = '• '.$esc($f['title']).' — '.$esc($where.$who).$detail;
            }
            if (count($items) > $max) {
                $lines[] = '  …and '.(count($items) - $max).' more';
            }
        };

        $section('Overdue', $d['overdue']);
        $section('Due today', $d['due_today']);
        $section('Blocked', $d['blocked']);
        $section('Unassigned', $d['unassigned']);

        $people = [];
        if ($d['idle']) {
            $people[] = 'No open tasks: '.$esc(implode(', ', $d['idle']));
        }
        if ($d['over_capacity']) {
            $people[] = 'Over capacity: '.$esc(implode(', ', array_map(
                fn ($o) => "{$o['name']} ({$o['hours']}h/{$o['capacity']}h)",
                $d['over_capacity']
            )));
        }
        if ($d['unverified']) {
            $people[] = count($d['unverified']).' done task(s) waiting for you to verify';
        }
        if ($people) {
            $lines[] = '';
            array_push($lines, ...$people);
        }

        if ($url = config('app.url')) {
            if (! str_contains($url, 'localhost')) {
                $lines[] = '';
                $lines[] = rtrim($url, '/').'/pm';
            }
        }

        return implode("\n", $lines);
    }

    /**
     * Sends the digest to every configured channel. One channel failing doesn't stop the other.
     *
     * @return array{sent: string[], errors: array<string, string>}
     */
    public function send(array $digest): array
    {
        $sent = [];
        $errors = [];

        if ($hook = config('pm.digest.slack_webhook')) {
            try {
                $res = Http::timeout(15)->post($hook, ['text' => $this->text($digest, slack: true)]);
                $res->successful() ? $sent[] = 'slack' : $errors['slack'] = 'Slack replied '.$res->status().' '.trim($res->body());
            } catch (Throwable $e) {
                report($e);
                $errors['slack'] = $e->getMessage();
            }
        }

        if ($to = $this->recipients()) {
            try {
                $subject = 'Morning digest — '.\Illuminate\Support\Carbon::parse($digest['date'])->format('D j M');
                Mail::raw($this->text($digest), fn ($m) => $m->to($to)->subject($subject));
                $sent[] = 'email';
            } catch (Throwable $e) {
                report($e);
                $errors['email'] = $e->getMessage();
            }
        }

        return ['sent' => $sent, 'errors' => $errors];
    }

    /** @return string[] */
    private function recipients(): array
    {
        return array_values(array_filter(array_map('trim', explode(',', (string) config('pm.digest.email')))));
    }
}
