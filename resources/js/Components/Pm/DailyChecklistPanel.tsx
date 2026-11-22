import axios from 'axios';
import { useEffect, useMemo, useState } from 'react';
import type { PmPage } from '@/lib/pmNav';
import type { TodayData } from '@/types/pm';
import RoutineCatchUp from './RoutineCatchUp';

type Params = Record<string, string | null | undefined>;
type QaReview = { qa_status: string; task_status: string };

/** Live task counts (same numbers and rules as the Command Center tiles and All tasks). */
export interface ChecklistTaskCounts {
  overdue: number;
  blocked: number;
  no_owner: number;
}

interface Step {
  id: string;
  title: string;
  /** One plain sentence: when is this step finished. */
  doneWhen: string;
  /** What the number counts, e.g. "overdue tasks". null = no number, manual step. */
  count: number | null;
  unit: string;
  /** Count is not known yet (still loading, or data unavailable). */
  unknown?: boolean;
  go: { page: PmPage; params?: Params; label: string };
}

const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const formatSync = (value?: string | null) => {
  if (!value) return 'never';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? 'unknown' : d.toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
};

function useDaily<T>(name: string, initial: T): [T, (v: T | ((c: T) => T)) => void] {
  const key = `pm-daily:${name}:${todayKey()}`;
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* Still works for this page view. */
    }
  }, [key, value]);
  const updateValue = (next: T | ((current: T) => T)) => {
    setValue((current) => {
      const resolved = typeof next === 'function'
        ? (next as (current: T) => T)(current)
        : next;
      try {
        window.localStorage.setItem(key, JSON.stringify(resolved));
      } catch {
        /* Keep the in-memory checklist usable if storage is unavailable. */
      }
      return resolved;
    });
  };
  return [value, updateValue];
}

