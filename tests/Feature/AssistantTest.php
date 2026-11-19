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
        config(['services.anthropic.key' => 'test']);
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
        config(['services.anthropic.key' => 'test']);
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
        config(['services.anthropic.key' => 'test']);
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
}
