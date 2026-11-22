<?php

namespace Tests\Feature;

use App\Models\PmCard;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class AssistantTest extends TestCase
{
    use RefreshDatabase;

    private function card(string $title, ?string $who = 'Ashim', int $due = -2): PmCard
    {
        return PmCard::create([
            'title' => $title, 'assignee' => $who, 'status' => 'In Progress',
            'due_at' => now()->addDays($due)->toDateString(), 'last_activity_at' => now(),
            'project_name' => 'Salon Site', 'project_id' => str_repeat('a', 24), 'task_id' => str_repeat('b', 24),
        ]);
    }

    private function text(string $t): array
    {
        return ['stop_reason' => 'end_turn', 'content' => [['type' => 'text', 'text' => $t]]];
    }

    private function toolUse(string $name, array $input, string $id = 'toolu_1'): array
    {
        return ['stop_reason' => 'tool_use', 'content' => [['type' => 'tool_use', 'id' => $id, 'name' => $name, 'input' => $input]]];
    }

    public function test_read_tool_results_reach_the_model_and_reply_comes_back(): void
    {
        config(['services.anthropic.key' => 'test', 'pm.assistant.provider' => 'anthropic']);
        $this->card('Fix login');
        Http::fake(['api.anthropic.com/*' => Http::sequence()
            ->push($this->toolUse('search_tasks', ['overdue' => true]))
            ->push($this->text('You have 1 overdue task: Fix login.'))]);

        $res = $this->actingAs(User::factory()->create())
            ->postJson('/pm/api/assistant/chat', ['messages' => [['role' => 'user', 'content' => "What's overdue?"]]]);

        $res->assertOk()->assertJsonPath('reply', 'You have 1 overdue task: Fix login.')->assertJsonPath('tools.0', 'search_tasks');
        // the second request carried the tool result containing the task
        Http::assertSent(fn ($r) => str_contains($r->body(), 'tool_result') && str_contains($r->body(), 'Fix login'));
    }

    public function test_write_tools_are_queued_not_executed_and_confirm_runs_once(): void
    {
        config(['services.anthropic.key' => 'test', 'pm.assistant.provider' => 'anthropic']);
        $card = $this->card('Noisy task');
        Http::fake(['api.anthropic.com/*' => Http::sequence()
            ->push($this->toolUse('snooze_task', ['summary' => 'Snooze Noisy task for 3 days', 'card_id' => $card->id]))
            ->push($this->text('Ready — press Confirm.'))]);

        $user = User::factory()->create();
        $res = $this->actingAs($user)->postJson('/pm/api/assistant/chat', ['messages' => [['role' => 'user', 'content' => 'snooze Noisy task']]]);

        $res->assertOk()->assertJsonPath('actions.0.status', 'pending');
        $this->assertNull($card->fresh()->snoozed_until, 'nothing may change before confirmation');

        $id = $res->json('actions.0.id');
        $this->postJson("/pm/api/assistant/actions/{$id}/confirm")->assertOk()->assertJsonPath('status', 'done');
        $this->assertNotNull($card->fresh()->snoozed_until);

        $this->postJson("/pm/api/assistant/actions/{$id}/confirm")->assertStatus(410); // single use
    }

    public function test_another_user_cannot_confirm_my_action_and_cancel_changes_nothing(): void
    {
        config(['services.anthropic.key' => 'test', 'pm.assistant.provider' => 'anthropic']);
        $card = $this->card('Mine');
        Http::fake(['api.anthropic.com/*' => Http::sequence()
            ->push($this->toolUse('snooze_task', ['summary' => 'Snooze', 'card_id' => $card->id]))
            ->push($this->text('ok'))]);

        $res = $this->actingAs(User::factory()->create())->postJson('/pm/api/assistant/chat', ['messages' => [['role' => 'user', 'content' => 'snooze']]]);
        $id = $res->json('actions.0.id');

        $this->actingAs(User::factory()->create())->postJson("/pm/api/assistant/actions/{$id}/confirm")->assertStatus(410);
        $this->assertNull($card->fresh()->snoozed_until);
    }

    public function test_requires_login_and_valid_input(): void
    {
        $this->postJson('/pm/api/assistant/chat', ['messages' => [['role' => 'user', 'content' => 'hi']]])->assertUnauthorized();
        $this->actingAs(User::factory()->create())->postJson('/pm/api/assistant/chat', ['messages' => []])->assertStatus(422);
    }

    public function test_gemini_tool_loop_round_trips_signatures_and_results(): void
    {
        config(['services.gemini.key' => 'g-test', 'pm.assistant.provider' => 'gemini']);
        Http::fake(['generativelanguage.googleapis.com/*' => Http::sequence()
            ->push(['candidates' => [['content' => ['parts' => [['functionCall' => ['name' => 'lookup_pm_data', 'args' => ['kind' => 'meeting_templates']], 'thoughtSignature' => 'SIG123']]]]]])
            ->push(['candidates' => [['content' => ['parts' => [['text' => 'You have no templates yet.']]]]]]),
        ]);

        $r = $this->actingAs(User::factory()->create())->postJson('/pm/api/assistant/chat', ['messages' => [['role' => 'user', 'content' => 'what templates exist?']]])->assertOk()->json();

        $this->assertSame('You have no templates yet.', $r['reply']);
        $this->assertContains('lookup_pm_data', $r['tools']);
        Http::assertSentCount(2);
        $second = Http::recorded()[1][0]->data();
        $parts = collect($second['contents'])->pluck('parts')->flatten(1);
        $this->assertSame('SIG123', $parts->firstWhere('functionCall')['thoughtSignature'], 'the thought signature is echoed back');
        $this->assertSame('lookup_pm_data', $parts->firstWhere('functionResponse')['functionResponse']['name']);
        $this->assertSame('OBJECT', collect($second['tools'][0]['functionDeclarations'])->firstWhere('name', 'search_tasks')['parameters']['type'] ?? null);
        $this->assertArrayNotHasKey('parameters', collect($second['tools'][0]['functionDeclarations'])->firstWhere('name', 'board_overview'));
    }

    public function test_without_a_gemini_key_the_assistant_says_so_instead_of_falling_back(): void
    {
        config(['services.gemini.key' => null, 'pm.assistant.provider' => 'gemini']);
        Http::fake();

        $res = $this->actingAs(User::factory()->create())->postJson('/pm/api/assistant/chat', ['messages' => [['role' => 'user', 'content' => "What's overdue?"]]]);

        $res->assertStatus(422);
        $this->assertStringContainsString('Gemini is off', $res->json('error'));
        Http::assertNothingSent();

        $status = $this->actingAs(User::factory()->create())->getJson('/pm/api/assistant/status')->assertOk()->json();
        $this->assertFalse($status['ai_ready']);
        $this->assertStringContainsString('Gemini is off', $status['label']);
    }

    public function test_every_message_goes_to_gemini_and_the_ai_prefix_is_stripped(): void
    {
        config(['services.gemini.key' => 'g-test', 'pm.assistant.provider' => 'gemini']);
        Http::fake(['generativelanguage.googleapis.com/*' => Http::response(['candidates' => [['content' => ['parts' => [['text' => 'Gemini here']]]]]])]);
        $user = User::factory()->create();

        $plain = $this->actingAs($user)->postJson('/pm/api/assistant/chat', ['messages' => [['role' => 'user', 'content' => 'show my tasks']]])->assertOk()->json();
        $this->assertSame('Gemini here', $plain['reply']);
        $this->assertSame('gemini', $plain['engine']);

        $this->actingAs($user)->postJson('/pm/api/assistant/chat', ['messages' => [['role' => 'user', 'content' => '/ai what is overdue']]])->assertOk();
        Http::assertSentCount(2);
        $sent = json_encode(Http::recorded()[1][0]->data());
        $this->assertStringContainsString('what is overdue', $sent);
        $this->assertStringNotContainsString('/ai what', $sent);
    }

    public function test_old_assistant_page_url_redirects_to_the_command_center(): void
    {
        $this->actingAs(User::factory()->create())->get('/pm/assistant')->assertRedirect('/pm');
    }
}
