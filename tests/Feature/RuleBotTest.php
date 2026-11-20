<?php

namespace Tests\Feature;

use App\Models\PmCard;
use App\Models\PmIntake;
use App\Models\User;
use App\Services\Pm\TaskmanduSync;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class RuleBotTest extends TestCase
{
    use RefreshDatabase;

    private User $user;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.anthropic.key' => null, 'pm.assistant.driver' => 'builtin']);

        $this->mock(TaskmanduSync::class, fn ($m) => $m->shouldReceive('listEmployees')->andReturn([
            ['employeeId' => 'E1', 'id' => 'emp-priya', 'name' => 'Priya Shah', 'designation' => 'Developer'],
            ['employeeId' => 'E2', 'id' => 'emp-ashim', 'name' => 'Ashim Rai', 'designation' => 'Designer'],
            ['employeeId' => 'E3', 'id' => 'emp-sam', 'name' => 'Sam Lee', 'designation' => 'QA'],
        ]));

        $this->user = User::factory()->create(['name' => 'Priya Shah']);
        $salon = str_repeat('a', 24);
        $book = str_repeat('b', 24);

        $this->card('Fix login bug', 'Salon Site', $salon, 'Ashim Rai', 'In Progress', -3);
        $this->card('Design homepage', 'Salon Site', $salon, 'Priya Shah', 'Blocked', 2);
        $this->card('Write docs', 'Salon Site', $salon, null, 'Pending', 5);
        $this->card('Payment gateway', 'Booking App', $book, 'Priya Shah', 'In Progress', 0);
        $this->card('Old thing', 'Booking App', $book, 'Ashim Rai', 'Completed', -10);
        $this->card('Fix login page styling', 'Booking App', $book, 'Priya Shah', 'Assigned', 6);
    }

    private function card(string $title, string $project, string $pid, ?string $who, string $status, int $due): PmCard
    {
        return PmCard::create([
            'title' => $title, 'project_name' => $project, 'project_id' => $pid, 'assignee' => $who, 'status' => $status,
            'due_at' => now()->addDays($due)->toDateString(), 'last_activity_at' => now()->subDays($status === 'Blocked' ? 6 : 0),
            'task_id' => substr(md5($title), 0, 24), 'estimated_hours' => 4,
        ]);
    }

    private function ask(string $text, array $before = []): array
    {
        $messages = array_merge($before, [['role' => 'user', 'content' => $text]]);

        return $this->actingAs($this->user)->postJson('/pm/api/assistant/chat', ['messages' => $messages])->assertOk()->json();
    }

    public function test_help_and_greeting(): void
    {
        $this->assertStringContainsString('built-in PM assistant', $this->ask('hello')['reply']);
        $this->assertStringContainsString('Tell me to do things', $this->ask('what can you do?')['reply']);
    }

    public function test_overdue_blocked_and_unassigned_questions(): void
    {
        $r = $this->ask("What's overdue?")['reply'];
        $this->assertStringContainsString('Fix login bug', $r);
        $this->assertStringNotContainsString('Old thing', $r, 'completed work is not overdue');
        $this->assertStringNotContainsString('Write docs', $r);

        $this->assertStringContainsString('Design homepage', $this->ask('show blocked tasks')['reply']);
        $this->assertStringContainsString('Write docs', $this->ask('which tasks have no owner?')['reply']);
        $this->assertStringContainsString('1** task', $this->ask('how many tasks are unassigned')['reply']);
    }

    public function test_person_project_and_me_filters(): void
    {
        $r = $this->ask('what is Ashim working on?')['reply'];
        $this->assertStringContainsString('Fix login bug', $r);
        $this->assertStringNotContainsString('Payment gateway', $r);

        $mine = $this->ask('show my tasks')['reply'];
        $this->assertStringContainsString('Design homepage', $mine);
        $this->assertStringContainsString('Payment gateway', $mine);
        $this->assertStringNotContainsString('Fix login bug', $mine);

        $p = $this->ask('open tasks in Booking App')['reply'];
        $this->assertStringContainsString('Payment gateway', $p);
        $this->assertStringNotContainsString('Design homepage', $p);
    }

    public function test_date_questions(): void
    {
        $this->assertStringContainsString('Payment gateway', $this->ask('what is due today?')['reply']);
        $this->assertStringContainsString('Design homepage', $this->ask('what is due this week?')['reply']);
        $this->assertStringContainsString('Old thing', $this->ask('what was completed this month?')['reply']);
    }

    public function test_project_summary_overview_workload_and_people(): void
    {
        $s = $this->ask('how is Salon Site going?')['reply'];
        $this->assertStringContainsString('Salon Site', $s);
        $this->assertStringContainsString('Overdue: **1**', $s);

        $this->assertStringContainsString('Board right now', $this->ask('give me an overview')['reply']);
        $w = $this->ask('who has capacity this week?')['reply'];
        $this->assertStringContainsString('most room', $w);
        $this->assertStringContainsString('Priya Shah', $this->ask('who is on the team?')['reply']);
        $this->assertStringContainsString('Booking App', $this->ask('list projects')['reply']);
    }

    public function test_requests_and_ideas(): void
    {
        PmIntake::create(['kind' => 'request', 'title' => 'Add dark mode', 'status' => 'in_review', 'source_type' => 'client', 'priority' => 'medium']);
        PmIntake::create(['kind' => 'idea', 'title' => 'Loyalty points', 'status' => 'under_review', 'source_type' => 'team', 'priority' => 'low']);

        $this->assertStringContainsString('Add dark mode', $this->ask('open requests')['reply']);
        $r = $this->ask('ideas to review')['reply'];
        $this->assertStringContainsString('Loyalty points', $r);
        $this->assertStringNotContainsString('Add dark mode', $r);
    }

    public function test_changes_are_queued_never_applied(): void
    {
        $card = PmCard::where('title', 'Fix login bug')->first();
        $res = $this->ask('mark "Fix login bug" as done');
        $this->assertCount(1, $res['actions']);
        $this->assertSame('update_task', $res['actions'][0]['tool']);
        $this->assertStringContainsString('Completed', $res['actions'][0]['summary']);
        $this->assertSame('pending', $res['actions'][0]['status']);
        $this->assertSame('In Progress', $card->fresh()->status, 'nothing changes before confirm');
    }

    public function test_reschedule_assign_priority_comment_subtask_snooze_and_sync(): void
    {
        $a = $this->ask('move "Write docs" to friday')['actions'];
        $this->assertSame('update_task', $a[0]['tool']);
        $this->assertStringContainsString('due date', $a[0]['summary']);

        $a = $this->ask('assign "Write docs" to Sam')['actions'];
        $this->assertStringContainsString('Sam Lee', $a[0]['summary']);

        $a = $this->ask('make "Write docs" high priority')['actions'];
        $this->assertStringContainsString('High priority', $a[0]['summary']);

        $a = $this->ask('comment on "Write docs": waiting on client copy')['actions'];
        $this->assertSame('add_task_comment', $a[0]['tool']);
        $this->assertStringContainsString('waiting on client copy', $a[0]['summary']);

        $a = $this->ask('add subtask "Proofread" to "Write docs"')['actions'];
        $this->assertSame('create_subtask', $a[0]['tool']);

        $this->assertSame('snooze_task', $this->ask('snooze "Write docs"')['actions'][0]['tool']);
        $this->assertSame('sync_board', $this->ask('sync')['actions'][0]['tool']);
    }

    public function test_bulk_reschedule_creates_one_action_per_task(): void
    {
        $res = $this->ask('move all overdue tasks to next monday');
        $this->assertCount(1, $res['actions'], 'only one open task is overdue');
        $this->assertStringContainsString('Fix login bug', $res['actions'][0]['summary']);
    }

    public function test_ambiguous_task_asks_which_one(): void
    {
        $res = $this->ask('mark fix login as done');
        $this->assertSame([], $res['actions']);
        $this->assertStringContainsString('which one', $res['reply']);
        $this->assertStringContainsString('Fix login bug', $res['reply']);
        $this->assertStringContainsString('Fix login page styling', $res['reply']);
    }

    public function test_create_task_full_and_with_followup(): void
    {
        $res = $this->ask('create task "Set up CI" in Salon Site due friday assign to Sam priority high');
        $this->assertSame('create_task', $res['actions'][0]['tool']);
        $this->assertStringContainsString('Set up CI', $res['actions'][0]['summary']);
        $this->assertStringContainsString('Sam Lee', $res['actions'][0]['summary']);
        $this->assertStringContainsString('High', $res['actions'][0]['summary']);

        // missing details -> asks, then merges the answer
        $first = $this->ask('create task "Set up CI"');
        $this->assertSame([], $first['actions']);
        $this->assertStringStartsWith('I need a bit more', $first['reply']);
        $this->assertStringContainsString('which project', $first['reply']);

        $second = $this->ask('Salon Site, due friday', [
            ['role' => 'user', 'content' => 'create task "Set up CI"'],
            ['role' => 'assistant', 'content' => $first['reply']],
        ]);
        $this->assertSame('create_task', $second['actions'][0]['tool']);
        $this->assertStringContainsString('Salon Site', $second['actions'][0]['summary']);
    }

    public function test_log_request_and_idea(): void
    {
        $a = $this->ask('log a client request: add dark mode to the portal')['actions'];
        $this->assertSame('create_intake', $a[0]['tool']);
        $this->assertStringContainsString('add dark mode to the portal', $a[0]['summary']);
        $this->assertSame('idea', $this->ask('new idea "Loyalty points"')['actions'][0]['details']['kind']);
    }

    public function test_delete_is_refused_and_gibberish_gets_help(): void
    {
        $this->assertStringContainsString("can't delete", $this->ask('delete Fix login bug')['reply']);
        $this->assertStringContainsString('Type **help**', $this->ask('blah')['reply']);
    }

    public function test_confirm_flow_works_with_bot_actions(): void
    {
        $card = PmCard::where('title', 'Write docs')->first();
        $res = $this->ask('snooze "Write docs"');
        $this->actingAs($this->user)->postJson("/pm/api/assistant/actions/{$res['actions'][0]['id']}/confirm")->assertOk()->assertJsonPath('status', 'done');
        $this->assertNotNull($card->fresh()->snoozed_until);
    }

    public function test_unquoted_create_keeps_the_full_title_and_phrasings(): void
    {
        $a = $this->ask('create a task to update the footer in Booking App by monday assign to Sam')['actions'][0];
        $this->assertStringContainsString('Update the footer', $a['summary']);
        $this->assertStringContainsString('Booking App', $a['summary']);
        $this->assertStringContainsString('Sam Lee', $a['summary']);

        $this->assertStringContainsString('most room', $this->ask('whos free this week')['reply']);
        $this->assertStringContainsString('Design homepage', $this->ask('what is blocking Salon Site')['reply']);
        $this->assertStringContainsString('Old thing', $this->ask('what did we complete this month')['reply']);
        $this->assertStringContainsString('Payment gateway', $this->ask('tasks due ' . strtolower(now()->format('l')))['reply']);
    }
}
