import { useMemo, useState } from 'react';
import type { TaskFocus } from '../../types/pm';
import { Pill, btnChip, btnSecondary, type Tone } from './ui/kit';

export interface AllTask {
  card_id: number;
  title: string;
  assignee: string | null;
  url: string | null;
  project_id: string | null;
  project_name: string | null;
  task_id: string | null;
  status: string;
  priority: string | null;
  due_at: string | null;
  estimated_hours: number | null;
  tags: string[];
  subtasks_count: number;
  comments_count: number;
  assigned_by: string | null;
  last_activity_at: string | null;
  last_nudged_at: string | null;
  description: string | null;
}

const isOpen = (t: AllTask) => t.status !== 'Completed' && t.status !== 'Cancelled';
const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
const dueTime = (t: AllTask) => (t.due_at ? new Date(`${t.due_at}T00:00:00`).getTime() : null);

type QuickKey = 'all' | 'open' | 'overdue' | 'week' | 'unassigned' | 'blocked' | 'done';
const QUICK: { key: QuickKey; label: string; test: (t: AllTask, today: number) => boolean }[] = [
  { key: 'all', label: 'All', test: () => true },
  { key: 'open', label: 'Open', test: (t) => isOpen(t) },
  { key: 'overdue', label: 'Overdue', test: (t, today) => isOpen(t) && (dueTime(t) ?? Infinity) < today },
  { key: 'week', label: 'Due this week', test: (t, today) => isOpen(t) && dueTime(t) !== null && dueTime(t)! >= today && dueTime(t)! < today + 7 * 86_400_000 },
  { key: 'unassigned', label: 'No owner', test: (t) => isOpen(t) && !(t.assignee ?? '').trim() },
  { key: 'blocked', label: 'Blocked', test: (t) => isOpen(t) && t.status.toLowerCase().includes('block') },
  { key: 'done', label: 'Completed', test: (t) => t.status === 'Completed' },
];

function statusTone(status: string): Tone {
  const s = status.toLowerCase();
  if (s === 'completed') return 'ok';
  if (s.includes('block')) return 'danger';
  if (s.includes('progress')) return 'brand';
  if (s.includes('review') || s.includes('test')) return 'warn';
  return 'neutral';
}

function priorityTone(p: string): Tone {
  const s = p.toLowerCase();
  return s === 'urgent' || s === 'high' ? 'danger' : s === 'medium' ? 'warn' : 'neutral';
}

function dueInfo(t: AllTask, today: number): { text: string; late: boolean } {
  const d = dueTime(t);
  if (d === null) return { text: 'No due date', late: false };
  const pretty = new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  return { text: pretty, late: isOpen(t) && d < today };
}

const PAGE = 40;
const field = 'rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm text-slate-700 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500';

