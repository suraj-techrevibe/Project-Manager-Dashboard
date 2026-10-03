<?php

namespace App\Services\Pm;

use Illuminate\Support\Facades\Http;
use RuntimeException;

class ClaudeClient
{
    public function ask(string $system, string $prompt, int $maxTokens = 1200): string
    {
        $key = config('services.anthropic.key');

        if (! $key) {
            throw new RuntimeException('ANTHROPIC_API_KEY is not set');
        }

        $res = Http::withHeaders([
            'x-api-key' => $key,
            'anthropic-version' => '2023-06-01',
        ])
            ->timeout(60)
            ->retry(2, 500)
            ->post('https://api.anthropic.com/v1/messages', [
                'model' => config('services.anthropic.model'),
                'max_tokens' => $maxTokens,
                'system' => 'Today is '.now()->toFormattedDateString().".\n\n".$system,
                'messages' => [['role' => 'user', 'content' => $prompt]],
            ]);

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

        return json_decode($text, true, 512, JSON_THROW_ON_ERROR);
    }
}
