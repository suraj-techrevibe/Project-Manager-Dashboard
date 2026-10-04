<?php

return [
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
    'mail' => [
        'reply_to' => env('PM_REPLY_TO'),
    ],
];