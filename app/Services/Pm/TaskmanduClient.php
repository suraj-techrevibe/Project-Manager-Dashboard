<?php

namespace App\Services\Pm;

use Illuminate\Http\Client\PendingRequest;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use RuntimeException;

/**
 * Talks to the real Taskmandu API (Node/Express/Mongo, JWT bearer auth —
 * see backend/src/features/auth). Logs in once with a service account,
 * caches the access token, and re-authenticates automatically when it
 * expires or a request comes back 401.
 *
 * Every Taskmandu response is wrapped as {success, message, data, pagination?}
 * (see backend/src/utils/ApiResponse.ts) — data() below unwraps that.
 */
class TaskmanduClient
{
    private const TOKEN_CACHE_KEY = 'taskmandu:access_token';

    public function configured(): bool
    {
        return config('services.taskmandu.base_url')
            && config('services.taskmandu.email')
            && config('services.taskmandu.password');
    }

    public function get(string $path, array $query = []): array
    {
        return $this->request('get', $path, ['query' => $query]);
    }

    public function post(string $path, array $body = []): array
    {
        return $this->request('post', $path, ['json' => $body]);
    }

    public function patch(string $path, array $body = []): array
    {
        return $this->request('patch', $path, ['json' => $body]);
    }

    public function delete(string $path): array
    {
        return $this->request('delete', $path, []);
    }

    /**
     * Follows Taskmandu's page/limit pagination (max limit 100) and
     * returns every item across all pages for a list endpoint.
     */
    public function paginate(string $path, array $query = []): array
    {
        $items = [];
        $page = 1;

        do {
            $res = $this->get($path, $query + ['page' => $page, 'limit' => 100]);
            $items = array_merge($items, $res['data'] ?? []);
            $totalPages = $res['pagination']['totalPages'] ?? 1;
            $page++;
        } while ($page <= $totalPages);

        return $items;
    }

    private function request(string $method, string $path, array $options): array
    {
        if (! $this->configured()) {
            throw new RuntimeException('Taskmandu is not configured — set TASKMANDU_BASE_URL/EMAIL/PASSWORD in .env');
        }

        $attempt = function () use ($method, $path, $options) {
            return $this->client()->{$method}($path, $options['json'] ?? $options['query'] ?? []);
        };

        $res = $attempt();

        if ($res->status() === 401) {
            $this->login(forceRefresh: true);
            $res = $attempt();
        }

        if ($res->failed()) {
            $message = $res->json('message', $res->body());
            throw new RuntimeException("Taskmandu API error ({$res->status()}): {$message}");
        }

        return $res->json();
    }

    private function client(): PendingRequest
    {
        return Http::baseUrl(rtrim(config('services.taskmandu.base_url'), '/'))
            ->withToken($this->token())
            ->acceptJson()
            ->timeout(20)
            ->retry(2, 400, throw: false);
    }

    private function token(): string
    {
        return Cache::get(self::TOKEN_CACHE_KEY) ?? $this->login();
    }

    private function login(bool $forceRefresh = false): string
    {
        if ($forceRefresh) {
            Cache::forget(self::TOKEN_CACHE_KEY);
        }

        $res = Http::baseUrl(rtrim(config('services.taskmandu.base_url'), '/'))
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

        // Default access token life is 15m (JWT_ACCESS_EXPIRES_IN) — cache a
        // little under that so we re-login before Taskmandu rejects us.
        Cache::put(self::TOKEN_CACHE_KEY, $token, now()->addMinutes(13));

        return $token;
    }
}
