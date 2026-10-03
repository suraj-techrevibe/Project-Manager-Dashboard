<?php

namespace App\Services\Pm;

use Illuminate\Support\Facades\Process;
use RuntimeException;

/**
 * Wraps git for the app's own repo. All commands run with fixed array
 * arguments (never a shell string built from user input), and any
 * user-supplied value (a branch name) is checked against the repo's own
 * branch list before use — never passed straight to the shell.
 */
class GitService
{
    private string $repo;

    public function __construct()
    {
        $this->repo = base_path();
    }

    public function status(): array
    {
        $branch = $this->run(['git', 'rev-parse', '--abbrev-ref', 'HEAD']);
        $hasUpstream = $this->run(['git', 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], allowFail: true) !== null;

        [$ahead, $behind] = [0, 0];
        if ($hasUpstream) {
            $counts = $this->run(['git', 'rev-list', '--left-right', '--count', 'HEAD...@{u}']);
            [$ahead, $behind] = array_map('intval', preg_split('/\s+/', trim($counts)));
        }

        $dirty = collect(explode("\n", $this->run(['git', 'status', '--porcelain'])))
            ->filter()
            ->map(fn ($line) => [
                'status' => trim(substr($line, 0, 2)),
                'file' => trim(substr($line, 3)),
            ])
            ->values();

        $log = $this->run(['git', 'log', '-1', '--pretty=format:%h|%an|%ar|%s']);
        [$hash, $author, $when, $subject] = array_pad(explode('|', $log, 4), 4, null);

        return [
            'branch' => trim($branch),
            'has_upstream' => $hasUpstream,
            'ahead' => $ahead,
            'behind' => $behind,
            'dirty' => $dirty,
            'last_commit' => compact('hash', 'author', 'when', 'subject'),
            'branches' => $this->branches(),
        ];
    }

    public function branches(): array
    {
        $this->run(['git', 'fetch', '--quiet'], allowFail: true);

        $local = collect(explode("\n", $this->run(['git', 'branch', '--format=%(refname:short)'])))
            ->filter()
            ->values();

        $remote = collect(explode("\n", $this->run(['git', 'branch', '-r', '--format=%(refname:short)'])))
            ->filter()
            ->map(fn ($b) => preg_replace('#^origin/#', '', $b))
            ->reject(fn ($b) => $b === 'HEAD')
            ->values();

        return $local->merge($remote)->unique()->sort()->values()->all();
    }

    public function fetch(): array
    {
        $this->run(['git', 'fetch', '--all', '--prune']);

        return $this->status();
    }

    public function pull(): array
    {
        $status = $this->status();

        if ($status['dirty']->isNotEmpty()) {
            throw new RuntimeException('Working tree has uncommitted changes. Commit or stash before pulling.');
        }

        $this->run(['git', 'pull', '--ff-only']);

        return $this->status();
    }

    public function push(): array
    {
        $status = $this->status();

        $this->run(['git', 'push', 'origin', $status['branch']]);

        return $this->status();
    }

    public function checkout(string $branch): array
    {
        if (! in_array($branch, $this->branches(), true)) {
            throw new RuntimeException("Unknown branch: {$branch}");
        }

        $current = $this->status();
        if ($current['dirty']->isNotEmpty()) {
            throw new RuntimeException('Working tree has uncommitted changes. Commit or stash before switching branches.');
        }

        $this->run(['git', 'checkout', $branch]);

        return $this->status();
    }

    public function remoteSlug(): ?string
    {
        $url = trim($this->run(['git', 'config', '--get', 'remote.origin.url'], allowFail: true) ?? '');

        if (preg_match('#github\.com[:/]([\w.-]+/[\w.-]+?)(\.git)?$#', $url, $m)) {
            return $m[1];
        }

        return null;
    }

    private function run(array $command, bool $allowFail = false): ?string
    {
        $result = Process::path($this->repo)->timeout(30)->run($command);

        if (! $result->successful()) {
            if ($allowFail) {
                return null;
            }
            throw new RuntimeException('git command failed: '.implode(' ', $command).' — '.$result->errorOutput());
        }

        return $result->output();
    }
}