export default function AllTasksPanel({
  tasks,
  onOpenTask,
  onBack,
  initialQuick = 'open',
}: {
  tasks: AllTask[];
  onOpenTask: (focus: TaskFocus) => void;
  /** When given, shows a "Back to Today" button (used by the inline list on Command center). */
  onBack?: () => void;
  initialQuick?: QuickKey;
}) {
  const [search, setSearch] = useState('');
  const [project, setProject] = useState('');
  const [assignee, setAssignee] = useState('');
  const [status, setStatus] = useState('');
  const [quick, setQuick] = useState<QuickKey>(onBack ? 'all' : initialQuick);
  const [limit, setLimit] = useState(PAGE);
  const today = startOfToday();

  const projects = useMemo(() => Array.from(new Set(tasks.map((t) => t.project_name).filter((x): x is string => Boolean(x)))).sort(), [tasks]);
  const assignees = useMemo(
    () => Array.from(new Set(tasks.flatMap((t) => (t.assignee ?? '').split(',').map((x) => x.trim()).filter(Boolean)))).sort(),
    [tasks]
  );
  const statuses = useMemo(() => Array.from(new Set(tasks.map((t) => t.status).filter(Boolean))).sort(), [tasks]);

  const counts = useMemo(() => Object.fromEntries(QUICK.map((q) => [q.key, tasks.filter((t) => q.test(t, today)).length])) as Record<QuickKey, number>, [tasks, today]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const test = QUICK.find((x) => x.key === quick)!.test;
    return tasks.filter((t) => {
      if (!test(t, today)) return false;
      if (project && t.project_name !== project) return false;
      if (assignee && !(t.assignee ?? '').split(',').map((x) => x.trim()).includes(assignee)) return false;
      if (status && t.status !== status) return false;
      if (!q) return true;
      return [t.title, t.description, t.project_name, t.assignee, t.status, t.priority, ...t.tags].filter(Boolean).some((v) => String(v).toLowerCase().includes(q));
    });
  }, [tasks, search, project, assignee, status, quick, today]);

  const reset = () => setLimit(PAGE);

  return (
    <section className="rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-base font-semibold tracking-tight text-slate-900">All tasks</h3>
          <p className="text-xs text-slate-500">Every task on the synced board — flagged and unflagged.</p>
        </div>
        {onBack && (
          <button onClick={onBack} className={btnSecondary}>
            Back to Today
          </button>
        )}
      </div>

      <div className="flex gap-1.5 overflow-x-auto border-b border-slate-100 px-4 py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {QUICK.map((q) => (
          <button
            key={q.key}
            type="button"
            aria-pressed={quick === q.key}
            onClick={() => {
              setQuick(q.key);
              reset();
            }}
            className={`${btnChip(quick === q.key)} shrink-0`}
          >
            {q.label} <span className="ml-1 tabular-nums opacity-70">{counts[q.key]}</span>
          </button>
        ))}
      </div>

      <div className="grid gap-2 border-b border-slate-100 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            reset();
          }}
          placeholder="Search tasks…"
          className={`${field} sm:col-span-2 lg:col-span-1`}
        />
        <select value={project} onChange={(e) => { setProject(e.target.value); reset(); }} className={field}>
          <option value="">All projects</option>
          {projects.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
        <select value={assignee} onChange={(e) => { setAssignee(e.target.value); reset(); }} className={field}>
          <option value="">All assignees</option>
          {assignees.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
        <select value={status} onChange={(e) => { setStatus(e.target.value); reset(); }} className={field}>
          <option value="">All statuses</option>
          {statuses.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
      </div>

      <div className="px-4 py-2 text-xs text-slate-500">
        Showing {Math.min(limit, visible.length)} of {visible.length} matching · {tasks.length} total
      </div>

      {visible.length === 0 ? (
        <p className="p-8 text-center text-sm text-slate-500">No tasks match those filters.</p>
      ) : (
        <>
          {/* Column labels (desktop only) */}
          <div className="hidden grid-cols-[minmax(0,1fr)_9rem_8rem_8rem] gap-4 border-y border-slate-100 bg-slate-50 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 md:grid">
            <span>Task</span>
            <span>Assignee</span>
            <span>Status</span>
            <span>Due</span>
          </div>
          <ul className="divide-y divide-slate-100">
            {visible.slice(0, limit).map((t) => {
              const canOpen = Boolean((t.project_id && t.task_id) || t.url);
              const due = dueInfo(t, today);
              return (
                <li key={t.card_id}>
                  <button
                    type="button"
                    disabled={!canOpen}
                    onClick={() => {
                      if (t.project_id && t.task_id) onOpenTask({ projectId: t.project_id, taskId: t.task_id });
                      else if (t.url) window.open(t.url, '_blank', 'noopener');
                    }}
                    className={`flex w-full flex-col gap-2 px-4 py-3 text-left md:grid md:grid-cols-[minmax(0,1fr)_9rem_8rem_8rem] md:items-center md:gap-4 ${canOpen ? 'hover:bg-slate-50' : 'cursor-default'}`}
                  >
                    <div className="min-w-0">
                      <div className="break-words text-sm font-medium text-slate-900">{t.title}</div>
                      <div className="mt-0.5 truncate text-xs text-slate-500">{t.project_name ?? 'Standalone task'}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400">
                        {t.priority && <Pill tone={priorityTone(t.priority)}>{t.priority}</Pill>}
                        <span>{t.subtasks_count} subtasks</span>
                        <span>{t.comments_count} comments</span>
                        {t.estimated_hours ? <span>{t.estimated_hours}h</span> : null}
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-2 text-xs md:block">
                      <span className="text-slate-400 md:hidden">Assignee</span>
                      <span className={`truncate ${t.assignee ? 'text-slate-700' : 'font-medium text-amber-700'}`}>{t.assignee ?? 'Unassigned'}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2 md:block">
                      <span className="text-xs text-slate-400 md:hidden">Status</span>
                      <Pill tone={statusTone(t.status)}>{t.status}</Pill>
                    </div>
                    <div className="flex items-center justify-between gap-2 text-xs md:block">
                      <span className="text-slate-400 md:hidden">Due</span>
                      <span className={due.late ? 'font-semibold text-red-600' : 'text-slate-600'}>{due.late ? `Overdue · ${due.text}` : due.text}</span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
          {visible.length > limit && (
            <div className="flex justify-center border-t border-slate-100 p-4">
              <button type="button" onClick={() => setLimit((l) => l + PAGE)} className={btnSecondary}>
                Show more ({visible.length - limit} left)
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
