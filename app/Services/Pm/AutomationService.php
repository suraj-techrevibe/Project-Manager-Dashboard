<?php

namespace App\Services\Pm;

use App\Models\PmActivity;
use App\Models\PmCard;
use App\Models\PmMeetingTemplate;
use App\Models\PmNudgeBatch;
use App\Models\PmProjectHealth;
use App\Models\PmTicketPack;
use App\Models\PmWaitingClient;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Mail;
use RuntimeException;

class AutomationService
{
    private const NUDGE_TEMPLATE = "Hi {assignee}, quick check-in on “{title}”. It is {status_note}. Can you please post an update and let me know if anything is blocking it?";

    public function generateNudges(?int $idleDays = null): PmNudgeBatch
    {
        $idleDays ??= (int) config('pm.automation.idle_days', 3);
        $today = now()->startOfDay();

        $cards = PmCard::query()
            ->whereNotIn('status', ['Completed', 'Cancelled'])
            ->whereNotNull('assignee')
            ->get();

        $items = $cards->filter(function (PmCard $c) use ($today, $idleDays) {
            return ($c->due_at && $c->due_at->lt($today))
                || ($c->last_activity_at && $c->last_activity_at->lte(now()->subDays($idleDays)));
        })->map(function (PmCard $c) {
            $overdue = $c->due_at && $c->due_at->lt(now()->startOfDay());
            $days = $c->last_activity_at ? $c->last_activity_at->diffInDays(now()) : null;
            $statusNote = $overdue
                ? 'overdue'
                : ($days !== null ? "had no activity for {$days} days" : 'waiting for an update');

            $assignees = array_values(array_filter(array_map('trim', explode(',', (string) $c->assignee))));
            return [
                'card_id' => $c->id,
                'title' => $c->title,
                'assignee' => $c->assignee,
                'assignees' => $assignees,
                'email' => null,
                'project_id' => $c->project_id,
                'project_name' => $c->project_name,
                'task_id' => $c->task_id,
                'reason' => $overdue ? 'overdue' : 'idle',
                'message' => str_replace(
                    ['{assignee}', '{title}', '{status_note}'],
                    [explode(' ', trim((string) $c->assignee))[0] ?: 'there', $c->title, $statusNote],
                    self::NUDGE_TEMPLATE
                ),
                'selected' => true,
            ];
        })->values()->all();

        return PmNudgeBatch::create([
            'status' => 'draft',
            'items' => $items,
            'generated_at' => now(),
        ]);
    }

    public function sendNudgeBatch(PmNudgeBatch $batch): array
    {
        if ($batch->status === 'sent') {
            throw new RuntimeException('This nudge batch has already been sent.');
        }

        $contacts = \App\Models\PmContact::query()->get()->keyBy(fn ($c) => mb_strtolower($c->name));
        $sent = 0;
        $errors = [];

        foreach ($batch->items as $item) {
            if (empty($item['selected'])) continue;

            $emails = [];
            foreach ($item['assignees'] ?? [] as $name) {
                $email = $contacts->get(mb_strtolower($name))?->email;
                if ($email) $emails[] = $email;
            }

            if (!$emails) {
                $errors[] = "{$item['assignee']}: no email address saved";
                continue;
            }

            try {
                Mail::raw($item['message'], function ($m) use ($emails, $item) {
                    $m->to($emails)->subject('PM follow-up: '.$item['title']);
                });

                if ($card = PmCard::find($item['card_id'])) {
                    PmActivity::record('nudge', $card, ['automation' => true, 'reason' => $item['reason']]);
                }
                $sent++;
            } catch (\Throwable $e) {
                report($e);
                $errors[] = "{$item['assignee']}: {$e->getMessage()}";
            }
        }

        if ($sent) {
            $batch->update(['status' => 'sent', 'sent_at' => now()]);
        }

        return ['sent' => $sent, 'errors' => $errors];
    }

    public function projectHealth(): Collection
    {
        $today = now()->startOfDay();

        $rows = PmCard::query()
            ->whereNotNull('project_id')
            ->whereNotIn('status', ['Completed', 'Cancelled'])
            ->get()
            ->groupBy('project_id')
            ->map(function (Collection $cards, string $projectId) use ($today) {
                $overdue = $cards->filter(fn ($c) => $c->due_at && $c->due_at->lt($today))->count();
                $last = $cards->max('last_activity_at');
                $idleDays = $last ? (int) Carbon::parse($last)->diffInDays(now()) : 999;
                $score = max(0, 100 - ($overdue * 12) - min(50, $idleDays * 5));
                $health = $score < 45 ? 'red' : ($score < 70 ? 'amber' : 'green');
                $name = $cards->first()->project_name ?: 'Unnamed project';

                return PmProjectHealth::updateOrCreate(
                    ['project_id' => $projectId],
                    [
                        'project_name' => $name,
                        'score' => $score,
                        'health' => $health,
                        'overdue_count' => $overdue,
                        'idle_days' => $idleDays,
                        'calculated_at' => now(),
                    ]
                );
            })->values();

        return $rows;
    }

    public function waitingClientDigest(int $days = 3): Collection
    {
        return PmWaitingClient::query()
            ->where('status', 'waiting')
            ->whereDate('waiting_since', '<=', now()->subDays($days)->toDateString())
            ->orderBy('waiting_since')
            ->get();
    }

    public function createRecurringMeetings(): int
    {
        $created = 0;
        $today = now();
        foreach (PmMeetingTemplate::query()->where('active', true)->get() as $template) {
            if (strtolower($today->format('l')) !== strtolower($template->weekday)) continue;

            $exists = \App\Models\MeetingMinutes::query()
                ->where('title', $template->name)
                ->whereDate('meeting_date', $today->toDateString())
                ->exists();

            if ($exists) continue;

            \App\Models\MeetingMinutes::create([
                'title' => $template->name,
                'status' => 'draft',
                'meeting_date' => $today->toDateString(),
                'attendees' => $template->attendees ?? [],
                'topics' => collect($template->topics ?? [])->map(fn ($t) => [
                    'title' => is_array($t) ? ($t['title'] ?? '') : (string) $t,
                    'notes' => '',
                    'decision' => '',
                ])->values()->all(),
                'agenda_items' => collect($template->topics ?? [])->map(fn ($t) => is_array($t) ? ($t['title'] ?? '') : (string) $t)->values()->all(),
                'action_items' => [],
            ]);
            $created++;
        }
        return $created;
    }

    public function morningFollowUp(): array
    {
        $waiting = $this->waitingClientDigest();
        $minutes = \App\Models\MeetingMinutes::query()
            ->whereDate('meeting_date', now()->subDay()->toDateString())
            ->get();

        $lines = $minutes->map(function ($m) {
            $items = collect($m->action_items ?? []);
            $count = $items->count();
            $unowned = $items->filter(fn ($a) => blank($a['owner'] ?? null))->count();
            $pushed = $items->filter(fn ($a) => !empty($a['pushed_to_board'] ?? false))->count();
            return "{$m->title}: {$count} action items, {$unowned} with no owner, ".($count - $pushed)." not yet pushed to a board";
        })->values()->all();

        foreach ($waiting as $w) {
            $lines[] = "Waiting on client — {$w->title}: no reply for ".Carbon::parse($w->waiting_since)->diffInDays(now())." days";
        }

        return $lines;
    }

    public function ticketPacks(): Collection
    {
        return PmTicketPack::query()->latest()->get();
    }
}