<?php

namespace App\Services\Pm\Investigation;

use Carbon\Carbon;

/** Calendar-day maths in the dashboard's timezone (PM_ROUTINE_TIMEZONE, default Australia/Sydney). */
class InvestigationDates
{
    public function timezone(): string
    {
        return (string) config('pm.routine.timezone', 'Australia/Sydney');
    }

    public function today(): string
    {
        return Carbon::now($this->timezone())->format('Y-m-d');
    }

    /** Whole days from $today to $date (negative = in the past). Works on Y-m-d strings so DST can't skew it. */
    public function daysLeft(string $date, ?string $today = null): int
    {
        $a = Carbon::createFromFormat('!Y-m-d', $today ?? $this->today(), 'UTC');
        $b = Carbon::createFromFormat('!Y-m-d', substr($date, 0, 10), 'UTC');

        return (int) round(($b->getTimestamp() - $a->getTimestamp()) / 86400);
    }
}
