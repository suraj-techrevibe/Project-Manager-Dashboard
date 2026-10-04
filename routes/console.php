<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

// Keep Today fresh: pull from Taskmandu every hour (the Sync now button on Today does the same on demand).
Schedule::command('pm:sync')->hourly()->withoutOverlapping();

// Daily report: syncs from Taskmandu, then saves today's report. Needs the scheduler running
// (a cron entry for `php artisan schedule:run` in production, `php artisan schedule:work` locally).
Schedule::command('pm:report')->weekdays()->dailyAt('18:00');
Schedule::command('pm:report --weekly')->fridays()->at('18:30');
