<?php

namespace Tests\Feature;

use App\Models\PmCard;
use App\Models\User;
use App\Services\Pm\DigestService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class DigestTest extends TestCase
{
    use RefreshDatabase;

    private function card(string $title, ?string $who, string $status, ?int $dueInDays, float $hours = 2): PmCard
    {
        return PmCard::create([
            'title' => $title,
            'assignee' => $who,
            'status' => $status,
            'due_at' => $dueInDays === null ? null : now()->addDays($dueInDays)->toDateString(),
            'last_activity_at' => now(),
            'estimated_hours' => $hours,
            'project_name' => 'Salon Site',
            'task_id' => uniqid('t'),
        ]);
    }

    public function test_digest_lists_the_flags_and_people(): void
    {
        $this->card('Late thing', 'Ashim', 'In Progress', -3);
        $this->card('Today thing', 'Sooraj', 'Assigned', 0);
        $this->card('Stuck thing', 'Sooraj', 'Blocked', 5);
        $this->card('Nobody thing', null, 'Pending', 9);

        $svc = app(DigestService::class);
        $text = $svc->text($svc->build([['name' => 'Priya', 'designation' => 'Intern']]));

        $this->assertStringContainsString('Overdue (1)', $text);
        $this->assertStringContainsString('Late thing — Salon Site · Ashim — 3 days overdue', $text);
        $this->assertStringContainsString('Due today (1)', $text);
        $this->assertStringContainsString('Blocked (1)', $text);
        $this->assertStringContainsString('Unassigned (1)', $text);
        $this->assertStringContainsString('No open tasks: Priya', $text);
    }

    public function test_over_capacity_uses_hours_due_this_week(): void
    {
        config(['pm.weekly_capacity_hours' => 10]);
        $this->card('Big one', 'Ashim', 'In Progress', -1, 12);

        $svc = app(DigestService::class);

        $this->assertStringContainsString('Over capacity: Ashim (12h/10h)', $svc->text($svc->build()));
    }

    public function test_all_clear_when_nothing_needs_attention(): void
    {
        $this->card('Fine', 'Ashim', 'In Progress', 10);

        $svc = app(DigestService::class);

        $this->assertStringContainsString('All clear', $svc->text($svc->build()));
    }

    public function test_slack_text_is_escaped_and_bold(): void
    {
        $this->card('Fix <b>&</b> bug', 'Ashim', 'In Progress', -1);

        $svc = app(DigestService::class);
        $slack = $svc->text($svc->build(), slack: true);

        $this->assertStringStartsWith('*Morning digest', $slack);
        $this->assertStringContainsString('Fix &lt;b&gt;&amp;&lt;/b&gt; bug', $slack);
    }

    public function test_sends_to_slack_and_email_and_reports_a_failing_channel(): void
    {
        $this->card('Late thing', 'Ashim', 'In Progress', -3);
        config(['pm.digest.slack_webhook' => 'https://hooks.slack.test/x', 'pm.digest.email' => 'a@x.com, b@x.com']);
        Http::fake(['hooks.slack.test/*' => Http::response('invalid_token', 403)]);

        $svc = app(DigestService::class);
        $result = $svc->send($svc->build());

        $this->assertSame(['email'], $result['sent']); // email still went out
        $this->assertStringContainsString('403', $result['errors']['slack']);
    }

    public function test_digest_endpoints_need_login_and_a_channel(): void
    {
        $this->get('/pm/digest')->assertRedirect('/login');

        $user = User::factory()->create();
        $this->actingAs($user)->getJson('/pm/digest')
            ->assertOk()
            ->assertJsonPath('channels.slack', false)
            ->assertJsonStructure(['text', 'channels']);

        $this->actingAs($user)->postJson('/pm/digest/send')->assertStatus(422);
    }

    public function test_command_refuses_without_a_channel_but_dry_run_prints(): void
    {
        $this->artisan('pm:digest --no-sync')->assertFailed();
        $this->artisan('pm:digest --dry --no-sync')->expectsOutputToContain('Morning digest')->assertSuccessful();
    }
}
