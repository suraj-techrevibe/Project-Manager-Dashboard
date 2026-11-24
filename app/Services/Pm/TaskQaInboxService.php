<?php

namespace App\Services\Pm;

use App\Models\PmBusinessProjectLink;
use App\Models\PmCard;
use App\Models\PmQaCheck;
use App\Models\PmQaTaskReview;
use Illuminate\Support\Facades\DB;

class TaskQaInboxService
{
    private ?array $businessByProject = null;

    /**
     * Mirror a Taskmandu task into the QA inbox when it reaches the QA trigger status
     * ("Awaiting review" by default, or a task carrying the trigger tag; see config/pm.php).
     * The external Taskmandu id is the deduplication key, so repeated syncs never create
     * duplicate inbox records. Leaving the trigger status and entering it again opens a
     * new QA cycle while preserving the previous cycle's event history.
     */
    public function observe(PmCard $card): void
    {
        $externalId = (string) ($card->external_id ?? '');
        if (! str_starts_with($externalId, 'task:') && ! str_starts_with($externalId, 'project:')) {
            return;
        }

        $status = trim((string) $card->status);
        $triggerLabel = $this->triggerLabel($card);
        $isTrigger = $triggerLabel !== null;
        $review = PmQaTaskReview::query()->where('external_id', $externalId)->first();

        if (! $review && ! $isTrigger) {
            return;
        }

        $attributes = [
            'project_id' => $card->project_id,
            'project_name' => $card->project_name,
            'task_id' => (string) $card->task_id,
            'task_title' => (string) $card->title,
            'task_description' => $card->description,
            'business' => $this->businessForProject($card->project_id),
            'assignee' => $card->assignee,
            'task_status' => $status,
            'taskmandu_url' => $card->url,
            'qa_in_trigger' => $isTrigger,
        ];

        if (! $review) {
            DB::transaction(function () use ($externalId, $attributes, $triggerLabel) {
                $review = PmQaTaskReview::create($attributes + [
                    'external_id' => $externalId,
                    'trigger_status' => $triggerLabel,
                    'qa_status' => 'Awaiting QA',
                    'cycle' => 1,
                    'triggered_at' => now(),
                ]);

                $review->events()->create([
                    'cycle' => 1,
                    'result' => 'Queued',
                    'notes' => "Automatically added because the Taskmandu task entered {$triggerLabel}.",
                ]);
            });

            return;
        }

        // The flag is what the last sync saw. Reviews saved before it existed read as "not in trigger",
        // so a task that is awaiting review again simply opens a fresh round.
        $wasTrigger = (bool) $review->qa_in_trigger;
        $newCycle = ! $wasTrigger && $isTrigger;

        $review->fill($attributes);

        if ($newCycle) {
            $review->cycle = (int) $review->cycle + 1;
            $review->qa_status = 'Awaiting QA';
            $review->qa_stage = QaStage::QUEUE;
            $review->qa_fail_note = null;
            $review->qa_keep = false;
            $history = $review->qa_history ?? [];
            $history[] = ['at' => now()->toIso8601String(), 'message' => "Round {$review->cycle}: task re-entered {$triggerLabel}, back in the QA queue"];
            $review->qa_history = array_slice($history, -40);
            $review->trigger_status = $triggerLabel;
            $review->triggered_at = now();
            $review->tested_at = null;
            $review->tested_by = null;
            $review->last_result = null;
            $review->last_severity = null;
            $review->last_notes = null;
            $review->last_evidence_url = null;
        } elseif ($isTrigger) {
            // Still awaiting review: the same QA cycle.
            $review->trigger_status = $triggerLabel;
        }

        $review->save();

        if ($newCycle) {
            // A new QA round starts with a fresh, unticked checklist.
            PmQaCheck::query()->where('item_type', 'task')->where('item_id', $review->id)->update(['is_done' => false]);
            $review->events()->create([
                'cycle' => $review->cycle,
                'result' => 'Queued',
                'notes' => "QA cycle {$review->cycle} opened automatically because the Taskmandu task re-entered {$triggerLabel}.",
            ]);
        }
    }

    /** The status or tag that put this card into QA, or null when the card is not awaiting review. */
    public function triggerLabel(PmCard $card): ?string
    {
        $status = trim((string) $card->status);
        $statuses = array_map([$this, 'normalise'], (array) config('pm.qa.trigger_statuses', []));
        if ($status !== '' && in_array($this->normalise($status), $statuses, true)) {
            return $status;
        }

        $wanted = array_map([$this, 'normalise'], (array) config('pm.qa.trigger_tags', []));
        foreach ((array) ($card->tags ?? []) as $tag) {
            if (is_string($tag) && in_array($this->normalise($tag), $wanted, true)) {
                return trim($tag);
            }
        }

        return null;
    }

    /** "Awaiting review", "awaiting_review" and "AWAITING-REVIEW" all compare equal. */
    private function normalise(string $value): string
    {
        return (string) preg_replace('/[^a-z0-9]+/', '', mb_strtolower($value));
    }

    private function businessForProject(?string $projectId): ?string
    {
        if (! $projectId) {
            return null;
        }

        $this->businessByProject ??= PmBusinessProjectLink::query()
            ->with('business:id,name')
            ->get()
            ->groupBy('taskmandu_project_id')
            ->map(function ($links) {
                $link = $links->firstWhere('is_primary', true) ?? $links->first();

                return $link?->business?->name;
            })
            ->all();

        return $this->businessByProject[$projectId] ?? null;
    }
}
