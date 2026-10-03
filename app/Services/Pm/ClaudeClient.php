<?php

namespace App\Services\Pm;

use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;
use JsonException;
use RuntimeException;

class ClaudeClient
{
    public function ask(string $system, string $prompt, int $maxTokens = 1200): string
    {
        $key = config('services.anthropic.key');

        if (! $key) {
            throw new RuntimeException('AI drafting needs an API key — set ANTHROPIC_API_KEY in .env');
        }

        try {
            // Only retry transient failures (rate limit / overload / 5xx). A wrong key
            // (401) or a bad request will never succeed on retry, so fail straight away.
            $res = Http::withHeaders([
                'x-api-key' => $key,
                'anthropic-version' => '2023-06-01',
            ])
                ->timeout(60)
                ->retry(2, 500, fn ($e) => $e instanceof ConnectionException
                    || in_array(optional($e->response ?? null)->status(), [429, 500, 502, 503, 529], true), throw: false)
                ->post('https://api.anthropic.com/v1/messages', [
                    'model' => config('services.anthropic.model'),
                    'max_tokens' => $maxTokens,
                    'system' => 'Today is '.now()->toFormattedDateString().".\n\n".$system,
                    'messages' => [['role' => 'user', 'content' => $prompt]],
                ]);
        } catch (ConnectionException) {
            throw new RuntimeException("Couldn't reach the AI service — check the server's internet connection and try again.");
        }

        if ($res->status() === 401 || $res->status() === 403) {
            throw new RuntimeException('AI drafting needs a valid API key — check ANTHROPIC_API_KEY in .env');
        }

        if ($res->failed()) {
            throw new RuntimeException('AI request failed ('.$res->status().'): '.$res->json('error.message', 'unknown error'));
        }

        return collect($res->json('content', []))
            ->where('type', 'text')
            ->pluck('text')
            ->implode("\n");
    }

    public function json(string $system, string $prompt, int $maxTokens = 2000): array
    {
        $text = $this->ask(
            $system."\n\nReturn ONLY valid JSON. No prose, no markdown fences.",
            $prompt,
            $maxTokens
        );

        $text = trim(preg_replace('/^```(?:json)?\s*|\s*```$/m', '', trim($text)));

        try {
            $out = json_decode($text, true, 512, JSON_THROW_ON_ERROR);
        } catch (JsonException) {
            throw new RuntimeException("The AI's reply couldn't be read — try again, or shorten the brief.");
        }

        return is_array($out) ? $out : [];
    }
}
