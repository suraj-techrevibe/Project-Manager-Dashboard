import { useMemo, useState } from 'react';
import { pmApi } from '../../lib/pmApi';
import type { PmFlag, PmMetrics, Severity, TaskFocus, WorkloadRow } from '../../types/pm';

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
  { key: 'unassigned', label: 'Unassigned', color: 'text-amber-600' },
];

const UNASSIGNED = '__unassigned';
const STANDALONE = '__standalone';

const selectCls = 'rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm focus:border-slate-400 focus:outline-none';

const severityRank: Record<Severity, number> = { danger: 0, warning: 1, neutral: 2 };

interface TaskCard {
  card_id: number;
  task: PmFlag; // first flag — carries the shared task fields
  flags: PmFlag[];
  severity: Severity;
}

/* ------------------------------------------------------------------ */
/* Question buttons: each one filters the list AND answers in a line.   */
/* Computed from the synced cards in the browser — no AI call.          */
/* ------------------------------------------------------------------ */

type QuestionKey = 'overloaded' | 'overdue' | 'blocking' | 'unverified' | 'stuck' | 'unowned' | 'worst';

interface QuestionCtx {
  all: TaskCard[];
  workload: WorkloadRow[];
  overloadAt: number;
}

interface QuestionResult {
  text: string;
  match: (c: TaskCard) => boolean;
}

const hasFlag = (c: TaskCard, type: FlagType) => c.flags.some((f) => f.type === type);
const namesOf = (c: TaskCard) =>
  (c.task.assignee ?? '')
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean);
const projectOf = (c: TaskCard) => c.task.project_name ?? 'Standalone tasks';

function tally(items: string[]): [string, number][] {
  const m = new Map<string, number>();
  items.forEach((i) => m.set(i, (m.get(i) ?? 0) + 1));
  return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
}

