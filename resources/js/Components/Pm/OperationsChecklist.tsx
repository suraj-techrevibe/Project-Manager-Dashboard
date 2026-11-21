import type { OperationsTodaySummary } from '../../types/pm';

export interface ChecklistCounts {
  overdue: number;
  blocked: number;
  due_soon: number; // due today + next 3 days
  no_owner: number;
  to_verify: number; // finished tasks nobody has checked
  incomplete_subtasks: number; // parent marked done, subtasks still open
  stuck: number;
  followups_open: number; // latest meeting's work items that still need action
}

interface Props {
  summary: OperationsTodaySummary;
  counts: ChecklistCounts;
  riskProject: { id: string; name: string } | null;
  overloadedCount: number;
  syncing: boolean;
  onSync: () => void;
  /** Same navigation the sidebar uses: page key plus optional query. */
  go: (page: string, params?: Record<string, string>) => void;
  onOpenProject: (projectId: string) => void;
  onShowWorkload: () => void;
}

type Tone = 'rose' | 'amber' | 'indigo' | 'sky' | 'violet' | 'teal' | 'slate';

interface Item {
  key: string;
  title: string;
  why: string;
  count: number;
  clearText: string;
  link: string; // label of the link, shown on every row so any item is one click away
  onClick: () => void;
  tone: Tone;
  /** Show this word instead of the count (e.g. "Review"). */
  badge?: string;
}

interface Group {
  title: string;
  sub: string;
  items: Item[];
}

const TONE: Record<Tone, { badge: string; btn: string }> = {
  rose: { badge: 'bg-rose-100 text-rose-700', btn: 'bg-rose-600 text-white hover:bg-rose-700' },
  amber: { badge: 'bg-amber-100 text-amber-700', btn: 'bg-amber-600 text-white hover:bg-amber-700' },
  indigo: { badge: 'bg-indigo-100 text-indigo-700', btn: 'bg-indigo-600 text-white hover:bg-indigo-700' },
  sky: { badge: 'bg-sky-100 text-sky-700', btn: 'bg-sky-600 text-white hover:bg-sky-700' },
  violet: { badge: 'bg-violet-100 text-violet-700', btn: 'bg-violet-600 text-white hover:bg-violet-700' },
  teal: { badge: 'bg-teal-100 text-teal-700', btn: 'bg-teal-600 text-white hover:bg-teal-700' },
  slate: { badge: 'bg-slate-100 text-slate-700', btn: 'bg-slate-800 text-white hover:bg-slate-900' },
};

const STALE_AFTER_MS = 30 * 60 * 1000;

