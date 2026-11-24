<?php

namespace App\Models;

use App\Services\Pm\QaCodeService;
use App\Services\Pm\QaStage;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class PmQaTaskReview extends Model
{
    /** Starting checklist for every Taskmandu task that enters QA. Edit freely per task in the QA Center. */
    public const DEFAULT_CHECKS = ['Works as described in the task', 'Works on desktop', 'Works on mobile'];

    protected $guarded = [];

    protected $casts = [
        'triggered_at' => 'datetime',
        'tested_at' => 'datetime',
        'cycle' => 'integer',
        'qa_screenshots' => 'array',
        'qa_history' => 'array',
    ];

    protected static function booted(): void
    {
        static::creating(function (self $review) {
            if (blank($review->qa_code)) {
                $review->qa_code = app(QaCodeService::class)->assign($review->business);
            }
            if (blank($review->qa_stage)) {
                $review->qa_stage = QaStage::fromReviewStatus($review->qa_status ?: 'Awaiting QA');
            }
            if (blank($review->qa_history)) {
                $review->qa_history = [['at' => now()->toIso8601String(), 'message' => 'Added to QA queue because the Taskmandu task reached '.($review->trigger_status ?: 'Review')]];
            }
        });

        static::created(function (self $review) {
            foreach (self::DEFAULT_CHECKS as $i => $label) {
                PmQaCheck::create(['item_type' => 'task', 'item_id' => $review->id, 'label' => $label, 'sort' => $i]);
            }
            // The task's Taskmandu subtasks are part of what QA has to verify.
            try {
                app(\App\Services\Pm\QaCenterService::class)->importSubtasks($review);
            } catch (\Throwable $e) {
                report($e);
            }
        });

        // The older task-inbox screen changes `qa_status`; keep the pipeline stage in step with it.
        static::updating(function (self $review) {
            if ($review->isDirty('qa_status') && ! $review->isDirty('qa_stage')) {
                $stage = QaStage::fromReviewStatus($review->qa_status);
                // "Awaiting QA" covers both Queue and Testing, so don't pull a Testing item back to Queue.
                $review->qa_stage = ($stage === QaStage::QUEUE && $review->getOriginal('qa_stage') === QaStage::TESTING)
                    ? QaStage::TESTING : $stage;
            }
        });

        static::deleting(fn (self $review) => PmQaCheck::where('item_type', 'task')->where('item_id', $review->id)->delete());
    }

    public function events(): HasMany
    {
        return $this->hasMany(PmQaTaskReviewEvent::class, 'review_id')->latest();
    }

    public function tester(): BelongsTo
    {
        return $this->belongsTo(User::class, 'tested_by');
    }
}
