<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class AiProviderFallbackTest extends TestCase
{
    use RefreshDatabase;

    private function textResponse(string $text, string $model = 'test-model'): array
    {
        return ['model' => $model, 'choices' => [[
            'message' => ['role' => 'assistant', 'content' => $text],
            'finish_reason' => 'stop',
        ]]];
    }

    private function providerConfig(): void
    {
        config([
            'pm.assistant.provider' => 'groq',
            'pm.assistant.fallback_provider' => 'openrouter',
            'services.groq.key' => 'groq-test-key',
            'services.groq.model' => 'openai/gpt-oss-120b',
            'services.groq.endpoint' => 'https://api.groq.com/openai/v1/chat/completions',
            'services.openrouter.key' => 'openrouter-test-key',
            'services.openrouter.model' => 'openrouter/free',
            'services.openrouter.endpoint' => 'https://openrouter.ai/api/v1/chat/completions',
        ]);
    }

    public function test_groq_function_call_round_trips_and_keeps_groq_as_provider(): void
    {
        $this->providerConfig();
        Http::fake([
            'api.groq.com/*' => Http::sequence()
                ->push(['choices' => [[
                    'model' => 'openai/gpt-oss-120b',
                    'message' => [
                        'role' => 'assistant',
                        'content' => null,
                        'tool_calls' => [[
                            'id' => 'call_board_1',
                            'type' => 'function',
                            'function' => ['name' => 'board_overview', 'arguments' => '{}'],
                        ]],
                    ],
                    'finish_reason' => 'tool_calls',
                ]]])
                ->push($this->textResponse('Here is your board overview.', 'openai/gpt-oss-120b')),
            'openrouter.ai/*' => Http::response($this->textResponse('Unexpected backup response.'), 200),
        ]);

        $response = $this->actingAs(User::factory()->create())->postJson('/pm/api/assistant/chat', [
            'messages' => [['role' => 'user', 'content' => 'Give me a board overview.']],
        ]);

        $response->assertOk()
            ->assertJsonPath('reply', 'Here is your board overview.')
            ->assertJsonPath('engine', 'groq')
            ->assertJsonPath('model', 'openai/gpt-oss-120b')
            ->assertJsonPath('tools.0', 'board_overview');

        Http::assertSentCount(2);
        $second = Http::recorded()[1][0]->data();
        $toolReply = collect($second['messages'])->firstWhere('role', 'tool');
        $this->assertSame('call_board_1', $toolReply['tool_call_id'] ?? null);
        $this->assertSame('board_overview', $second['tools'][0]['function']['name'] ?? null);
    }

    public function test_groq_rate_limit_falls_back_to_openrouter_and_reports_backup_provider(): void
    {
        $this->providerConfig();
        Http::fake([
            'api.groq.com/*' => Http::response(['error' => ['message' => 'rate limit']], 429),
            'openrouter.ai/*' => Http::response($this->textResponse('Answered by OpenRouter.', 'mock-openrouter-model:free'), 200),
        ]);

        $response = $this->actingAs(User::factory()->create())->postJson('/pm/api/assistant/chat', [
            'messages' => [['role' => 'user', 'content' => 'What is overdue?']],
        ]);

        $response->assertOk()
            ->assertJsonPath('reply', 'Answered by OpenRouter.')
            ->assertJsonPath('engine', 'openrouter')
            ->assertJsonPath('model', 'mock-openrouter-model:free');

        Http::assertSent(fn ($request) => str_contains($request->url(), 'api.groq.com'));
        Http::assertSent(fn ($request) => str_contains($request->url(), 'openrouter.ai')
            && ($request->data()['model'] ?? null) === 'openrouter/free'
            && ($request->header('Authorization')[0] ?? '') === 'Bearer openrouter-test-key');
    }

    public function test_openrouter_works_when_groq_key_is_not_configured(): void
    {
        $this->providerConfig();
        config(['services.groq.key' => null]);

        Http::fake([
            'openrouter.ai/*' => Http::response($this->textResponse('OpenRouter is active.', 'mock-openrouter-model:free'), 200),
        ]);

        $response = $this->actingAs(User::factory()->create())->postJson('/pm/api/assistant/chat', [
            'messages' => [['role' => 'user', 'content' => 'Hello']],
        ]);

        $response->assertOk()
            ->assertJsonPath('engine', 'openrouter')
            ->assertJsonPath('model', 'mock-openrouter-model:free');
        Http::assertSentCount(1);
        Http::assertSent(fn ($request) => str_contains($request->url(), 'openrouter.ai'));
    }
}
