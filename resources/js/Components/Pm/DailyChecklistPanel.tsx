import axios from 'axios';
import { useEffect, useMemo, useState } from 'react';
import type { PmPage } from '@/lib/pmNav';
import type { TodayData } from '@/types/pm';

type Params = Record<string, string | null | undefined>;
type Item = {
  id: string;
  section: string;
  title: string;
  detail: string;
  destination: PmPage;
  params?: Params;
  action: string;
  when?: string;
};
type QaReview = { qa_status: string; task_status: string };

const ITEMS: Item[] = [
  { id: 'dashboard', section: '1 · System and data', title: 'Confirm Dashboard-2 is loading correctly', detail: 'The Command Center data and project/task information should load without a database or server error.', destination: 'today', action: 'Open Command Center' },
  { id: 'sync', section: '1 · System and data', title: 'Confirm Taskmandu sync is recent and healthy', detail: 'Check the last sync time and any sync warning/error. Sync is scheduled every five minutes. If authentication or ECIRCUITBREAKER appears, stop retrying Sync and investigate the connection first.', destination: 'today', action: 'Check sync status' },
  { id: 'intake', section: '2 · Incoming work and decisions', title: 'Capture every new request or idea', detail: 'Record boss, client, team and your own requests in Operations. Select the correct business/project, source, priority and requested due date. Do not leave requests only in chat.', destination: 'operations', action: 'Open Requests & Ideas' },
  { id: 'decisions', section: '2 · Incoming work and decisions', title: 'Clear requests and ideas waiting for your decision', detail: 'Review clarification needed, in-review, captured and under-review items. Approve, reject, defer or ask for clarification, and record why.', destination: 'operations', action: 'Review decisions' },
  { id: 'deadlines', section: '3 · Delivery and task control', title: 'Review overdue and near-term deadlines', detail: 'Open overdue tasks first, then review tasks due today and within the next seven days. Confirm the owner and realistic delivery date.', destination: 'tasks', params: { tq: 'overdue' }, action: 'Open overdue tasks' },
  { id: 'blocked', section: '3 · Delivery and task control', title: 'Resolve or assign owners to blocked work', detail: 'Identify what is blocked, why, who must unblock it and the next action. Also check tasks with no movement for three or more days in Command Center.', destination: 'tasks', params: { tq: 'blocked' }, action: 'Open blocked tasks' },
  { id: 'ownership', section: '3 · Delivery and task control', title: 'Check unassigned tasks and unfinished subtasks', detail: 'Every active item should have a clear owner. Check incomplete subtasks even when the parent task is marked Completed.', destination: 'tasks', params: { tq: 'unassigned' }, action: 'Open unassigned tasks' },
  { id: 'qa-inbox', section: '4 · Quality assurance', title: 'Process every task awaiting QA', detail: 'Open each task submitted as Completed or Review. Test the actual website/app against the requirement, not just the developer’s message.', destination: 'qa', action: 'Open QA Inbox' },
  { id: 'qa-result', section: '4 · Quality assurance', title: 'Record QA results, notes and evidence', detail: 'Record Pass or Fail, clear reproduction notes, severity for failures and a screenshot/recording URL where useful. QA Pass/Fail does not change Taskmandu status.', destination: 'qa', action: 'Record QA results' },
  { id: 'retest', section: '4 · Quality assurance', title: 'Follow up failed fixes and retests', detail: 'For failed work, move the Taskmandu task back to In Progress yourself. When it is submitted again as Completed or Review, verify the new QA cycle.', destination: 'qa', action: 'Review failed / retest items' },
  { id: 'capacity', section: '5 · Team and meeting coordination', title: 'Review developer workload across all businesses', detail: 'Check open tasks, estimated hours, weekly capacity, overdue and blocked work. Notice overloaded developers and people with room. Treat missing hour estimates as unknown, not free capacity.', destination: 'today', action: 'Open workload overview' },
  { id: 'updates', section: '5 · Team and meeting coordination', title: 'Check progress updates and unexpected interruptions', detail: 'Identify work started outside the board, urgent bugs added by the boss, tasks with no recent update and anything the Senior Dev needs to unblock.', destination: 'today', action: 'Review daily monitoring' },
  { id: 'minutes', section: '5 · Team and meeting coordination', title: 'Review meeting follow-ups and carry-over actions', detail: 'Check previous meeting commitments. Make sure every action has an owner, project and due date, and is still moving.', destination: 'minutes', action: 'Open Meeting Minutes' },
  { id: 'tickets', section: '5 · Team and meeting coordination', title: 'Record today’s meeting decisions as trackable work', detail: 'Create or update meeting minutes. Use Work Items and action items; review owners and project links before pushing tickets to Taskmandu.', destination: 'minutes', action: 'Create / update minutes' },
  { id: 'priorities', section: '6 · Plan and communicate', title: 'Choose no more than three company-wide priorities', detail: 'Rank the most important outcomes across all businesses. For each, name one accountable owner, expected delivery and what “done” means.', destination: 'tasks', action: 'Review tasks and owners' },
  { id: 'alignment', section: '6 · Plan and communicate', title: 'Align priorities with the boss and Senior Dev', detail: 'Confirm new urgent requests versus planned work, agree what gets delayed when something urgent is added, and record the decision in the PM app.', destination: 'reports', action: 'Open Reports' },
  { id: 'scope', section: '7 · Only when relevant', title: 'Check new client requests against agreed scope', detail: 'When a client asks for extra work, compare it with the original brief before promising delivery or assigning development.', destination: 'scope', action: 'Open Scope Check', when: 'Only if a new client change/request arrived' },
  { id: 'release', section: '7 · Only when relevant', title: 'Check project delivery and Git/PR signals', detail: 'For projects due to release or merge today, review project health, open pull requests and failing/pending checks. This Git view reflects the dashboard host repository configuration.', destination: 'git', action: 'Open Git', when: 'Only on release, deployment or merge days' },
];

function localDateKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function formatSync(value?: string | null) {
  if (!value) return 'No successful sync time recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Sync time unavailable' : date.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function DailyChecklistPanel({
  today, loading, error, onRetry, onNavigate,
}: {
  today: TodayData | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onNavigate: (page: PmPage, params?: Params) => void;
}) {
  const dateKey = useMemo(localDateKey, []);
  const storageKey = `pm-daily-checklist:v2:${dateKey}`;
  const [checked, setChecked] = useState<Record<string, boolean>>(() => {
    if (typeof window === 'undefined') return {};
    try { return JSON.parse(window.localStorage.getItem(storageKey) || '{}'); } catch { return {}; }
  });
  const [qaReviews, setQaReviews] = useState<QaReview[] | null>(null);
  const [qaError, setQaError] = useState<string | null>(null);
  const [qaLoading, setQaLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const loadQa = async () => {
      try {
        const { data } = await axios.get('/pm/api/qa/task-inbox');
        if (active) { setQaReviews(data.reviews ?? []); setQaError(null); }
      } catch (e) {
        const message = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
        if (active) setQaError(message || 'QA Inbox data could not be loaded.');
      } finally { if (active) setQaLoading(false); }
    };
    void loadQa();
    const timer = window.setInterval(() => { void loadQa(); }, 60_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    try { window.localStorage.setItem(storageKey, JSON.stringify(checked)); } catch { /* The checklist remains usable for this browser session. */ }
  }, [checked, storageKey]);

  const done = ITEMS.filter((item) => checked[item.id]).length;
  const total = ITEMS.length;
  const percent = Math.round((done / total) * 100);
  const requiredItems = ITEMS.filter((item) => !item.when);
  const requiredDone = requiredItems.filter((item) => checked[item.id]).length;
  const sync = today?.operations_summary?.sync;
  const syncAt = sync?.last_synced_at ?? today?.lastSyncedAt ?? null;
  const syncAge = syncAt ? Date.now() - new Date(syncAt).getTime() : null;
  const syncFresh = Boolean(sync?.configured && syncAt && syncAge !== null && syncAge <= 15 * 60_000 && !sync?.error && !sync?.warning && !error && !qaError && !qaLoading);
  const awaitingQa = qaReviews?.filter((r) => r.qa_status === 'Awaiting QA' && ['Completed', 'Review'].includes(r.task_status)).length ?? null;
  const failedQa = qaReviews?.filter((r) => r.qa_status === 'Failed').length ?? null;
  const overloaded = today?.workload.filter((w) => (w.week_hours ?? 0) > (w.capacity ?? 40)).length ?? null;
  const sections = [...new Set(ITEMS.map((item) => item.section))];

  const toggle = (id: string) => setChecked((current) => ({ ...current, [id]: !current[id] }));
  const reset = () => setChecked({});
  const statusLabel = error ? 'Dashboard data unavailable' : loading || qaLoading ? 'Checking live systems…' : qaError ? 'QA data unavailable' : !today ? 'Live overview not loaded' : syncFresh ? 'Taskmandu sync and QA healthy' : 'System needs attention';
  const statusTone = error || (!loading && today && !syncFresh) ? 'border-amber-200 bg-amber-50 text-amber-800' : syncFresh ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-slate-50 text-slate-600';

  return (
    <div className="space-y-5">
      <header className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-indigo-600">Company operations · daily control</p>
            <h2 className="mt-1 text-xl font-bold text-slate-900">Your complete daily PM checklist</h2>
            <p className="mt-1 max-w-3xl text-sm text-slate-500">Work through this page from top to bottom. Each link opens the relevant dashboard area; tick an item only after you have checked or completed it.</p>
          </div>
          <span className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${statusTone}`}>{statusLabel}</span>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
          <div className="rounded-lg bg-slate-50 p-3"><div className="text-[11px] font-medium uppercase text-slate-500">Tasks overdue</div><div className="mt-1 text-xl font-semibold tabular-nums">{today?.metrics.overdue ?? '—'}</div><button onClick={() => onNavigate('tasks', { tq: 'overdue' })} className="mt-1 text-xs font-semibold text-indigo-600">Open overdue →</button></div>
          <div className="rounded-lg bg-slate-50 p-3"><div className="text-[11px] font-medium uppercase text-slate-500">Blocked tasks</div><div className="mt-1 text-xl font-semibold tabular-nums">{today?.metrics.blocked ?? '—'}</div><button onClick={() => onNavigate('tasks', { tq: 'blocked' })} className="mt-1 text-xs font-semibold text-indigo-600">Open blocked →</button></div>
          <div className="rounded-lg bg-slate-50 p-3"><div className="text-[11px] font-medium uppercase text-slate-500">Awaiting QA</div><div className="mt-1 text-xl font-semibold tabular-nums">{qaLoading ? '…' : qaReviews ? awaitingQa : '—'}</div><button onClick={() => onNavigate('qa')} className="mt-1 text-xs font-semibold text-indigo-600">Open QA Inbox →</button></div>
          <div className="rounded-lg bg-slate-50 p-3"><div className="text-[11px] font-medium uppercase text-slate-500">Failed / retest QA</div><div className="mt-1 text-xl font-semibold tabular-nums">{qaLoading ? '…' : qaReviews ? failedQa : '—'}</div><button onClick={() => onNavigate('qa')} className="mt-1 text-xs font-semibold text-indigo-600">Review failures →</button></div>
          <div className="rounded-lg bg-slate-50 p-3"><div className="text-[11px] font-medium uppercase text-slate-500">Developers over capacity</div><div className="mt-1 text-xl font-semibold tabular-nums">{overloaded ?? '—'}</div><button onClick={() => onNavigate('today')} className="mt-1 text-xs font-semibold text-indigo-600">Open workload →</button></div>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 px-3 py-2">
          <div className="min-w-0"><div className="text-xs font-medium text-slate-700">Taskmandu last sync: {formatSync(syncAt)}</div>{sync?.error && <div className="mt-1 text-xs text-rose-700">Sync error: {sync.error.message}</div>}{sync?.warning && <div className="mt-1 text-xs text-amber-700">Sync warning: {sync.warning.message}</div>}{error && <div className="mt-1 text-xs text-rose-700">{error} Do not repeatedly click Sync if this is a database authentication / ECIRCUITBREAKER error.</div>}</div>
          <button onClick={() => onNavigate('today')} className="shrink-0 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">Open system details →</button>
        </div>

        <div className="mt-5 flex items-end justify-between gap-3">
          <div><div className="text-2xl font-bold tabular-nums text-slate-900">{done}<span className="text-base font-medium text-slate-400"> / {total}</span></div><div className="text-xs text-slate-500">checklist items completed today · {requiredDone}/{requiredItems.length} daily checks</div></div>
          <div className="text-sm font-semibold tabular-nums text-slate-700">{percent}%</div>
        </div>
        <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full transition-all ${done === total ? 'bg-emerald-500' : 'bg-indigo-500'}`} style={{ width: `${percent}%` }} /></div>
        {done === total && <p className="mt-3 text-sm font-medium text-emerald-700">All checklist items are marked complete. The sync indicator above separately shows whether the system is healthy.</p>}
      </header>

      {error && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><b>Live dashboard data could not be verified.</b> {error} Do not keep retrying sync if you see a database authentication or ECIRCUITBREAKER error. <button onClick={onRetry} className="ml-1 font-semibold underline">Retry loading dashboard data</button></div>}
      {qaError && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">QA Inbox could not be checked: {qaError} <button onClick={() => onNavigate('qa')} className="font-semibold underline">Open QA Center</button></div>}

      {sections.map((section) => (
        <section key={section} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-100 px-4 py-3"><h3 className="text-sm font-semibold text-slate-800">{section}</h3></div>
          <div className="divide-y divide-slate-100">
            {ITEMS.filter((item) => item.section === section).map((item) => (
              <div key={item.id} className={`flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center ${checked[item.id] ? 'bg-emerald-50/40' : ''}`}>
                <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3">
                  <input type="checkbox" checked={!!checked[item.id]} onChange={() => toggle(item.id)} className="mt-1 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" />
                  <span className="min-w-0">
                    <span className={`block text-sm font-semibold ${checked[item.id] ? 'text-slate-500 line-through' : 'text-slate-900'}`}>{item.title}</span>
                    <span className="mt-1 block text-sm text-slate-500">{item.detail}</span>
                    {item.when && <span className="mt-1 block text-xs font-medium text-amber-700">{item.when}</span>}
                  </span>
                </label>
                <button type="button" onClick={() => onNavigate(item.destination, item.params)} className="ml-7 shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:border-indigo-300 hover:bg-indigo-50 sm:ml-0">{item.action} →</button>
              </div>
            ))}
          </div>
        </section>
      ))}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-xs text-slate-500">Checklist date: {new Date(dateKey + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'short', day: 'numeric' })}. Ticks are saved in this browser and reset on the next local calendar day. They are not shared across devices.</p>
        <button type="button" onClick={reset} disabled={!done} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">Reset today’s checks</button>
      </div>
    </div>
  );
}
