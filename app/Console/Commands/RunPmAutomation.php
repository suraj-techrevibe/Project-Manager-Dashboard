<?php

namespace App\Console\Commands;

use App\Services\Pm\AutomationService;
use App\Services\Pm\TaskmanduSync;
use Illuminate\Console\Command;

class RunPmAutomation extends Command
{
    protected $signature = 'pm:automation {--nudges : Generate the nudge review batch} {--meetings : Create recurring meeting drafts} {--health : Recalculate project health} {--all : Run every daily rule}';
    protected $description = 'Run PM agent automation rules against the live Taskmandu data';

    public function handle(AutomationService $automation, TaskmanduSync $sync): int
    {
        if ($this->option('all') || $this->option('nudges') || $this->option('health')) {
            if ($sync->configured()) {
                $sync->run();
            }
        }

        if ($this->option('all') || $this->option('nudges')) {
            $batch = $automation->generateNudges();
            $this->info("Nudge review batch #{$batch->id}: ".count($batch->items ?? []).' items');
        }

        if ($this->option('all') || $this->option('meetings')) {
            $this->info('Recurring meeting drafts created: '.$automation->createRecurringMeetings());
        }

        if ($this->option('all') || $this->option('health')) {
            $rows = $automation->projectHealth();
            $this->info('Project health rows updated: '.$rows->count());
        }

        if (!$this->option('all') && !$this->option('nudges') && !$this->option('meetings') && !$this->option('health')) {
            $this->error('Choose --nudges, --meetings, --health, or --all.');
            return self::INVALID;
        }

        return self::SUCCESS;
    }
}