<?php

namespace App\Services\Pm;

use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use RuntimeException;

/** OpenAI-compatible chat-completions adapter shared by Groq and OpenRouter. */
class OpenAiCompatibleClient
{
    public function configured(string $provider): bool
    {
        return in_array($provider, ['groq', 'openrouter'], true)
            && filled(config("services.{$provider}.key"));
    }

    /**
     * @param array<int, array<string, mixed>> $messages
     * @param array<int, array<string, mixed>> $tools
     * @return array{content: array<int, array<string, mixed>>, stop_reason: string}
     */
    public function converse(string $provider, string $system, array $messages, array $tools = [], int $maxTokens = 2000): array
    {
        if (! in_array($provider, ['groq', 'openrouter'], true)) {
            throw new RuntimeException("Unsupported AI provider: {$provider}");
        }

        $key = (string) config("services.{$provider}.key");
        if ($key === '') {
            throw new RuntimeException("Set ".strtoupper($provider)."_API_KEY to use the {$provider} assistant.");
        }

        $model = (string) config("services.{$provider}.model");
        $endpoint = (string) config("services.{$provider}.endpoint");
        if ($model === '' || $endpoint === '') {
            throw new RuntimeException("The {$provider} model or endpoint is not configured.");
        }

        $payload = [
            'model' => $model,
            'messages' => $this->formatMessages($system, $messages),
        ];
        $payload[$provider === 'groq' ? 'max_completion_tokens' : 'max_tokens'] = $maxTokens;

        if ($tools) {
            $payload['tools'] = array_map(fn (array $tool) => [
                'type' => 'function',
                'function' => [
                    'name' => (string) $tool['name'],
                    'description' => (string) ($tool['description'] ?? ''),
                    'parameters' => $tool['input_schema'] ?? ['type' => 'object', 'properties' => new \stdClass()],
                ],
            ], $tools);
            $payload['tool_choice'] = 'auto';
        }

        $request = Http::acceptJson()->withToken($key)->timeout(60);
        if ($provider === 'openrouter') {
            $request = $request->withHeaders([
                'HTTP-Referer' => (string) config('app.url'),
                'X-Title' => 'Project Manager Dashboard',
            ]);
        }

        try {
            $response = $request->post($endpoint, $payload);
        } catch (ConnectionException) {
            throw new AiProviderUnavailableException(ucfirst($provider).' could not be reached.');
        }

        $status = $response->status();
        if (in_array($status, [408, 425, 429, 500, 502, 503, 504, 529], true)) {
            throw new AiProviderUnavailableException(ucfirst($provider)." is temporarily unavailable (HTTP {$status}).");
        }

        if ($response->failed()) {
            $message = Str::limit((string) $response->json('error.message', 'Unknown provider error.'), 240);
            throw new RuntimeException(ucfirst($provider)." API error ({$status}): {$message}");
        }

        $assistant = $response->json('choices.0.message');
        if (! is_array($assistant)) {
            throw new RuntimeException(ucfirst($provider).' returned an empty or unrecognised response.');
        }

        $blocks = [];
        $toolCalls = is_array($assistant['tool_calls'] ?? null) ? $assistant['tool_calls'] : [];
        foreach ($toolCalls as $call) {
            $function = $call['function'] ?? [];
            $name = (string) ($function['name'] ?? '');
            if ($name === '') {
                throw new RuntimeException(ucfirst($provider).' returned a function call without a name.');
            }

            $rawArguments = $function['arguments'] ?? '{}';
            $arguments = is_array($rawArguments) ? $rawArguments : json_decode((string) $rawArguments, true);
            if (! is_array($arguments)) {
                throw new RuntimeException(ucfirst($provider).' returned invalid JSON for a function call.');
            }

            $blocks[] = [
                'type' => 'tool_use',
                'id' => (string) ($call['id'] ?? 'call_'.Str::uuid()),
                'name' => $name,
                'input' => $arguments,
            ];
        }

        $content = $assistant['content'] ?? null;
        if (is_string($content) && trim($content) !== '') {
            $blocks[] = ['type' => 'text', 'text' => $content];
        } elseif (is_array($content)) {
            $text = collect($content)
                ->filter(fn ($part) => is_array($part) && isset($part['text']))
                ->pluck('text')
                ->implode("\n");
            if (trim($text) !== '') {
                $blocks[] = ['type' => 'text', 'text' => $text];
            }
        }

        if (! $blocks) {
            $reason = (string) ($assistant['refusal'] ?? $response->json('choices.0.finish_reason') ?? 'empty reply');
            throw new RuntimeException(ucfirst($provider)." returned no usable answer ({$reason}).");
        }

        return [
            'content' => $blocks,
            'stop_reason' => $toolCalls ? 'tool_use' : 'end_turn',
        ];
    }

    /** @param array<int, array<string, mixed>> $messages */
    private function formatMessages(string $system, array $messages): array
    {
        $formatted = [[
            'role' => 'system',
            'content' => 'Today is '.now()->toFormattedDateString()."\n\n".$system,
        ]];

        foreach ($messages as $message) {
            $role = ($message['role'] ?? 'user') === 'assistant' ? 'assistant' : 'user';
            $content = $message['content'] ?? '';

            if (is_string($content)) {
                $formatted[] = ['role' => $role, 'content' => $content];
                continue;
            }

            if (! is_array($content)) {
                $formatted[] = ['role' => $role, 'content' => (string) $content];
                continue;
            }

            $toolResults = array_values(array_filter(
                $content,
                fn ($block) => is_array($block) && ($block['type'] ?? '') === 'tool_result'
            ));
            if ($toolResults) {
                foreach ($toolResults as $result) {
                    $formatted[] = [
                        'role' => 'tool',
                        'tool_call_id' => (string) ($result['tool_use_id'] ?? ''),
                        'content' => (string) ($result['content'] ?? ''),
                    ];
                }
                continue;
            }

            $text = collect($content)
                ->filter(fn ($block) => is_array($block) && ($block['type'] ?? '') === 'text')
                ->pluck('text')
                ->filter(fn ($value) => is_string($value) && trim($value) !== '')
                ->implode("\n");

            $toolUses = array_values(array_filter(
                $content,
                fn ($block) => is_array($block) && ($block['type'] ?? '') === 'tool_use'
            ));
            if ($role === 'assistant' && $toolUses) {
                $formatted[] = [
                    'role' => 'assistant',
                    'content' => $text !== '' ? $text : null,
                    'tool_calls' => array_map(fn (array $block) => [
                        'id' => (string) $block['id'],
                        'type' => 'function',
                        'function' => [
                            'name' => (string) $block['name'],
                            'arguments' => json_encode($block['input'] ?? new \stdClass(), JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
                        ],
                    ], $toolUses),
                ];
            } elseif ($text !== '') {
                $formatted[] = ['role' => $role, 'content' => $text];
            }
        }

        return $formatted;
    }
}
