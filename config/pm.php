<?php

return [
    // Hours one person can realistically take on per working week. Used by the
    // Team workload panel, Brief-to-tickets auto-assign and its over-capacity warning.
    'weekly_capacity_hours' => (float) env('PM_WEEKLY_CAPACITY_HOURS', 40),

    // Morning digest (php artisan pm:digest). Set either channel, or both.
    'digest' => [
        // Weekdays at this time (24h, app timezone). The scheduler must be running.
        'time' => env('PM_DIGEST_TIME', '09:00'),
        // Slack "Incoming Webhook" URL for the channel that should get the digest.
        'slack_webhook' => env('PM_DIGEST_SLACK_WEBHOOK'),
        // One or more addresses, comma separated. Uses your MAIL_* settings.
        'email' => env('PM_DIGEST_EMAIL'),
        // How many tasks to list per section before "...and N more".
        'max_items' => (int) env('PM_DIGEST_MAX_ITEMS', 5),
    ],

    // Emails sent from the dashboard (nudges, meeting minutes). From address and SMTP come from MAIL_*.
    'mail' => [
        // Replies go here, so people answer the PM directly and not the Brevo sender address.
        'reply_to' => env('PM_REPLY_TO'),
    ],
];
