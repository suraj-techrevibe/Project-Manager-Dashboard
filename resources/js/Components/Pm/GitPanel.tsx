import { useEffect, useState } from 'react';
import { pmApi } from '../../lib/pmApi';
import type { GitStatus, PullRequest } from '../../types/pm';
import { EmptyState, JumpNav, Notice, PageHeader, Pill, Section, btnPrimary, btnSecondary } from './ui/kit';

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

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader icon="branch" title="Git" description="Branch, sync and open pull requests for this project." />
        <EmptyState title="Reading git status…" />
      </div>
    );
  }
  if (!git) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader icon="branch" title="Git" description="Branch, sync and open pull requests for this project." />
        <Notice tone="danger">Couldn't read git status. Check that the app is running inside a git repository.</Notice>
      </div>
    );
  }

  const isDirty = git.dirty.length > 0;
  const sync = !git.has_upstream
    ? { tone: 'neutral' as const, text: 'No upstream' }
    : git.ahead === 0 && git.behind === 0
      ? { tone: 'ok' as const, text: 'Up to date' }
      : { tone: 'warn' as const, text: [git.ahead > 0 && `${git.ahead} ahead`, git.behind > 0 && `${git.behind} behind`].filter(Boolean).join(' · ') };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        icon="branch"
        title="Git"
        description="Branch, sync and open pull requests for this project."
        status={
          git.last_commit.hash && (
            <>
              Last commit <span className="font-mono">{git.last_commit.hash}</span> · {git.last_commit.subject} · {git.last_commit.author}, {git.last_commit.when}
            </>
          )
        }
        actions={
          <button onClick={load} className={btnSecondary}>
            Refresh
          </button>
        }
        links={[
          { label: 'Today', tab: 'today' },
          { label: 'Projects', tab: 'projects' },
          { label: 'Reports', tab: 'reports' },
        ]}
      />

      <JumpNav
        items={[
          { id: 'git-branch', label: 'Branch & sync' },
          { id: 'git-changes', label: 'Uncommitted', count: git.dirty.length, tone: isDirty ? 'warn' : 'neutral' },
          { id: 'git-prs', label: 'Pull requests', count: prs.length },
        ]}
      />

      <Section
        id="git-branch"
        title="Branch & sync"
        tone="brand"
        badges={
          <>
            <Pill tone="brand">{git.branch}</Pill>
            <Pill tone={sync.tone}>{sync.text}</Pill>
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => act('fetch', pmApi.gitFetch)} disabled={busy !== null} className={btnSecondary}>
            {busy === 'fetch' ? 'Fetching…' : 'Fetch'}
          </button>
          <button
            onClick={() => act('pull', pmApi.gitPull)}
            disabled={busy !== null || isDirty}
            className={btnSecondary}
            title={isDirty ? 'Commit or stash first' : undefined}
          >
            {busy === 'pull' ? 'Pulling…' : 'Pull'}
          </button>
          <button onClick={() => act('push', pmApi.gitPush)} disabled={busy !== null || git.ahead === 0} className={btnPrimary}>
            {busy === 'push' ? 'Pushing…' : 'Push'}
          </button>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
          <label className="text-xs font-medium text-slate-500" htmlFor="git-branch-select">
            Switch branch
          </label>
          <select
            id="git-branch-select"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
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
            className={btnSecondary}
            title={isDirty ? 'Commit or stash first' : undefined}
          >
            {busy === 'checkout' ? 'Switching…' : 'Checkout'}
          </button>
        </div>

        {error && (
          <div className="mt-3">
            <Notice tone="danger">{error}</Notice>
          </div>
        )}
      </Section>

      <Section
        id="git-changes"
        title="Uncommitted changes"
        count={git.dirty.length}
        tone={isDirty ? 'warn' : 'ok'}
        subtitle={isDirty ? 'Commit or stash these before pulling or switching branch' : undefined}
      >
        {isDirty ? (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-100">
            {git.dirty.map((f, i) => (
              <li key={i} className="flex items-center gap-3 px-3 py-1.5 text-xs text-slate-600">
                <span className="w-6 shrink-0 font-mono font-semibold text-amber-600">{f.status}</span>
                <span className="truncate font-mono">{f.file}</span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="Working tree clean">Nothing to commit.</EmptyState>
        )}
      </Section>

      <Section id="git-prs" title="Open pull requests" count={prs.length} tone="info">
        {prs.length === 0 ? (
          <EmptyState title="No open pull requests">
            Or GitHub isn't configured — set <span className="font-mono">GITHUB_TOKEN</span> in .env to see PR checks here.
          </EmptyState>
        ) : (
          <div className="grid gap-2 lg:grid-cols-2">
            {prs.map((pr) => (
              <a
                key={pr.number}
                href={pr.url}
                target="_blank"
                rel="noreferrer"
                className="block rounded-lg border border-slate-200 bg-white p-3 transition hover:border-indigo-300 hover:shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-slate-900">
                      #{pr.number} {pr.title}
                      {pr.draft && <span className="ml-1.5 text-xs font-normal text-slate-400">(draft)</span>}
                    </div>
                    <div className="mt-0.5 truncate text-xs text-slate-500">
                      {pr.branch} → {pr.base} · {pr.author ?? 'unknown'} · updated {new Date(pr.updated_at).toLocaleDateString()}
                    </div>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${checksClasses[pr.checks_state]}`}>{checksLabels[pr.checks_state]}</span>
                </div>
              </a>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
