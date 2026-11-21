<?php

namespace App\\Services\\Pm;

use App\\Models\\PmBusinessProjectLink;
use App\\Models\\PmCard;
use App\\Models\\PmQaTaskReview;
use Illuminate\\Support\\Facades\\DB;

class TaskQaInboxService
{
    public const TRIGGER_STATUSES = ['Completed', 'Review'];

    private ?array $businessByProject = null;

    /**
     * Mirror a Taskmandu task into the QA inbox when it first reaches Completed/Review.
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
        $isTrigger = $this->isTriggerStatus($status);
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
        ];

        if (! $review) {
            DB::transaction(function () use ($externalId, $attributes, $status) {
                $review = PmQaTaskReview::create($attributes + [
                    'external_id' => $externalId,
                    'trigger_status' => $status,
                    'qa_status' => 'Awaiting QA',
                    'cycle' => 1,
                    'triggered_at' => now(),
                ]);

                $review->events()->create([
                    'cycle' => 1,
                    'result' => 'Queued',
                    'notes' => "Automatically added because the Taskmandu task entered {$status}.",
                ]);
            });

            return;
        }

        $wasTrigger = $this->isTriggerStatus((string) $review->task_status);
        $newCycle = ! $wasTrigger && $isTrigger;

        $review->fill($attributes);

        if ($newCycle) {
            $review->cycle = (int) $review->cycle + 1;
            $review->qa_status = 'Awaiting QA';
            $review->trigger_status = $status;
            $review->triggered_at = now();
            $review->tested_at = null;
            $review->tested_by = null;
            $review->last_result = null;
            $review->last_severity = null;
            $review->last_notes = null;
            $review->last_evidence_url = null;
        } elseif ($isTrigger) {
            // Completed -> Review (or Review -> Completed) is still the same QA cycle.
            $review->trigger_status = $status;
        }

        $review->save();

        if ($newCycle) {
            $review->events()->create([
                'cycle' => $review->cycle,
                'result' => 'Queued',
                'notes' => "QA cycle {$review->cycle} opened automatically because the Taskmandu task re-entered {$status}.",
            ]);
        }
    }

    private function isTriggerStatus(string $status): bool
    {
        return in_array(mb_strtolower(trim($status)), ['completed', 'review'], true);
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
