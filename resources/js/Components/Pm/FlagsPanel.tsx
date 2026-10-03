import { useMemo, useState } from 'react';
import { pmApi } from '../../lib/pmApi';
import type { PmFlag, PmMetrics, Severity, TaskFocus } from '../../types/pm';

const severityClasses: Record<Severity, string> = {
  danger: 'border-red-300 bg-red-50/60',
  warning: 'border-amber-300 bg-amber-50/60',
  neutral: 'border-slate-200 bg-white',
};

const badgeClasses: Record<Severity, string> = {
  danger: 'bg-red-100 text-red-700',
  warning: 'bg-amber-100 text-amber-700',
  neutral: 'bg-slate-100 text-slate-600',
};

const priorityClasses: Record<string, string> = {
  Low: 'bg-slate-100 text-slate-500',
  Medium: 'bg-blue-50 text-blue-600',
  High: 'bg-amber-50 text-amber-700',
  Critical: 'bg-red-50 text-red-700',
};

const statusClasses: Record<string, string> = {
  Assigned: 'bg-slate-100 text-slate-600',
  Pending: 'bg-slate-100 text-slate-600',
  'In Progress': 'bg-blue-50 text-blue-700',
  Blocked: 'bg-red-50 text-red-700',
  Completed: 'bg-green-50 text-green-700',
  Cancelled: 'bg-slate-100 text-slate-400',
};

type FlagType = PmFlag['type'];

const metricLabels: { key: keyof PmMetrics; label: string; color: string }[] = [
  { key: 'overdue', label: 'Overdue', color: 'text-red-600' },
  { key: 'stuck', label: 'Stuck 3+ days', color: 'text-amber-600' },
  { key: 'blocked', label: 'Blocked', color: 'text-slate-900' },
  { key: 'unverified', label: 'Unverified done', color: 'text-slate-900' },
];

const severityRank: Record<Severity, number> = { danger: 0, warning: 1, neutral: 2 };

interface TaskCard {
  card_id: number;
  task: PmFlag; // first flag — carries the shared task fields
  flags: PmFlag[];
  severity: Severity;
}

function daysAgo(iso: string | null): number | null {
  if (!iso) return null;
  const diff = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.floor(diff / 86_400_000));
}

function activityLabel(iso: string | null): string {
  const d = daysAgo(iso);
  if (d === null) return 'No activity recorded';
  if (d === 0) return 'Active today';
  return `Last activity ${d}d ago`;
}

