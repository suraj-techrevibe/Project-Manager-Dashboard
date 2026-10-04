<?php

namespace App\Console\Commands;

use App\Services\Pm\DigestService;
use App\Services\Pm\TaskmanduSync;
use Illuminate\Console\Command;
use Throwable;

class SendDigest extends Command
{
    protected $signature = 'pm:digest {--dry : print the digest instead of sending it} {--no-sync : skip syncing from Taskmandu first}';

    protected $description = 'Send the morning digest (top flags, since-yesterday, who is idle or overloaded) to Slack and/or email';

    public function handle(DigestService $digest, TaskmanduSync $taskmandu): int
    {
        $staff = [];

        if ($taskmandu->configured()) {
            if (! $this->option('no-sync')) {
                try {
                    $taskmandu->run();
                } catch (Throwable $e) {
                    $this->warn('Sync failed, using the last synced data: '.$e->getMessage());
                }
            }

            try {
                $staff = $taskmandu->listEmployees();
            } catch (Throwable $e) {
                $this->warn("Couldn't load the staff list, so people with no tasks may be missing: ".$e->getMessage());
            }
        }

        $data = $digest->build($staff);

        if ($this->option('dry')) {
            $this->line($digest->text($data));

            return self::SUCCESS;
        }

        $channels = $digest->channels();
        if (! in_array(true, $channels, true)) {
            $this->error('No delivery channel set. Add PM_DIGEST_SLACK_WEBHOOK and/or PM_DIGEST_EMAIL to .env (or use --dry to just print it).');

            return self::FAILURE;
        }

        $result = $digest->send($data);

        foreach ($result['sent'] as $c) {
            $this->info("Digest sent to {$c}.");
        }
        foreach ($result['errors'] as $c => $msg) {
            $this->error("Could not send to {$c}: {$msg}");
        }

        return $result['errors'] ? self::FAILURE : self::SUCCESS;
    }
}
