<?php

namespace App\Services\Pm;

use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use RuntimeException;

/**
 * Multipart (file upload) calls to Taskmandu.
 *
 * TaskmanduClient only speaks JSON, so project document uploads
 * (POST /projects/{id}/documents, a multer endpoint) live here instead.
 * It deliberately shares TaskmanduClient's cached access-token key, so in
 * normal use no extra login happens; if the token is missing/expired it
 * logs in with the same service account and re-caches it.
 */
class TaskmanduUploadClient
{
    // Same key TaskmanduClient uses — keep in sync if that ever changes.
    private const TOKEN_CACHE_KEY = 'taskmandu:access_token';

    /**
     * @param  array<string, string|null>  $fields  extra form fields sent alongside the file
     */
    public function upload(string $path, UploadedFile $file, array $fields = []): array
    {
        $this->assertConfigured();

        $fields = array_filter($fields, fn ($v) => $v !== null && $v !== '');

        $send = fn () => Http::baseUrl($this->baseUrl())
            ->withToken($this->token())
            ->acceptJson()
            ->timeout(60)
            ->attach('file', fopen($file->getRealPath(), 'r'), $file->getClientOriginalName())
            ->post($path, $fields);

        $res = $send();

        if ($res->status() === 401) {
            Cache::forget(self::TOKEN_CACHE_KEY);
            $res = $send();
        }

        if ($res->failed()) {
            $message = $res->json('message', $res->body());
            throw new RuntimeException("Taskmandu API error ({$res->status()}): {$message}");
        }

        return $res->json();
    }

    private function assertConfigured(): void
    {
        if (! config('services.taskmandu.base_url')
            || ! config('services.taskmandu.email')
            || ! config('services.taskmandu.password')) {
            throw new RuntimeException('Taskmandu is not configured — set TASKMANDU_BASE_URL/EMAIL/PASSWORD in .env');
        }
    }

    private function baseUrl(): string
    {
        return rtrim(config('services.taskmandu.base_url'), '/');
    }

    private function token(): string
    {
        return Cache::get(self::TOKEN_CACHE_KEY) ?? $this->login();
    }

    private function login(): string
    {
        $res = Http::baseUrl($this->baseUrl())
            ->acceptJson()
            ->timeout(20)
            ->post('/auth/login', [
                'email' => config('services.taskmandu.email'),
                'password' => config('services.taskmandu.password'),
            ]);

        if ($res->failed()) {
            throw new RuntimeException('Taskmandu login failed: '.$res->json('message', $res->body()));
        }

        $token = $res->json('data.tokens.accessToken');

        if (! $token) {
            throw new RuntimeException('Taskmandu login succeeded but no access token was returned');
        }

        // Taskmandu access tokens live 15m by default; cache slightly under that.
        Cache::put(self::TOKEN_CACHE_KEY, $token, now()->addMinutes(13));

        return $token;
    }
}
