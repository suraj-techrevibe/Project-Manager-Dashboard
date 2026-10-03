<?php

namespace Database\Seeders;

use App\Models\PmCard;
use Illuminate\Database\Seeder;

class PmDemoSeeder extends Seeder
{
    public function run(): void
    {
        $rows = [
            ['Consult module', 'Ashim', 'in_progress', -15, 5, []],
            ['Dynamic terms and conditions', 'Ashim', 'in_progress', -6, 1, []],
            ['Checkout redirect bug', 'Sooraj', 'review', -2, 1, []],
            ['Gallery drag-drop sort', 'Sooraj', 'in_progress', 3, 4, []],
            ['Email reminder job', 'Ashim', 'blocked', 5, 2, []],
            ['AdEvents card', null, 'todo', 7, 6, []],
            ['Payment methods progress bar', 'Sooraj', 'done', null, 2, []],
            ['Sponsor logos', 'Sooraj', 'done', null, 3, []],
        ];

        foreach ($rows as [$title, $who, $status, $due, $ago, $extra]) {
            PmCard::create(array_merge([
                'title' => $title,
                'assignee' => $who,
                'status' => $status,
                'due_at' => $due === null ? null : now()->addDays($due)->toDateString(),
                'last_activity_at' => now()->subDays($ago),
            ], $extra));
        }
    }
}