function dueLabel(date: string | null): { text: string; overdue: boolean } {
  if (!date) return { text: 'No due date', overdue: false };
  const due = new Date(`${date}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((due.getTime() - today.getTime()) / 86_400_000);
  const pretty = due.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  if (diff < 0) return { text: `${pretty} (${-diff}d overdue)`, overdue: true };
  if (diff === 0) return { text: `${pretty} (today)`, overdue: false };
  if (diff === 1) return { text: `${pretty} (tomorrow)`, overdue: false };
  return { text: `${pretty} (in ${diff}d)`, overdue: false };
}

export default function FlagsPanel({
  flags: initialFlags,
  metrics,
  onOpenTask,
}: {
  flags: PmFlag[];
  metrics: PmMetrics;
  onOpenTask: (focus: TaskFocus) => void;
}) {
  const [flags, setFlags] = useState(initialFlags);
  const [nudges, setNudges] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [filter, setFilter] = useState<FlagType | null>(null);

  // One card per task, with every flag it has shown as a badge.
  const cards: TaskCard[] = useMemo(() => {
    const byCard = new Map<number, PmFlag[]>();
    flags.forEach((f) => byCard.set(f.card_id, [...(byCard.get(f.card_id) ?? []), f]));

    return Array.from(byCard.entries())
      .map(([card_id, fs]) => ({
        card_id,
        task: fs[0],
        flags: fs,
        severity: fs.reduce<Severity>(
          (worst, f) => (severityRank[f.severity] < severityRank[worst] ? f.severity : worst),
          'neutral'
        ),
      }))
      .filter((c) => !filter || c.flags.some((f) => f.type === filter))
      .sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);
  }, [flags, filter]);

  async function nudge(cardId: number) {
    setBusy(cardId);
    try {
      const { data } = await pmApi.nudge(cardId);
      setNudges((n) => ({ ...n, [cardId]: data.message }));
    } finally {
      setBusy(null);
    }
  }

  async function snooze(cardId: number) {
    await pmApi.snooze(cardId);
    setFlags((f) => f.filter((x) => x.card_id !== cardId));
  }

  async function verify(cardId: number) {
    await pmApi.verify(cardId);
    setFlags((f) => f.filter((x) => x.card_id !== cardId));
  }

  function open(card: TaskCard) {
    const t = card.task;
    if (t.project_id && t.task_id) {
      onOpenTask({ projectId: t.project_id, taskId: t.task_id });
    } else if (t.url) {
      // Standalone Taskmandu task — it has no project board, so open it in Taskmandu.
      window.open(t.url, '_blank', 'noopener');
    }
  }

  return (
    <div>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {metricLabels.map((m) => (
          <button
            key={m.key}
            onClick={() => setFilter((cur) => (cur === m.key ? null : (m.key as FlagType)))}
            className={`rounded-lg p-3 text-left transition ${
              filter === m.key ? 'bg-slate-900 ring-2 ring-slate-900' : 'bg-slate-50 hover:bg-slate-100'
            }`}
          >
            <div className={`mb-1 text-xs ${filter === m.key ? 'text-slate-300' : 'text-slate-500'}`}>{m.label}</div>
            <div className={`text-2xl font-medium ${filter === m.key ? 'text-white' : m.color}`}>{metrics[m.key]}</div>
          </button>
        ))}
      </div>

      {filter && (
        <div className="mb-3 flex items-center gap-2 text-xs text-slate-500">
          Showing {cards.length} task{cards.length === 1 ? '' : 's'} flagged “{filter}”
          <button onClick={() => setFilter(null)} className="text-slate-700 underline">
            Clear filter
          </button>
        </div>
      )}

      {cards.length === 0 ? (
        <p className="text-sm text-slate-500">{filter ? 'Nothing matches that filter.' : 'No flags. Board looks healthy.'}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {cards.map((c) => {
            const t = c.task;
            const due = dueLabel(t.due_at);
            const canOpen = Boolean((t.project_id && t.task_id) || t.url);
            const needsVerify = c.flags.some((f) => f.type === 'unverified');

            return (
              <div
                key={c.card_id}
                role={canOpen ? 'button' : undefined}
                tabIndex={canOpen ? 0 : undefined}
                onClick={() => open(c)}
                onKeyDown={(e) => e.key === 'Enter' && open(c)}
                className={`rounded-lg border p-3 ${severityClasses[c.severity]} ${
                  canOpen ? 'cursor-pointer transition hover:shadow-sm' : ''
                }`}
              >
                {/* Row 1: project, title, priority, status */}
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="mb-0.5 text-xs text-slate-500">
                      {t.project_name ? (
                        <span className="font-medium text-slate-600">{t.project_name}</span>
                      ) : (
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-500">Standalone task</span>
                      )}
                    </div>
                    <div className="text-sm font-medium text-slate-900">{t.title}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {t.priority && (
                      <span className={`rounded px-1.5 py-0.5 text-xs ${priorityClasses[t.priority] ?? priorityClasses.Low}`}>
                        {t.priority}
                      </span>
                    )}
                    <span className={`rounded px-1.5 py-0.5 text-xs ${statusClasses[t.status] ?? statusClasses.Pending}`}>
                      {t.status}
                    </span>
                  </div>
                </div>

                {/* Row 2: why it's flagged */}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {c.flags.map((f) => (
                    <span key={f.type} className={`rounded px-1.5 py-0.5 text-xs font-medium ${badgeClasses[f.severity]}`}>
                      {f.detail}
                    </span>
                  ))}
                </div>

                {t.description && <p className="mt-2 line-clamp-2 text-xs text-slate-600">{t.description}</p>}

                {/* Row 3: details */}
                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
                  <Detail label="Assignee" value={t.assignee ?? 'Unassigned'} warn={!t.assignee} />
                  <Detail label="Due" value={due.text} warn={due.overdue} />
                  <Detail label="Estimate" value={t.estimated_hours ? `${t.estimated_hours}h` : '—'} />
                  <Detail label="Assigned by" value={t.assigned_by ?? '—'} />
                </dl>

                {/* Row 4: counts, tags, activity */}
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
                  <span>{t.subtasks_count} subtask{t.subtasks_count === 1 ? '' : 's'}</span>
                  <span>{t.comments_count} comment{t.comments_count === 1 ? '' : 's'}</span>
                  <span>{activityLabel(t.last_activity_at)}</span>
                  {t.tags.map((tag) => (
                    <span key={tag} className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-500">
                      {tag}
                    </span>
                  ))}
                </div>

                {/* Footer: actions */}
                <div className="mt-3 flex items-center justify-between gap-2">
                  <span className="text-xs text-slate-400">
                    {t.project_id && t.task_id ? 'Open in Projects →' : t.url ? 'Open in Taskmandu ↗' : ''}
                  </span>
                  <div className="flex gap-1.5" onClick={(e) => e.stopPropagation()}>
                    {needsVerify ? (
                      <button
                        onClick={() => verify(c.card_id)}
                        className="rounded-md bg-white px-2 py-1 text-xs font-medium shadow-sm hover:bg-slate-50"
                      >
                        Mark verified
                      </button>
                    ) : (
                      <button
                        onClick={() => nudge(c.card_id)}
                        disabled={busy === c.card_id}
                        className="rounded-md bg-white px-2 py-1 text-xs font-medium shadow-sm hover:bg-slate-50 disabled:opacity-50"
                      >
                        {busy === c.card_id ? 'Drafting…' : 'Draft nudge'}
                      </button>
                    )}
                    <button
                      onClick={() => snooze(c.card_id)}
                      className="rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-white/60"
                    >
                      Snooze 3d
                    </button>
                  </div>
                </div>

                {nudges[c.card_id] && (
                  <div className="mt-2 rounded-md bg-white p-2 text-xs text-slate-700" onClick={(e) => e.stopPropagation()}>
                    {nudges[c.card_id]}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Detail({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-slate-400">{label}</dt>
      <dd className={`truncate ${warn ? 'font-medium text-red-600' : 'text-slate-700'}`}>{value}</dd>
    </div>
  );
}
