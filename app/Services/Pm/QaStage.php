<?php

namespace App\Services\Pm;

/**
 * The QA Center pipeline: Queue -> Testing -> Failed / Passed.
 *
 * Findings (pm_qa_issues) and Taskmandu task reviews (pm_qa_task_reviews) each keep their original
 * status column for older screens and reports. This class is the one place that translates between
 * those statuses and the pipeline stage stored in qa_stage.
 */
final class QaStage
{
    public const QUEUE = 'Queue';
    public const TESTING = 'Testing';
    public const FAILED = 'Failed';
    public const PASSED = 'Passed';

    public const ALL = [self::QUEUE, self::TESTING, self::FAILED, self::PASSED];

    /** Where each stage may go next. Failed and Passed can only be sent back to Queue. */
    public const TRANSITIONS = [
        self::QUEUE => [self::TESTING, self::FAILED, self::PASSED],
        self::TESTING => [self::QUEUE, self::FAILED, self::PASSED],
        self::FAILED => [self::QUEUE],
        self::PASSED => [self::QUEUE],
    ];

    public static function canMove(string $from, string $to): bool
    {
        return in_array($to, self::TRANSITIONS[$from] ?? [], true);
    }

    public static function fromIssueStatus(?string $status): string
    {
        return match ($status) {
            'Passed' => self::PASSED,
            'Reported', 'Fixing', 'Failed' => self::FAILED,
            default => self::QUEUE, // Draft, Ready for Retest
        };
    }

    /** Keep the legacy finding status meaningful when the pipeline stage changes. */
    public static function toIssueStatus(string $stage, ?string $current): string
    {
        return match ($stage) {
            self::PASSED => 'Passed',
            self::FAILED => 'Failed',
            // Back in the queue after a fix means "ready for retest"; a brand-new item stays a draft.
            default => in_array($current, ['Draft', 'Ready for Retest'], true) ? $current : 'Ready for Retest',
        };
    }

    public static function fromReviewStatus(?string $status): string
    {
        return match ($status) {
            'Passed' => self::PASSED,
            'Failed' => self::FAILED,
            default => self::QUEUE, // Awaiting QA
        };
    }

    public static function toReviewStatus(string $stage): string
    {
        return match ($stage) {
            self::PASSED => 'Passed',
            self::FAILED => 'Failed',
            default => 'Awaiting QA', // Queue and Testing are both "not decided yet"
        };
    }
}