const fmt = (t: [string, number][], n = 3) => t.slice(0, n).map(([k, v]) => `${k} (${v})`).join(', ');
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const QUESTIONS: { key: QuestionKey; label: string; run: (x: QuestionCtx) => QuestionResult }[] = [
  {
    key: 'overloaded',
    label: 'Who’s overloaded?',
    run: ({ workload, overloadAt }) => {
      if (!workload.length) return { text: 'No workload data yet — run pm:sync first.', match: () => false };
      const heavy = workload.filter((w) => w.open >= overloadAt);
      if (!heavy.length) {
        return { text: `Nobody is far above the team average (the line is ${overloadAt} open tasks).`, match: () => false };
      }
      const names = new Set(heavy.map((w) => w.name));
      return {
        text:
          heavy.map((w) => `${w.name}: ${w.open} open${w.overdue ? `, ${w.overdue} overdue` : ''}${w.blocked ? `, ${w.blocked} blocked` : ''}`).join(' · ') +
          '. Showing their flagged tasks.',
        match: (c) => namesOf(c).some((n) => names.has(n)),
      };
    },
  },
  {
    key: 'overdue',
    label: 'What’s overdue?',
    run: ({ all }) => {
      const m = all.filter((c) => hasFlag(c, 'overdue'));
      if (!m.length) return { text: 'Nothing is overdue.', match: () => false };
      const who = tally(m.flatMap((c) => (namesOf(c).length ? namesOf(c) : ['Unassigned'])));
      return { text: `${plural(m.length, 'task')} overdue. Most with: ${fmt(who)}.`, match: (c) => hasFlag(c, 'overdue') };
    },
  },
  {
    key: 'blocking',
    label: 'What’s blocking the most?',
    run: ({ all }) => {
      const m = all.filter((c) => hasFlag(c, 'blocked'));
      if (!m.length) return { text: 'Nothing is blocked.', match: () => false };
      return {
        text: `${plural(m.length, 'task')} blocked. By project: ${fmt(tally(m.map(projectOf)))}. By person: ${fmt(
          tally(m.flatMap((c) => (namesOf(c).length ? namesOf(c) : ['Unassigned'])))
        )}.`,
        match: (c) => hasFlag(c, 'blocked'),
      };
    },
  },
  {
    key: 'stuck',
    label: 'What hasn’t moved in 3+ days?',
    run: ({ all }) => {
      const m = all.filter((c) => hasFlag(c, 'stuck'));
      if (!m.length) return { text: 'Nothing has been sitting still for 3+ days.', match: () => false };
      const oldest = [...m].sort(
        (a, b) => new Date(a.task.last_activity_at ?? 0).getTime() - new Date(b.task.last_activity_at ?? 0).getTime()
      )[0];
      const days = daysAgo(oldest.task.last_activity_at);
      return {
        text: `${plural(m.length, 'task')} with no movement for 3+ days. Longest: “${oldest.task.title}”${days !== null ? ` (${days}d)` : ''}.`,
        match: (c) => hasFlag(c, 'stuck'),
      };
    },
  },
  {
    key: 'unverified',
    label: 'Which done tasks are unverified?',
    run: ({ all }) => {
      const m = all.filter((c) => hasFlag(c, 'unverified'));
      return m.length
        ? { text: `${plural(m.length, 'completed task')} still waiting for you to verify them.`, match: (c) => hasFlag(c, 'unverified') }
        : { text: 'Every recently completed task is verified.', match: () => false };
    },
  },
  {
    key: 'unowned',
    label: 'What has no owner?',
    run: ({ all }) => {
      const m = all.filter((c) => hasFlag(c, 'unassigned'));
      return m.length
        ? { text: `${plural(m.length, 'task')} with nobody assigned.`, match: (c) => hasFlag(c, 'unassigned') }
        : { text: 'Every open task has an assignee.', match: () => false };
    },
  },
  {
    key: 'worst',
    label: 'Which project is in the worst shape?',
    run: ({ all }) => {
      if (!all.length) return { text: 'No flagged tasks — nothing to compare.', match: () => false };
      const t = tally(all.map(projectOf));
      const [name, n] = t[0];
      return {
        text: `${name} has the most flagged tasks: ${n} of ${all.length}${t[1] ? `. Next: ${fmt(t.slice(1), 2)}` : ''}.`,
        match: (c) => projectOf(c) === name,
      };
    },
  },
];

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
  workload = [],
  onOpenTask,
}: {
  flags: PmFlag[];
  /** Kept optional so older callers that still pass `metrics` keep compiling; counts are derived from `flags` below. */
  metrics?: PmMetrics;
  workload?: WorkloadRow[];
  onOpenTask: (focus: TaskFocus) => void;
}) {
  const [flags, setFlags] = useState(initialFlags);
  const [nudges, setNudges] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [filter, setFilter] = useState<FlagType | null>(null);
  const [search, setSearch] = useState('');
  const [assignee, setAssignee] = useState('');
  const [project, setProject] = useState('');

  const [question, setQuestion] = useState<QuestionKey | null>(null);

  // Tile counts follow the list, so snoozing or verifying a card updates them immediately.
  const counts = useMemo(() => {
    const c: Record<FlagType, number> = { overdue: 0, stuck: 0, blocked: 0, unverified: 0, unassigned: 0 };
    flags.forEach((f) => (c[f.type] += 1));
    return c;
  }, [flags]);

  const people = useMemo(() => {
    const names = new Set(workload.map((w) => w.name));
    flags.forEach((f) => f.assignee?.split(',').forEach((n) => n.trim() && names.add(n.trim())));
    return Array.from(names).sort();
  }, [workload, flags]);

  const projectNames = useMemo(
    () => Array.from(new Set(flags.map((f) => f.project_name).filter((n): n is string => Boolean(n)))).sort(),
    [flags]
  );

  // "Overloaded" = well above the team average (and at least 5 open).
  const overloadAt = useMemo(() => {
    if (!workload.length) return Infinity;
    const avg = workload.reduce((n, w) => n + w.open, 0) / workload.length;
    return Math.max(5, Math.ceil(avg * 1.5));
  }, [workload]);

  const filtersActive = Boolean(filter || question || search || assignee || project);

  function clearFilters() {
    setFilter(null);
    setQuestion(null);
    setSearch('');
    setAssignee('');
    setProject('');
  }

  // One card per task, with every flag it has shown as a badge.
  const allCards: TaskCard[] = useMemo(() => {
    const byCard = new Map<number, PmFlag[]>();
    flags.forEach((f) => byCard.set(f.card_id, [...(byCard.get(f.card_id) ?? []), f]));

    return Array.from(byCard.entries()).map(([card_id, fs]) => ({
      card_id,
      task: fs[0],
      flags: fs,
      severity: fs.reduce<Severity>(
        (worst, f) => (severityRank[f.severity] < severityRank[worst] ? f.severity : worst),
        'neutral'
      ),
    }));
  }, [flags]);

  // The clicked question's one-line answer + which cards it keeps.
  const active = useMemo(() => {
    const q = QUESTIONS.find((x) => x.key === question);
    return q ? { label: q.label, ...q.run({ all: allCards, workload, overloadAt }) } : null;
  }, [question, allCards, workload, overloadAt]);

  const cards: TaskCard[] = useMemo(() => {
    return allCards
      .filter((c) => !filter || c.flags.some((f) => f.type === filter))
      .filter((c) => !active || active.match(c))
      .filter((c) => {
        const t = c.task;
        if (assignee === UNASSIGNED) return !t.assignee;
        if (assignee) return (t.assignee ?? '').split(',').some((n) => n.trim() === assignee);
        return true;
      })
      .filter((c) => {
        if (project === STANDALONE) return !c.task.project_id;
        return !project || c.task.project_name === project;
      })
      .filter((c) => {
        const q = search.trim().toLowerCase();
        if (!q) return true;
        const t = c.task;
        return [t.title, t.project_name, t.assignee, t.description, ...t.tags].some((v) => v?.toLowerCase().includes(q));
      })
      .sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);
  }, [allCards, filter, active, search, assignee, project]);

  const totalTasks = useMemo(() => new Set(flags.map((f) => f.card_id)).size, [flags]);

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
      {/* Question buttons: click one to filter the list and see the answer */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        {QUESTIONS.map((q) => (
          <button
            key={q.key}
            onClick={() => {
              if (question === q.key) return setQuestion(null);
              clearFilters(); // a question replaces other filters, so the answer matches the list
              setQuestion(q.key);
            }}
            className={`rounded-md border px-2.5 py-1 text-xs transition ${
              question === q.key ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            {q.label}
          </button>
        ))}
      </div>

      {active && (
        <div className="mb-3 flex items-start justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-700">
          <div>
            <div className="mb-0.5 text-xs text-slate-400">{active.label}</div>
            {active.text}
          </div>
          <button onClick={() => setQuestion(null)} className="text-xs text-slate-400 hover:text-slate-700" aria-label="Clear question">
            ✕
          </button>
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {metricLabels.map((m) => (
          <button
            key={m.key}
            onClick={() => {
              setQuestion(null);
              setFilter((cur) => (cur === m.key ? null : (m.key as FlagType)));
            }}
            className={`rounded-lg p-3 text-left transition ${
              filter === m.key ? 'bg-slate-900 ring-2 ring-slate-900' : 'bg-slate-50 hover:bg-slate-100'
            }`}
          >
            <div className={`mb-1 text-xs ${filter === m.key ? 'text-slate-300' : 'text-slate-500'}`}>{m.label}</div>
            <div className={`text-2xl font-medium ${filter === m.key ? 'text-white' : m.color}`}>{counts[m.key as FlagType]}</div>
          </button>
        ))}
      </div>

      {/* Workload: who has how much open — click a name to filter */}
      {workload.length > 0 && (
        <div className="mb-3">
          <div className="mb-1 text-xs text-slate-400">Open tasks per person</div>
          <div className="flex flex-wrap gap-1.5">
            {workload.map((w) => {
              const on = assignee === w.name;
              const heavy = w.open >= overloadAt;
              return (
                <button
                  key={w.name}
                  onClick={() => setAssignee(on ? '' : w.name)}
                  className={`rounded-md border px-2 py-1 text-xs transition ${
                    on
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : heavy
                        ? 'border-red-300 bg-red-50 text-red-700 hover:bg-red-100'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                  title={heavy ? 'Well above the team average' : undefined}
                >
                  {w.name} · {w.open} open
                  {w.overdue > 0 && ` · ${w.overdue} overdue`}
                  {w.blocked > 0 && ` · ${w.blocked} blocked`}
                  {heavy && !on && ' · overloaded'}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search title, project, person, tag…"
          className={`${selectCls} min-w-[12rem] flex-1`}
        />
        <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className={selectCls}>
          <option value="">Everyone</option>
          <option value={UNASSIGNED}>Unassigned</option>
          {people.map((n) => {
            const w = workload.find((x) => x.name === n);
            return (
              <option key={n} value={n}>
                {n}
                {w ? ` — ${w.open} open` : ''}
              </option>
            );
          })}
        </select>
        <select value={project} onChange={(e) => setProject(e.target.value)} className={selectCls}>
          <option value="">All projects</option>
          <option value={STANDALONE}>Standalone tasks</option>
          {projectNames.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>

      {filtersActive && (
        <div className="mb-3 flex items-center gap-2 text-xs text-slate-500">
          Showing {cards.length} of {totalTasks} flagged task{totalTasks === 1 ? '' : 's'}
          {filter && <> · “{filter}”</>}
          {active && <> · {active.label}</>}
          <button onClick={clearFilters} className="text-slate-700 underline">
            Clear filters
          </button>
        </div>
      )}

      {cards.length === 0 ? (
        <p className="text-sm text-slate-500">{filtersActive ? 'Nothing matches those filters.' : 'No flags. Board looks healthy.'}</p>
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
