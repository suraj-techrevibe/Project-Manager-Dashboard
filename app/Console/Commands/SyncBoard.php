<?php

namespace App\Console\Commands;

use App\Services\Pm\TaskmanduSync;
use Illuminate\Console\Command;

class SyncBoard extends Command
{
    protected $signature = 'pm:sync';

    protected $description = 'Pull tasks and project boards from Taskmandu into the PM agent';

    public function handle(TaskmanduSync $taskmandu): int
    {
        if (! $taskmandu->configured()) {
            $this->error('Set TASKMANDU_BASE_URL, TASKMANDU_EMAIL and TASKMANDU_PASSWORD in .env');

            return self::FAILURE;
        }

        $this->info($taskmandu->run().' cards synced from Taskmandu');

        return self::SUCCESS;
    }
}
