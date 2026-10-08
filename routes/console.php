<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

Schedule::command('pm:sync')->everyFiveMinutes()->withoutOverlapping();
Schedule::command('pm:report')->weekdays()->dailyAt('18:00');
Schedule::command('pm:report --weekly')->fridays()->at('18:30');

Schedule::command('pm:digest')
    ->weekdays()
    ->dailyAt(config('pm.digest.time', '09:00'))
    ->timezone('Australia/Sydney')
    ->when(fn () => filled(config('pm.digest.slack_webhook')) || filled(config('pm.digest.email')));

Schedule::command('pm:automation --all')
    ->weekdays()
    ->dailyAt('08:30')
    ->timezone('Australia/Sydney')
    ->withoutOverlapping();