import axios from 'axios';
import React, { useEffect, useMemo, useState } from 'react';
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
  section: 'prepare' | 'coordinate' | 'close';
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
  const [websiteQa, setWebsiteQa] = useDaily<Record<string, boolean>>('website-qa', {});
  const [teamFollowups, setTeamFollowups] = useDaily<Record<string, boolean>>('team-followups', {});
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
      id: 'sync', section: 'prepare',
      title: 'Check Taskmandu data is live',
      doneWhen: 'Taskmandu synced in the last 15 minutes with no error.',
      count: syncProblem ? 1 : 0, unit: 'data problem', unknown: loading && !today,
      go: { page: 'today', label: 'Open Command Center' },
    },
    {
      id: 'health', section: 'prepare',
      title: 'Review task health and urgent work',
      doneWhen: 'Overdue and blocked tasks have been identified and prioritised for follow-up.',
      count: taskCounts.overdue + taskCounts.blocked,
      unit: `${taskCounts.overdue} overdue · ${taskCounts.blocked} blocked`, unknown: notReady,
      go: { page: 'tasks', params: { tq: taskCounts.overdue ? 'overdue' : 'blocked' }, label: 'Review tasks' },
    },
    {
      id: 'owners', section: 'prepare',
      title: 'Check every open task has an owner',
      doneWhen: 'No open task is without an assignee, or each missing owner has a clear assignment plan.',
      count: taskCounts.no_owner, unit: 'without an owner', unknown: notReady,
      go: { page: 'tasks', params: { tq: 'unassigned' }, label: 'Review unassigned tasks' },
    },
    {
      id: 'decide', section: 'prepare',
      title: 'Review requests and ideas needing a decision',
      doneWhen: 'Requests waiting for your decision and ideas waiting for review have a decision or next step.',
      count: decisions, unit: 'waiting on you', unknown: notReady,
      go: { page: 'operations', label: 'Open Operations' },
    },
    {
      id: 'website_qa', section: 'prepare',
      title: 'QA priority business websites',
      doneWhen: 'You have checked the priority websites below and recorded any defects for follow-up.',
      count: null, unit: '',
      go: { page: 'qa', label: 'Open QA Center' },
    },
    {
      id: 'capture_new', section: 'prepare',
      title: 'Capture new instructions, issues and ideas',
      doneWhen: 'Unplanned instructions, unusual observations and feature ideas have been captured using the bottom Capture button.',
      count: null, unit: '',
      go: { page: 'operations', label: 'Open Operations' },
    },
    {
      id: 'process_capture', section: 'prepare',
      title: 'Process your captured items',
      doneWhen: 'Personal follow-ups are in Action List; team work has been turned into tasks with owners; QA defects are recorded for testing.',
      count: null, unit: '',
      go: { page: 'operations', label: 'Review Operations' },
    },
    {
      id: 'priorities', section: 'prepare',
      title: 'Prepare today’s top 3 priorities',
      doneWhen: 'Three clear outcomes are written below and ready to share with the team.',
      count: null, unit: '',
      go: { page: 'today', label: 'Open Command Center' },
    },
    {
      id: 'meeting', section: 'coordinate',
      title: 'Conduct the 15-minute daily team meeting',
      doneWhen: 'Priorities, urgent work, QA findings, owners and expected dates have been discussed and recorded.',
      count: null, unit: '',
      go: { page: 'minutes', label: 'Open Meeting Minutes' },
    },
    {
      id: 'team_followup', section: 'coordinate',
      title: 'Follow up with team members',
      doneWhen: 'Every relevant follow-up below has been completed or has a named owner and agreed next action.',
      count: null, unit: '',
      go: { page: 'tasks', params: { tq: 'overdue' }, label: 'Open overdue tasks' },
    },
    {
      id: 'decisions', section: 'coordinate',
      title: 'Discuss new work, requirements and decisions',
      doneWhen: 'Important questions, feature requests, scope changes and decisions have a recorded outcome or next step.',
      count: null, unit: '',
      go: { page: 'operations', label: 'Open Operations' },
    },
    {
      id: 'retest', section: 'coordinate',
      title: 'Review QA fixes and retest important work',
      doneWhen: 'Ready fixes have been retested; failed or waiting fixes have a clear retest owner and next step.',
      count: awaitingQa + failedQa, unit: `${awaitingQa} awaiting · ${failedQa} failed`,
      unknown: qa === null && !qaError,
      go: { page: 'qa', label: 'Open QA Center' },
    },
    {
      id: 'capacity', section: 'coordinate',
      title: 'Check team workload and rebalance if needed',
      doneWhen: 'Overloaded team members have been identified and work has been rebalanced or discussed.',
      count: overloaded, unit: 'over capacity', unknown: notReady,
      go: { page: 'today', label: 'Open workload' },
    },
    {
      id: 'meeting_actions', section: 'coordinate',
      title: 'Confirm meeting actions are moving',
      doneWhen: 'Actions from the latest meeting have owners, expected dates and a clear next step.',
      count: followups, unit: 'meeting follow-ups need attention', unknown: notReady,
      go: { page: 'minutes', label: 'Review meeting actions' },
    },
    {
      id: 'update_tasks', section: 'close',
      title: 'Update task statuses and personal Action List',
      doneWhen: 'Task progress and dates are current; personal follow-ups are marked Open, Waiting or Done as appropriate.',
      count: null, unit: '',
      go: { page: 'tasks', label: 'Open tasks' },
    },
    {
      id: 'report', section: 'close',
      title: 'Review and prepare the daily operations update',
      doneWhen: 'Completed work, overdue items, blockers, QA issues and escalations are summarised.',
      count: null, unit: '',
      go: { page: 'reports', label: 'Open Reports' },
    },
    {
      id: 'tomorrow', section: 'close',
      title: 'Prepare the next working day',
      doneWhen: 'Tomorrow’s priorities, outstanding follow-ups and questions for the team are recorded.',
      count: null, unit: '',
      go: { page: 'today', label: 'Open Command Center' },
    },
    ...(new Date().getDay() === 5 ? ([
      { id: 'fri_ideas', section: 'close', title: 'Friday: review ideas', doneWhen: 'Ideas for review have a decision or next step.', count: null, unit: '', go: { page: 'operations', label: 'Open Operations' } },
      { id: 'fri_balance', section: 'close', title: 'Friday: review next week’s capacity', doneWhen: 'Next week’s workload is balanced.', count: null, unit: '', go: { page: 'today', label: 'Open workload' } },
      { id: 'fri_health', section: 'close', title: 'Friday: review project health', doneWhen: 'Project risks and progress have been reviewed.', count: null, unit: '', go: { page: 'projects', label: 'Open Projects' } },
    ] satisfies Step[]) : []),
  ];

  const websiteIds = ['techmandu', 'adxps', 'adevents', 'adtax', 'adremit'];
  const followupIds = ['overdue', 'blocked', 'unassigned', 'in_progress', 'qa_retest'];
  const websiteQaDone = websiteIds.every((id) => websiteQa[id]);
  const teamFollowupsDone = followupIds.every((id) => teamFollowups[id]);

  const isDone = (s: Step) => {
    if (s.id === 'website_qa') return websiteQaDone;
    if (s.id === 'team_followup') return teamFollowupsDone;
    if (s.id === 'priorities') return Boolean(ticked[s.id]) && priorities.every((p) => p.trim());
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
              Work through the sections in order, but do not wait for a particular time. Prepare independently first, coordinate when the Nepal team is available, then close and prepare the next day.
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
          const previous = steps[i - 1];
          const sectionTitle = s.section === 'prepare' ? '1. Prepare and inspect' : s.section === 'coordinate' ? '2. Coordinate and follow up' : '3. Close and prepare';
          const sectionDescription = s.section === 'prepare' ? 'Complete the work you can do independently before the Nepal team is online.' : s.section === 'coordinate' ? 'Use your overlap with the Nepal team for meetings, decisions, follow-ups and retesting.' : 'Update records, report outcomes and prepare the next working day.';
          const auto = !fresh && !s.unknown && s.count === 0;
          return (
            <React.Fragment key={s.id}>
            {(!previous || previous.section !== s.section) && (
              <li className="list-none rounded-xl bg-slate-100 px-4 py-3">
                <h3 className="text-sm font-bold text-slate-900">{sectionTitle}</h3>
                <p className="mt-0.5 text-xs text-slate-600">{sectionDescription}</p>
              </li>
            )}
            <li className={`rounded-xl border bg-white p-4 ${finished ? 'border-emerald-200 bg-emerald-50/40' : s === next ? 'border-indigo-300' : 'border-slate-200'}`}>
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
              {s.id === 'website_qa' && (
                <div className="mt-3 grid grid-cols-1 gap-2 pl-11 sm:grid-cols-2">
                  {[
                    ['techmandu', 'Techmandu'], ['adxps', 'ADXPS'], ['adevents', 'ADEvents'], ['adtax', 'ADTax'], ['adremit', 'ADRemit'],
                  ].map(([id, label]) => (
                    <label key={id} className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700">
                      <input type="checkbox" checked={Boolean(websiteQa[id])} onChange={(e) => setWebsiteQa((current) => ({ ...current, [id]: e.target.checked }))} className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" />
                      QA checked: {label}
                    </label>
                  ))}
                </div>
              )}
              {s.id === 'team_followup' && (
                <div className="mt-3 space-y-2 pl-11">
                  {[
                    ['overdue', 'Overdue tasks — contact owners and confirm progress and a realistic date.'],
                    ['blocked', 'Blocked tasks — identify the blocker, responsible person and next action.'],
                    ['unassigned', 'Unassigned tasks — confirm who will take responsibility.'],
                    ['in_progress', 'Important in-progress or not-started work — check progress and expectations.'],
                    ['qa_retest', 'QA fixes and retests — confirm what is ready to verify and who owns it.'],
                  ].map(([id, label]) => (
                    <label key={id} className="flex cursor-pointer items-start gap-2 text-sm text-slate-700">
                      <input type="checkbox" checked={Boolean(teamFollowups[id])} onChange={(e) => setTeamFollowups((current) => ({ ...current, [id]: e.target.checked }))} className="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
              )}
              {s.id === 'capture_new' && <p className="mt-2 pl-11 text-xs text-slate-500">Use the bottom <b>Capture</b> button. Choose Action for something you must personally follow up; choose Rough note for an observation or idea.</p>}
              {s.id === 'process_capture' && <p className="mt-2 pl-11 text-xs text-slate-500">Open Action List to review your personal reminders. Create or update team Tasks for work that needs an owner; record website defects in QA.</p>}
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
            </React.Fragment>
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
