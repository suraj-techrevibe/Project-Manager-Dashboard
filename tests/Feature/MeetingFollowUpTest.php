<?php

namespace Tests\Feature;

use App\Models\MeetingMinutes;
use App\Models\PmCard;
use App\Models\PmSubtask;
use App\Models\User;
use App\Services\Pm\DigestService;
use App\Services\Pm\MeetingFollowUpService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class MeetingFollowUpTest extends TestCase
{
    use RefreshDatabase;

    private function work(string $requirement, string $project = 'Salon Site', array $extra = []): array
    {
        return $extra + [
            'owner' => 'Ashim',
            'project' => $project,
            'requirement' => $requirement,
            'discussion' => "Notes for {$requirement}",
            'due_date' => now()->addDays(5)->toDateString(),
            'action_items' => [['task' => "Do {$requirement}", 'due_date' => now()->addDays(3)->toDateString()]],
        ];
    }

    private function meeting(array $items, int $daysAgo = 1, string $title = 'Daily meeting'): MeetingMinutes
    {
        return MeetingMinutes::create([
            'title' => $title,
            'status' => 'final',
            'meeting_date' => now()->subDays($daysAgo)->toDateString(),
            'attendees' => [],
            'work_items' => $items,
        ]);
    }

    private function card(string $title, string $status, ?int $dueInDays = 5, string $project = 'Salon Site', array $extra = []): PmCard
    {
        return PmCard::create($extra + [
            'title' => $title,
            'assignee' => 'Ashim',
            'status' => $status,
            'due_at' => $dueInDays === null ? null : now()->addDays($dueInDays)->toDateString(),
            'last_activity_at' => now(),
            'project_id' => 'p-'.md5($project),
            'project_name' => $project,
            'task_id' => 't-'.md5($title.$project),
            'url' => 'https://example.test/'.md5($title),
        ]);
    }

    public function test_each_work_item_gets_its_state_from_the_matching_task(): void
    {
        $this->meeting([$this->work('Build the portal'), $this->work('Fix login'), $this->work('Write report')]);
        $this->card('Build the portal', 'Completed');
        $this->card('fix  login!', 'Blocked');   // case / punctuation / spacing are ignored when matching

        $r = app(MeetingFollowUpService::class)->latest();

        $this->assertSame('Daily meeting', $r['meeting']['title']);
        $this->assertSame(1, $r['counts']['done']);
        $this->assertSame(1, $r['counts']['blocked']);
        $this->assertSame(1, $r['counts']['not_pushed']);
        $this->assertSame(3, $r['counts']['total']);
        // Needs-attention first: blocked, then not pushed, finished last.
        $this->assertSame(['blocked', 'not_pushed', 'done'], array_column($r['items'], 'state'));
    }

    public function test_a_task_with_the_same_title_on_another_project_does_not_match(): void
    {
        $this->meeting([$this->work('Build the portal', 'Salon Site')]);
        $this->card('Build the portal', 'Completed', 5, 'Another Project');

        $this->assertSame('not_pushed', app(MeetingFollowUpService::class)->latest()['items'][0]['state']);
    }

    public function test_overdue_and_subtask_progress(): void
    {
        $this->meeting([$this->work('Build the portal')]);
        $card = $this->card('Build the portal', 'In Progress', -2);
        foreach ([['A', 'Completed'], ['B', 'Assigned']] as [$t, $st]) {
            PmSubtask::create([
                'external_id' => "project:{$card->project_id}:task:{$card->task_id}:sub:{$t}",
                'project_id' => $card->project_id, 'project_name' => 'Salon Site', 'task_id' => $card->task_id,
                'subtask_id' => $t, 'parent_title' => 'Build the portal', 'title' => "Sub {$t}", 'status' => $st,
            ]);
        }

        $item = app(MeetingFollowUpService::class)->latest()['items'][0];

        $this->assertSame('overdue', $item['state']);
        $this->assertSame('2 days overdue', $item['detail']);
        $this->assertSame(['done' => 1, 'total' => 2], $item['subtasks']);
    }

    public function test_no_follow_up_without_a_recent_meeting_with_work_items(): void
    {
        $svc = app(MeetingFollowUpService::class);
        $this->assertNull($svc->latest());

        $this->meeting([$this->work('Old thing')], daysAgo: 40);
        $this->assertNull($svc->latest());

        MeetingMinutes::create(['title' => 'Legacy', 'status' => 'final', 'meeting_date' => now()->toDateString(), 'work_items' => []]);
        $this->assertNull($svc->latest());
    }

    public function test_digest_lists_what_is_still_open_from_the_last_meeting(): void
    {
        $this->meeting([$this->work('Build the portal'), $this->work('Fix login')]);
        $this->card('Build the portal', 'Completed');

        $svc = app(DigestService::class);
        $text = $svc->text($svc->build());

        $this->assertStringContainsString('Last meeting: Daily meeting', $text);
        $this->assertStringContainsString('1 of 2 done', $text);
        $this->assertStringContainsString('Fix login — Salon Site · Ashim — Not in Taskmandu yet', $text);
        $this->assertStringNotContainsString('• Build the portal', $text);
    }

    public function test_carry_over_keeps_unfinished_items_and_adds_stuck_board_tasks(): void
    {
        $this->meeting([$this->work('Build the portal'), $this->work('Fix login'), $this->work('Write report')]);
        $this->card('Build the portal', 'Completed');
        $this->card('Fix login', 'In Progress', -4);
        $this->card('Never discussed', 'Blocked', 3, 'Other Project');
        $this->card('Fine and on time', 'In Progress', 10);

        $r = app(MeetingFollowUpService::class)->carryOver();
        $titles = array_column($r['work_items'], 'requirement');

        $this->assertSame(['Fix login', 'Write report', 'Never discussed'], $titles);
        $this->assertSame(2, $r['from_meeting']);
        $this->assertSame(1, $r['from_board']);

        // Re-pushing updates the task description, so the original discussion must come back unchanged.
        $this->assertSame('Notes for Fix login', $r['work_items'][0]['discussion']);
        $this->assertNull($r['work_items'][0]['project_id']);
        $this->assertStringContainsString('4 days overdue', $r['work_items'][0]['note']);
        $this->assertStringContainsString('On the board', $r['work_items'][2]['note']);
    }

    public function test_carry_over_endpoint_is_not_swallowed_by_the_minute_route(): void
    {
        $this->meeting([$this->work('Fix login')]);

        $this->actingAs(User::factory()->create())
            ->getJson('/pm/api/minutes/carry-over')
            ->assertOk()
            ->assertJsonPath('work_items.0.requirement', 'Fix login')
            ->assertJsonPath('from.title', 'Daily meeting');
    }

    public function test_today_carries_the_follow_up(): void
    {
        $this->meeting([$this->work('Fix login')]);

        $this->actingAs(User::factory()->create())
            ->getJson('/pm/api/today')
            ->assertOk()
            ->assertJsonPath('meeting_followup.counts.not_pushed', 1);
    }
}
