<?php

return [
    // Calendar-day thresholds used when a goal or linked plan uses Auto priority.
    'priority_high_within_days' => (int) env('PM_OPERATION_PRIORITY_HIGH_DAYS', 3),
    'priority_medium_within_days' => (int) env('PM_OPERATION_PRIORITY_MEDIUM_DAYS', 7),
];
