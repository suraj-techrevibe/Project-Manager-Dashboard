<?php

namespace App\Console\Commands;

use App\Models\PmReport;
use App\Services\Pm\ReportService;
use App\Services\Pm\TaskmanduSync;
use Illuminate\Console\Command;
use Illuminate\Support\Carbon;
use Throwable;

class GenerateReport extends Command
{
    protected $signature = 'pm:report {--date= : YYYY-MM-DD, defaults to today} {--weekly : make the weekly report for that date\'s week} {--force : replace a report that already exists}';

    protected $description = 'Generate the daily (or weekly) report, syncing from Taskmandu first';

    public function handle(ReportService $reports, TaskmanduSync $taskmandu): int
    {
        $kind = $this->option('weekly') ? 'weekly' : 'daily';
        $date = ReportService::normalizeDate($this->option('date') ? Carbon::parse($this->option('date')) : now(), $kind);

        if (! $this->option('force') && PmReport::where('kind', $kind)->where('report_date', $date->toDateString())->exists()) {
            $this->line("A {$kind} report for ".$date->toDateString().' already exists — skipped (use --force to replace it).');

            return self::SUCCESS;
        }

        if ($taskmandu->configured()) {
            try {
                $taskmandu->run();
            } catch (Throwable $e) {
                $this->warn('Sync failed, using the last synced data: '.$e->getMessage());
            }
        }

        $report = $reports->generate($date, null, 'PM agent', auto: true, kind: $kind);
        $this->info(ucfirst($kind).' report saved for '.$report->report_date);

        return self::SUCCESS;
    }
}
