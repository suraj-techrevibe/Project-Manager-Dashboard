<?php

return [
    // Hours one person can realistically take on per working week. Used by the
    // Team workload panel, Brief-to-tickets auto-assign and its over-capacity warning.
    'weekly_capacity_hours' => (float) env('PM_WEEKLY_CAPACITY_HOURS', 40),
];