export default function OperationsChecklist({ summary, counts, riskProject, overloadedCount, syncing, onSync, go, onOpenProject, onShowWorkload }: Props) {
  const { counts: ops, qa, meetings, sync } = summary;

  const syncProblem = sync.error?.message
    ?? sync.warning?.message
    ?? (!sync.configured ? 'Taskmandu is not configured.' : null)
    ?? (!sync.last_synced_at ? 'Taskmandu has never synced.' : Date.now() - new Date(sync.last_synced_at).getTime() > STALE_AFTER_MS ? 'Taskmandu data is more than 30 minutes old.' : null);

  const tasks = (tq: string) => () => go('tasks', { tq });

  const groups: Group[] = [
    {
      title: 'Requests and ideas',
      sub: 'Incoming work waiting on a decision from you.',
      items: [
        { key: 'decide', title: 'Decide on requests in review', why: 'Requesters are waiting on you.', count: ops.requests_for_decision, clearText: 'No requests are waiting for a decision.', link: 'Open requests', onClick: () => go('operations'), tone: 'amber' },
        { key: 'overdue-requests', title: 'Clear overdue requests', why: 'Past the date the requester asked for.', count: ops.overdue_requests, clearText: 'No request is past its requested date.', link: 'Open requests', onClick: () => go('operations'), tone: 'rose' },
        { key: 'ideas', title: 'Review new ideas', why: 'Accept, defer or reject so the backlog stays honest.', count: ops.ideas_for_review, clearText: 'No ideas are waiting for review.', link: 'Open ideas', onClick: () => go('operations'), tone: 'indigo' },
      ],
    },
    {
      title: 'Delivery',
      sub: 'Task health across all Taskmandu work.',
      items: [
        { key: 'overdue-tasks', title: 'Clear overdue tasks', why: 'Past their due date and not completed.', count: counts.overdue, clearText: 'No task is overdue.', link: 'Overdue tasks', onClick: tasks('overdue'), tone: 'rose' },
        { key: 'blocked', title: 'Unblock blocked tasks', why: 'Someone is waiting on a decision.', count: counts.blocked, clearText: 'Nothing is blocked.', link: 'Blocked tasks', onClick: tasks('blocked'), tone: 'amber' },
        { key: 'due-soon', title: 'Check what is due in the next 3 days', why: 'Catch slips before they become overdue.', count: counts.due_soon, clearText: 'No near-term due dates.', link: 'Due this week', onClick: tasks('week'), tone: 'sky' },
        { key: 'no-owner', title: 'Give every task an owner', why: 'No owner means nobody is working on it.', count: counts.no_owner, clearText: 'Everything has an owner.', link: 'Unassigned tasks', onClick: tasks('unassigned'), tone: 'violet' },
        { key: 'verify', title: 'Verify completed tasks', why: 'Done is not delivered until it has been checked.', count: counts.to_verify + counts.incomplete_subtasks, clearText: 'Nothing is waiting for verification.', link: 'Completed tasks', onClick: tasks('done'), tone: 'teal' },
        { key: 'stuck', title: 'Move work that has stopped', why: 'No movement in 3+ days.', count: counts.stuck, clearText: 'No task is stalled.', link: 'Open tasks', onClick: tasks('open'), tone: 'amber' },
      ],
    },
    {
      title: 'Meetings and QA',
      sub: 'Follow-ups from meetings and the quality queue.',
      items: [
        { key: 'followups', title: 'Chase meeting follow-ups', why: 'Work items from the latest meeting that still need action.', count: counts.followups_open, clearText: 'The latest meeting is fully followed up.', link: 'Meeting minutes', onClick: () => go('minutes'), tone: 'indigo' },
        { key: 'draft-minutes', title: 'Finalise draft meeting minutes', why: 'Minutes stay as drafts until you finalise them.', count: meetings.draft_minutes, clearText: 'No draft minutes.', link: 'Meeting minutes', onClick: () => go('minutes'), tone: 'slate' },
        { key: 'qa-urgent', title: 'Resolve Critical and High QA issues', why: 'Open issues that block release quality.', count: qa.urgent, clearText: 'No urgent QA issues open.', link: 'QA tracking', onClick: () => go('qa'), tone: 'rose' },
        { key: 'qa-retest', title: 'Retest fixed QA issues', why: 'Developers say they are fixed. Confirm it.', count: qa.ready_for_retest, clearText: 'Nothing is waiting for retest.', link: 'Retest queue', onClick: () => go('qa'), tone: 'teal' },
        { key: 'qa-failed', title: 'Follow up failed retests', why: 'Fix did not hold.', count: qa.failed, clearText: 'No failed retests.', link: 'QA tracking', onClick: () => go('qa'), tone: 'amber' },
      ],
    },
    {
      title: 'Projects and capacity',
      sub: 'Where delivery risk and team load sit.',
      items: [
        { key: 'riskiest', title: 'Review the riskiest project', why: riskProject ? `${riskProject.name} has the most warning signals.` : 'Most warning signals sit here.', count: riskProject ? 1 : 0, badge: 'Review', clearText: 'No project is showing warning signals.', link: riskProject ? 'Open project' : 'All projects', onClick: () => (riskProject ? onOpenProject(riskProject.id) : go('projects')), tone: 'slate' },
        { key: 'capacity', title: 'Rebalance overloaded people', why: 'Overloaded people cause the next round of delays.', count: overloadedCount, clearText: 'Nobody is over weekly capacity.', link: 'Team capacity', onClick: onShowWorkload, tone: 'amber' },
      ],
    },
  ];

  let n = 0;

  return (
    <section aria-label="Operations checklist" className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-5">
      <div className="mb-4">
        <h3 className="text-sm font-semibold tracking-tight text-slate-900 sm:text-base">Operations checklist</h3>
        <p className="mt-0.5 text-sm text-slate-500">Work it from 1 down. Every row links to where you can act on it, and clears itself when there is nothing left.</p>
      </div>

      {syncProblem && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 p-3.5">
          <div className="min-w-0 flex-1 basis-64">
            <div className="text-sm font-semibold text-rose-800">Task numbers below may be out of date</div>
            <div className="mt-0.5 break-words text-xs text-rose-700">{syncProblem.length > 220 ? `${syncProblem.slice(0, 220)}…` : syncProblem}</div>
          </div>
          <button type="button" onClick={onSync} disabled={syncing} className="shrink-0 rounded-lg bg-rose-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-60">
            {syncing ? 'Syncing…' : 'Sync now'}
          </button>
        </div>
      )}

      <div className="space-y-5">
        {groups.map((group) => (
          <div key={group.title}>
            <div className="mb-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{group.title}</h4>
              <p className="text-xs text-slate-400">{group.sub}</p>
            </div>
            <ol className="space-y-2">
              {group.items.map((item) => {
                n += 1;
                const clear = item.count === 0;
                const t = TONE[item.tone];
                return (
                  <li key={item.key} className={`flex flex-wrap items-center gap-4 rounded-xl border p-3 ${clear ? 'border-slate-100 bg-slate-50/60' : 'border-slate-200 bg-white'}`}>
                    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold ${clear ? 'bg-emerald-100 text-emerald-600' : t.badge}`}>{clear ? '✓' : n}</div>
                    <div className="min-w-0 flex-1 basis-64">
                      <div className="flex flex-wrap items-center gap-2">
                        <button type="button" onClick={item.onClick} className={`text-left text-sm font-semibold hover:underline ${clear ? 'text-slate-500' : 'text-slate-900'}`}>{item.title}</button>
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${clear ? 'bg-emerald-100 text-emerald-700' : t.badge}`}>{clear ? 'All clear' : item.badge ?? item.count}</span>
                      </div>
                      <div className="mt-0.5 text-sm text-slate-500">{clear ? item.clearText : item.why}</div>
                    </div>
                    <button
                      type="button"
                      onClick={item.onClick}
                      className={`shrink-0 rounded-lg px-3.5 py-1.5 text-xs font-semibold ${clear ? 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50' : t.btn}`}
                    >
                      {item.link} →
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>
        ))}
      </div>
    </section>
  );
}
