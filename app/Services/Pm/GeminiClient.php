<?php

namespace App\Services\Pm;

use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use RuntimeException;

/**
 * Google Gemini (free tier works) behind the same `converse()` contract as ClaudeClient.
 *
 * AssistantService speaks Claude-style blocks (text / tool_use / tool_result). This class translates
 * those to Gemini's generateContent format and the reply back, so the tool loop is provider-agnostic.
 * Gemini 3+/4 require the model's `thoughtSignature` on function calls to be echoed back — we keep it
 * on the tool_use block (`signature`) and send it again on the next request.
 */
class GeminiClient
{
    public static function configured(): bool
    {
        return (bool) config('services.gemini.key');
    }

    /**
     * @param  array<int, array<string, mixed>>  $messages  Claude-style messages
     * @param  array<int, array<string, mixed>>  $tools  Claude-style tool definitions (name, description, input_schema)
     * @return array{content: array<int, array<string, mixed>>, stop_reason: string}
     */
    public function converse(string $system, array $messages, array $tools = [], int $maxTokens = 2000): array
    {
        $key = config('services.gemini.key');
        if (! $key) {
            throw new RuntimeException('The assistant needs a Gemini key — set GEMINI_API_KEY in .env');
        }
        $model = config('services.gemini.model', 'gemini-3.8-flash');

        $payload = [
            'systemInstruction' => ['parts' => [['text' => 'Today is '.now()->toFormattedDateString().".\n\n".$system]]],
            'contents' => $this->contents($messages),
            'generationConfig' => ['maxOutputTokens' => $maxTokens, 'temperature' => 0.2],
        ];
        if ($tools) {
            $payload['tools'] = [['functionDeclarations' => array_map(fn ($t) => $this->declaration($t), $tools)]];
            $payload['toolConfig'] = ['functionCallingConfig' => ['mode' => 'AUTO']];
        }

        try {
            $res = Http::withHeaders(['x-goog-api-key' => $key])
                ->timeout(60)
                ->retry(2, 1000, fn ($e) => $e instanceof ConnectionException
                    || in_array(optional($e->response ?? null)->status(), [500, 502, 503, 504], true), throw: false)
                ->post("https://generativelanguage.googleapis.com/v1beta/models/{$model}:generateContent", $payload);
        } catch (ConnectionException) {
            throw new RuntimeException("Couldn't reach Gemini — try again in a moment.");
        }

        if ($res->status() === 429) {
            throw new RuntimeException('Gemini free-tier limit reached — wait a minute and try again.');
        }
        if (in_array($res->status(), [400, 401, 403], true) && str_contains(Str::lower((string) $res->json('error.message')), 'api key')) {
            throw new RuntimeException('Gemini rejected the key — check GEMINI_API_KEY.');
        }
        if ($res->status() === 404) {
            throw new RuntimeException("Gemini model '{$model}' isn't available — set GEMINI_MODEL to a current model (Google's message: ".Str::limit((string) $res->json('error.message'), 160).')');
        }
        if ($res->failed()) {
            throw new RuntimeException('Gemini request failed ('.$res->status().'): '.$res->json('error.message', 'unknown error'));
        }

        $parts = $res->json('candidates.0.content.parts') ?? [];
        $blocks = [];
        $called = false;
        foreach ($parts as $p) {
            if (! empty($p['thought'])) {
                continue; // thought summaries are not part of the answer
            }
            if (isset($p['functionCall'])) {
                $called = true;
                $block = [
                    'type' => 'tool_use',
                    'id' => 'call_'.Str::random(12),
                    'name' => (string) ($p['functionCall']['name'] ?? ''),
                    'input' => is_array($p['functionCall']['args'] ?? null) ? $p['functionCall']['args'] : [],
                ];
                if (! empty($p['thoughtSignature'])) {
                    $block['signature'] = $p['thoughtSignature'];
                }
                $blocks[] = $block;
            } elseif (isset($p['text']) && $p['text'] !== '') {
                $blocks[] = ['type' => 'text', 'text' => $p['text']];
            }
        }

        if (! $blocks) {
            $why = $res->json('promptFeedback.blockReason') ?? $res->json('candidates.0.finishReason') ?? 'empty reply';
            throw new RuntimeException("Gemini gave no answer ({$why}). Try rephrasing.");
        }

        return ['content' => $blocks, 'stop_reason' => $called ? 'tool_use' : 'end_turn'];
    }

    /** @param  array<string, mixed>  $tool */
    private function declaration(array $tool): array
    {
        $d = ['name' => $tool['name'], 'description' => $tool['description']];
        $schema = $tool['input_schema'] ?? [];
        if (! empty((array) ($schema['properties'] ?? []))) {
            $d['parameters'] = $this->schema($schema);
        }

        return $d;
    }

    /** Gemini accepts an OpenAPI subset: upper-case types, no additionalProperties / default / etc. */
    private function schema(array $s): array
    {
        $out = ['type' => strtoupper((string) ($s['type'] ?? 'string'))];
        if (isset($s['description'])) {
            $out['description'] = (string) $s['description'];
        }
        if (isset($s['enum'])) {
            $out['enum'] = array_map('strval', array_values($s['enum']));
            $out['type'] = 'STRING';
        }
        if (isset($s['items'])) {
            $out['items'] = $this->schema((array) $s['items']);
        }
        $props = (array) ($s['properties'] ?? []);
        if ($props) {
            $out['properties'] = array_map(fn ($p) => $this->schema((array) $p), $props);
            if (! empty($s['required'])) {
                $out['required'] = array_values($s['required']);
            }
        }

        return $out;
    }

    /** @param  array<int, array<string, mixed>>  $messages */
    private function contents(array $messages): array
    {
        $names = [];
        $out = [];
        foreach ($messages as $m) {
            $role = ($m['role'] ?? 'user') === 'assistant' ? 'model' : 'user';
            $c = $m['content'] ?? '';
            $parts = [];
            if (is_string($c)) {
                $parts[] = ['text' => $c];
            } else {
                foreach ($c as $b) {
                    $type = $b['type'] ?? '';
                    if ($type === 'text' && trim((string) ($b['text'] ?? '')) !== '') {
                        $parts[] = ['text' => (string) $b['text']];
                    } elseif ($type === 'tool_use') {
                        $names[$b['id']] = $b['name'];
                        $part = ['functionCall' => ['name' => $b['name'], 'args' => (object) ($b['input'] ?? [])]];
                        if (! empty($b['signature'])) {
                            $part['thoughtSignature'] = $b['signature'];
                        }
                        $parts[] = $part;
                    } elseif ($type === 'tool_result') {
                        $parts[] = ['functionResponse' => ['name' => $names[$b['tool_use_id']] ?? 'tool', 'response' => ['result' => (string) ($b['content'] ?? '')]]];
                    }
                }
            }
            if ($parts) {
                $out[] = ['role' => $role, 'parts' => $parts];
            }
        }

        return $out;
    }
}