export default function DailyChecklistPanel({
  today,
  taskCounts,
  scopeLabel,
  loading,
  error,
  onRetry,
  onNavigate,
}: {
  today: TodayData | null;
  taskCounts: ChecklistTaskCounts;
  /** Name of the selected business, or null for all businesses. */
  scopeLabel: string | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onNavigate: (page: PmPage, params?: Params) => void;
}) {
  const [ticked, setTicked] = useDaily<Record<string, boolean>>('ticks', {});
  const [priorities, setPriorities] = useDaily<string[]>('priorities', ['', '', '']);
  // After "Reset progress" nothing is auto-completed from live counts: every step starts unticked until you tick it.
  const [fresh, setFresh] = useDaily<boolean>('fresh', false);
  const [qa, setQa] = useState<QaReview[] | null>(null);
  const [qaError, setQaError] = useState(false);

  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const { data } = await axios.get('/pm/api/qa/task-inbox');
        if (live) {
          setQa((data.reviews ?? []) as QaReview[]);
          setQaError(false);
        }
      } catch {
        if (live) setQaError(true);
      }
    };
    void load();
    const t = window.setInterval(() => void load(), 60_000);
    return () => {
      live = false;
      window.clearInterval(t);
    };
  }, []);

  const sync = today?.operations_summary?.sync;
  const syncAt = sync?.last_synced_at ?? today?.lastSyncedAt ?? null;
  const syncAge = syncAt ? Date.now() - new Date(syncAt).getTime() : null;
  const syncProblem =
    error ||
    sync?.error?.message ||
    sync?.warning?.message ||
    (sync && !sync.configured ? 'Taskmandu is not configured.' : null) ||
    (syncAge === null ? 'Taskmandu has never synced.' : syncAge > 15 * 60_000 ? 'Taskmandu data is more than 15 minutes old.' : null);

  const ops = today?.operations_summary?.counts;
  const decisions = ops ? ops.requests_for_decision + ops.overdue_requests + ops.ideas_for_review : 0;
  const awaitingQa = qa ? qa.filter((r) => r.qa_status === 'Awaiting QA' && ['Completed', 'Review'].includes(r.task_status)).length : 0;
  const failedQa = qa ? qa.filter((r) => r.qa_status === 'Failed').length : 0;
  const fu = today?.meeting_followup?.counts;
  const followups = fu ? (['blocked', 'overdue', 'subtasks_incomplete', 'stuck', 'not_pushed', 'not_started'] as const).reduce((n, k) => n + (fu[k] ?? 0), 0) : 0;
  const overloaded = (today?.workload ?? []).filter((w) => (w.week_hours ?? 0) > (w.capacity ?? 40)).length;
  const notReady = !today;

  const steps: Step[] = [
    {
      id: 'sync',
      title: 'Check the data is live',
      doneWhen: 'Taskmandu synced in the last 15 minutes with no error. If not, every number below may be out of date.',
      count: syncProblem ? 1 : 0,
      unit: 'data problem',
      unknown: loading && !today,
      go: { page: 'today', label: 'Open Command Center' },
    },
    {
      id: 'decide',
      title: 'Decide requests and ideas',
      doneWhen: 'No request is waiting for your decision or past its date, and no idea is waiting for review. Log new ones first.',
      count: decisions,
      unit: 'waiting on you',
      unknown: notReady,
      go: { page: 'operations', label: 'Open Operations' },
    },
    {
      id: 'late',
      title: 'Chase overdue and blocked tasks',
      doneWhen: 'Zero overdue and blocked. If some remain, tick it after you have chased every owner or moved the date.',
      count: taskCounts.overdue + taskCounts.blocked,
      unit: `${taskCounts.overdue} overdue · ${taskCounts.blocked} blocked`,
      unknown: notReady,
      go: { page: 'tasks', params: { tq: taskCounts.overdue ? 'overdue' : 'blocked' }, label: 'Open tasks' },
    },
    {
      id: 'owners',
      title: 'Give every task an owner',
      doneWhen: 'No open task is without an assignee.',
      count: taskCounts.no_owner,
      unit: 'without an owner',
      unknown: notReady,
      go: { page: 'tasks', params: { tq: 'unassigned' }, label: 'Open tasks' },
    },
    {
      id: 'qa',
      title: 'Test work waiting for QA',
      doneWhen: 'Nothing is awaiting QA and no failed fix is waiting on a retest.',
      count: awaitingQa + failedQa,
      unit: `${awaitingQa} awaiting · ${failedQa} failed`,
      unknown: qa === null && !qaError,
      go: { page: 'qa', label: 'Open QA Center' },
    },
    {
      id: 'meetings',
      title: 'Follow up the last meeting',
      doneWhen: 'Every action from the latest meeting has an owner and is moving. Record today’s meeting in Minutes.',
      count: followups,
      unit: 'actions need action',
      unknown: notReady,
      go: { page: 'minutes', label: 'Open Minutes' },
    },
    {
      id: 'capacity',
      title: 'Check who is overloaded',
      doneWhen: 'Nobody is over weekly hours. Move work to people with room.',
      count: overloaded,
      unit: 'over capacity',
      unknown: notReady,
      go: { page: 'today', label: 'Open workload' },
    },
    {
      id: 'priorities',
      title: 'Set today’s top 3 and tell the team',
      doneWhen: 'Three priorities written below, and the boss and Senior Dev know them.',
      count: null,
      unit: '',
      go: { page: 'today', label: 'Open Command Center' },
    },
    { id: 'mid_requests', title: 'Midday: review new requests', doneWhen: 'New requests have an owner and next action.', count: null, unit: '', go: { page: 'operations', label: 'Open Operations' } },
    { id: 'mid_blocked', title: 'Midday: check blocked work', doneWhen: 'Blocked work has a clear owner and next step.', count: null, unit: '', go: { page: 'tasks', params: { tq: 'blocked' }, label: 'Open blocked tasks' } },
    { id: 'mid_qa', title: 'Midday: check QA progress', doneWhen: 'QA work has been reviewed and retest owners are clear.', count: null, unit: '', go: { page: 'qa', label: 'Open QA' } },
    { id: 'eod_statuses', title: 'End of day: review task statuses', doneWhen: 'Stale in-progress tasks have been checked with their owners.', count: null, unit: '', go: { page: 'tasks', label: 'Open tasks' } },
    { id: 'eod_standup', title: 'End of day: send team update', doneWhen: 'The team knows what moved, what is blocked and what is next.', count: null, unit: '', go: { page: 'today', label: 'Open Command Center' } },
    { id: 'eod_report', title: 'End of day: review daily report', doneWhen: 'The daily report has been opened and reviewed.', count: null, unit: '', go: { page: 'reports', label: 'Open Reports' } },
    { id: 'eod_waiting', title: 'End of day: review waiting items', doneWhen: 'Items waiting two or more days have an owner and follow-up.', count: null, unit: '', go: { page: 'operations', label: 'Open Operations' } },
    { id: 'eod_tomorrow', title: 'End of day: set tomorrow priorities', doneWhen: 'Tomorrow’s priorities are written down.', count: null, unit: '', go: { page: 'today', label: 'Open Command Center' } },
    ...(new Date().getDay() === 5 ? [
      { id: 'fri_ideas', title: 'Friday: review ideas', doneWhen: 'Ideas for review have a decision or next step.', count: null, unit: '', go: { page: 'operations', label: 'Open Operations' } },
      { id: 'fri_balance', title: 'Friday: review team capacity', doneWhen: 'Next week’s workload is balanced.', count: null, unit: '', go: { page: 'today', label: 'Open workload' } },
      { id: 'fri_health', title: 'Friday: review project health', doneWhen: 'Project risks and progress have been reviewed.', count: null, unit: '', go: { page: 'projects', label: 'Open Projects' } },
    ] : []),
  ];

  const isDone = (s: Step) => {
    if (s.id === 'priorities') return Boolean(ticked[s.id]) && priorities.some((p) => p.trim());
    if (s.unknown) return false;
    return (!fresh && s.count === 0) || Boolean(ticked[s.id]);
  };
  const done = steps.filter(isDone).length;
  const next = steps.find((s) => !isDone(s)) ?? null;
  const dateLabel = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

  const toggle = (id: string) => setTicked((c) => ({ ...c, [id]: !c[id] }));
  const setPriority = (i: number, v: string) => setPriorities((c) => c.map((p, idx) => (idx === i ? v : p)));
  const syncBadge = syncProblem ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700';

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <RoutineCatchUp ticks={ticked} priorities={priorities} onRestore={(serverTicks, serverPriorities) => {
        setTicked(serverTicks);
        setPriorities([serverPriorities[0] ?? '', serverPriorities[1] ?? '', serverPriorities[2] ?? '']);
      }} />
      <header className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-indigo-600">Daily routine · {dateLabel}</p>
            <h2 className="mt-1 text-xl font-bold text-slate-900">{done === steps.length ? 'All done for today' : `${done} of ${steps.length} steps done`}</h2>
            <p className="mt-1 text-sm text-slate-500">
              Go top to bottom. A step finishes by itself when its number reaches 0, or when you tick it after acting.
              {scopeLabel ? ` Task numbers are for ${scopeLabel} only; requests, QA, meetings and capacity cover all projects.` : ''}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${syncBadge}`}>
              {syncProblem ? 'Data not live' : `Synced ${formatSync(syncAt)}`}
            </span>
            <button
              type="button"
              onClick={() => {
                setTicked({});
                setPriorities(['', '', '']);
                setFresh(true);
              }}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700"
              title="Start today’s checklist from zero: clears every tick and today’s priorities."
            >
              Reset progress
            </button>
          </div>
        </div>
        {fresh && (
          <p className="mt-3 text-xs text-slate-500">
            Fresh start — tick each step as you finish it.{' '}
            <button type="button" onClick={() => setFresh(false)} className="font-semibold text-indigo-600 hover:underline">Use live counts again</button>
          </p>
        )}
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
          <div className={`h-full rounded-full transition-all ${done === steps.length ? 'bg-emerald-500' : 'bg-indigo-500'}`} style={{ width: `${(done / steps.length) * 100}%` }} />
        </div>
      </header>

      {syncProblem && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          <div className="min-w-0 flex-1 basis-64">
            <b>Numbers may be out of date.</b> <span className="break-words">{syncProblem.length > 200 ? `${syncProblem.slice(0, 200)}…` : syncProblem}</span>
          </div>
          <button type="button" onClick={onRetry} className="shrink-0 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700">Reload</button>
        </div>
      )}
      {qaError && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">QA data could not be loaded, so the QA step cannot be checked.</div>}

      {next && (
        <div className="rounded-2xl border-2 border-indigo-200 bg-indigo-50 p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-indigo-700">Do this next</p>
          <p className="mt-1 text-lg font-bold text-slate-900">{steps.indexOf(next) + 1}. {next.title}</p>
          <p className="mt-1 text-sm text-slate-600">{next.count !== null && !next.unknown && next.count > 0 ? `${next.unit}. ` : ''}{next.doneWhen}</p>
          <button type="button" onClick={() => onNavigate(next.go.page, next.go.params)} className="mt-3 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700">
            {next.go.label} →
          </button>
        </div>
      )}

      <ol className="space-y-2">
        {steps.map((s, i) => {
          const finished = isDone(s);
          const auto = !fresh && !s.unknown && s.count === 0;
          return (
            <li key={s.id} className={`rounded-xl border bg-white p-4 ${finished ? 'border-emerald-200 bg-emerald-50/40' : s === next ? 'border-indigo-300' : 'border-slate-200'}`}>
              <div className="flex flex-wrap items-center gap-3">
                <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${finished ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-600'}`}>{finished ? '✓' : i + 1}</div>
                <div className="min-w-0 flex-1 basis-56">
                  <div className={`text-sm font-semibold ${finished ? 'text-slate-500' : 'text-slate-900'}`}>{s.title}</div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    {s.unknown ? 'Checking…' : finished ? (auto ? 'Auto-complete: live count is zero.' : 'Manually marked done.') : s.count !== null ? `${s.count > 0 && s.id !== 'late' ? `${s.count} ` : ''}${s.unit}` : s.doneWhen}
                  </div>
                </div>
                <button type="button" onClick={() => onNavigate(s.go.page, s.go.params)} className="shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">{s.go.label} →</button>
                {!auto && (
                  <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs font-medium text-slate-600">
                    <input type="checkbox" checked={Boolean(ticked[s.id])} onChange={() => toggle(s.id)} className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" />
                    Done
                  </label>
                )}
              </div>
              {s.id === 'priorities' && (
                <div className="mt-3 space-y-2 pl-11">
                  {priorities.map((p, idx) => (
                    <input
                      key={idx}
                      value={p}
                      onChange={(e) => setPriority(idx, e.target.value)}
                      placeholder={`Priority ${idx + 1}: outcome, business, owner`}
                      maxLength={160}
                      className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                    />
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ol>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Only when needed</h3>
        <div className="mt-2 flex flex-wrap gap-2">
          {[
            { label: 'Client asked for extra work → Scope check', page: 'scope' as PmPage },
            { label: 'Turn a brief into tickets', page: 'brief' as PmPage },
            { label: 'Release today → Git and projects', page: 'git' as PmPage },
            { label: 'Friday → Weekly report', page: 'reports' as PmPage },
          ].map((l) => (
            <button key={l.page} type="button" onClick={() => onNavigate(l.page)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">{l.label}</button>
          ))}
        </div>
      </section>

      <p className="text-center text-xs text-slate-400">Ticks and priorities are saved in this browser for today and start fresh tomorrow.</p>
    </div>
  );
}
