import { useEffect, useState } from 'react';
import { pmApi } from '../../lib/pmApi';
import type { GitStatus, PullRequest } from '../../types/pm';

const checksClasses: Record<string, string> = {
  success: 'bg-green-50 text-green-700',
  failure: 'bg-red-50 text-red-700',
  pending: 'bg-amber-50 text-amber-700',
  unknown: 'bg-slate-100 text-slate-500',
};

const checksLabels: Record<string, string> = {
  success: 'Checks passing',
  failure: 'Checks failing',
  pending: 'Checks running',
  unknown: 'No checks',
};

type Action = 'fetch' | 'pull' | 'push' | 'checkout' | null;

export default function GitPanel() {
  const [git, setGit] = useState<GitStatus | null>(null);
  const [prs, setPrs] = useState<PullRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<Action>(null);
  const [error, setError] = useState<string | null>(null);
  const [branch, setBranch] = useState('');

  async function load() {
    setLoading(true);
    try {
      const { data } = await pmApi.gitStatus();
      setGit(data.git);
      setPrs(data.pull_requests);
      setBranch(data.git.branch);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function act(action: Action, fn: () => Promise<{ data: { git: GitStatus } }>) {
    setBusy(action);
    setError(null);
    try {
      const { data } = await fn();
      setGit(data.git);
    } catch (e: any) {
      setError(e?.response?.data?.error ?? `Couldn't ${action}. Check the server log.`);
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <p className="text-sm text-slate-500">Reading git status…</p>;
  if (!git) return <p className="text-sm text-red-600">Couldn't read git status.</p>;

  const isDirty = git.dirty.length > 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-slate-900">
              {git.branch}
              {git.has_upstream && (
                <span className="ml-2 text-xs font-normal text-slate-500">
                  {git.ahead > 0 && `${git.ahead} ahead`}
                  {git.ahead > 0 && git.behind > 0 && ' · '}
                  {git.behind > 0 && `${git.behind} behind`}
                  {git.ahead === 0 && git.behind === 0 && 'up to date'}
                </span>
              )}
            </div>
            {git.last_commit.hash && (
              <div className="mt-0.5 text-xs text-slate-500">
                {git.last_commit.hash} · {git.last_commit.subject} · {git.last_commit.author}, {git.last_commit.when}
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => act('fetch', pmApi.gitFetch)}
              disabled={busy !== null}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {busy === 'fetch' ? 'Fetching…' : 'Fetch'}
            </button>
            <button
              onClick={() => act('pull', pmApi.gitPull)}
              disabled={busy !== null || isDirty}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              title={isDirty ? 'Commit or stash first' : undefined}
            >
              {busy === 'pull' ? 'Pulling…' : 'Pull'}
            </button>
            <button
              onClick={() => act('push', pmApi.gitPush)}
              disabled={busy !== null || git.ahead === 0}
              className="rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
            >
              {busy === 'push' ? 'Pushing…' : 'Push'}
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
          <select
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            className="rounded-md border border-slate-200 px-2 py-1.5 text-sm"
          >
            {git.branches.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
          <button
            onClick={() => act('checkout', () => pmApi.gitCheckout(branch))}
            disabled={busy !== null || branch === git.branch || isDirty}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            title={isDirty ? 'Commit or stash first' : undefined}
          >
            {busy === 'checkout' ? 'Switching…' : 'Checkout'}
          </button>
          <button onClick={load} className="ml-auto text-xs text-slate-400 hover:text-slate-600">
            Refresh
          </button>
        </div>

        {error && <div className="mt-2 rounded-md bg-red-50 p-2 text-xs text-red-700">{error}</div>}

        {isDirty && (
          <div className="mt-3 border-t border-slate-100 pt-3">
            <div className="mb-1.5 text-xs font-medium text-slate-500">
              {git.dirty.length} uncommitted {git.dirty.length === 1 ? 'change' : 'changes'}
            </div>
            <div className="flex flex-col gap-1">
              {git.dirty.map((f, i) => (
                <div key={i} className="flex items-center gap-2 text-xs text-slate-600">
                  <span className="w-6 shrink-0 font-mono text-slate-400">{f.status}</span>
                  <span className="truncate">{f.file}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div>
        <div className="mb-2 text-sm font-medium text-slate-700">Open pull requests</div>
        {prs.length === 0 ? (
          <p className="text-sm text-slate-500">
            No open PRs, or GitHub isn't configured — set GITHUB_TOKEN in .env to see PR checks here.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {prs.map((pr) => (
              <a
                key={pr.number}
                href={pr.url}
                target="_blank"
                rel="noreferrer"
                className="block rounded-lg border border-slate-200 bg-white p-3 hover:border-slate-300"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm text-slate-900">
                      #{pr.number} {pr.title}
                      {pr.draft && <span className="ml-1.5 text-xs text-slate-400">(draft)</span>}
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500">
                      {pr.branch} → {pr.base} · {pr.author ?? 'unknown'} · updated {new Date(pr.updated_at).toLocaleDateString()}
                    </div>
                  </div>
                  <span className={`shrink-0 rounded px-2 py-0.5 text-xs ${checksClasses[pr.checks_state]}`}>
                    {checksLabels[pr.checks_state]}
                  </span>
                </div>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
