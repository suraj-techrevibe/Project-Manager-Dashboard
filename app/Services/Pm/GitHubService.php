<?php

namespace App\Services\Pm;

use Illuminate\Support\Facades\Http;

class GitHubService
{
    public function configured(): bool
    {
        return (bool) config('services.github.token');
    }

    /**
     * Open PRs with their combined check status, for the "is my team's work
     * actually done" report. $slug is "owner/repo".
     */
    public function openPullRequests(string $slug): array
    {
        $prs = $this->get("/repos/{$slug}/pulls", ['state' => 'open', 'per_page' => 20]);

        return collect($prs)->map(function ($pr) use ($slug) {
            $checks = $this->get("/repos/{$slug}/commits/{$pr['head']['sha']}/status");

            return [
                'number' => $pr['number'],
                'title' => $pr['title'],
                'author' => $pr['user']['login'] ?? null,
                'branch' => $pr['head']['ref'],
                'base' => $pr['base']['ref'],
                'draft' => $pr['draft'] ?? false,
                'mergeable_state' => $pr['mergeable_state'] ?? null,
                'checks_state' => $checks['state'] ?? 'unknown', // success | failure | pending | unknown
                'review_comments' => $pr['review_comments'] ?? 0,
                'updated_at' => $pr['updated_at'],
                'url' => $pr['html_url'],
            ];
        })->all();
    }

    private function get(string $path, array $query = []): array
    {
        return Http::withToken(config('services.github.token'))
            ->acceptJson()
            ->timeout(20)
            ->retry(2, 400)
            ->get("https://api.github.com{$path}", $query)
            ->throw()
            ->json();
    }
}
