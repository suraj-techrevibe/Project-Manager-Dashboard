<?php

return [
    'assistant' => [
        // Groq is primary; OpenRouter is used when Groq is temporarily unavailable.
        'provider' => env('PM_AI_PROVIDER', 'groq'),
        'fallback_provider' => env('PM_AI_FALLBACK_PROVIDER', 'openrouter'),
    ],
    'routine' => [
        'timezone' => env('PM_ROUTINE_TIMEZONE', 'Australia/Sydney'),
        'nudge_time' => env('PM_ROUTINE_NUDGE_TIME', '17:30'),
    ],
    'weekly_capacity_hours' => (float) env('PM_WEEKLY_CAPACITY_HOURS', 40),
    'automation' => [
        'idle_days' => (int) env('PM_NUDGE_IDLE_DAYS', 3),
        'block_over_capacity' => filter_var(env('PM_BLOCK_OVER_CAPACITY', false), FILTER_VALIDATE_BOOL),
    ],
    'digest' => [
        'time' => env('PM_DIGEST_TIME', '09:00'),
        'slack_webhook' => env('PM_DIGEST_SLACK_WEBHOOK'),
        'email' => env('PM_DIGEST_EMAIL'),
        'max_items' => (int) env('PM_DIGEST_MAX_ITEMS', 5),
    ],
    'followup' => [
        // Meetings older than this are no longer followed up in the digest / Today.
        'max_age_days' => (int) env('PM_FOLLOWUP_MAX_AGE_DAYS', 14),
        // Overdue / blocked / stuck board tasks added when carrying work into a new meeting.
        'carry_board_limit' => (int) env('PM_CARRY_BOARD_LIMIT', 12),
    ],
    'mail' => [
        'reply_to' => env('PM_REPLY_TO'),
    ],
];