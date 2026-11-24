import { useEffect, useMemo, useState } from 'react';
import type { Employee, Project, ProjectTask } from '../../types/pm';
import TaskDetail from './Projects/TaskDetail';
import { NewTaskModal } from './Projects/TasksTab';
import { pmApi } from '../../lib/pmApi';
import { TASK_STATUSES } from '../../types/pm';
import { EmptyState, Pill, btnChip, btnSecondary, type Tone } from './ui/kit';
import { resolveEmployeeName, useEmployees } from './Projects/ui';

/** A task row from the synced board (Today data). Used for standalone tasks that live outside any project. */
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

export interface SubRow {
  id: string;
  title: string;
  status: string;
  assignees: string[];
  completedAt: string | null;
}

/** One line in the All tasks list: a project task (with its sub-tasks) or a standalone synced task. */
export interface TaskRow {
  key: string;
  title: string;
  projectId: string | null;
  projectName: string | null;
  taskId: string | null;
  url: string | null;
  status: string;
  priority: string | null;
  due: string | null; // YYYY-MM-DD
  assignees: string[];
  subs: SubRow[];
  /** Sub-task count when the individual sub-tasks aren't loaded (standalone synced tasks). */
  subCount: number;
  comments: number;
  hours: number | null;
  tags: string[];
  description: string | null;
}

const day = (v?: string | null) => (v ? String(v).slice(0, 10) : null);
const names = (v?: string | null) => (v ?? '').split(',').map((x) => x.trim()).filter(Boolean);

/**
 * Every task, built from the live Taskmandu project data (tasks + sub-tasks), plus any standalone
 * tasks from the synced board that don't belong to a loaded project.
 */
export function useTaskRows(tasks: AllTask[] | null, projects: Project[], projectsLoading: boolean): TaskRow[] {
  const { employees } = useEmployees();

  return useMemo(() => {
    const nameFor = (id: string) => resolveEmployeeName(employees, id);
    const rows: TaskRow[] = [];
    const seen = new Set<string>();

    for (const p of projects) {
      for (const t of p.tasks) {
        seen.add(`${p._id}:${t._id}`);
        rows.push({
          key: `${p._id}:${t._id}`,
          title: t.title,
          projectId: p._id,
          projectName: p.name,
          taskId: t._id,
          url: null,
          status: t.status,
          priority: t.priority ?? null,
          due: day(t.dueDate),
          assignees: (t.assignedToId ?? []).map(nameFor),
          subs: (t.subTasks ?? []).map((s) => ({
            id: s._id,
            title: s.title,
            status: s.status,
            assignees: (s.assignedToId ?? []).map(nameFor),
            completedAt: s.completedAt ?? null,
          })),
          subCount: (t.subTasks ?? []).length,
          comments: (t.comments ?? []).length,
          hours: t.estimatedHours || null,
          tags: t.tags ?? [],
          description: t.description || null,
        });
      }
    }

    for (const t of tasks ?? []) {
      const inProject = Boolean(t.project_id && t.task_id);
      // A task that belongs to a project is already listed above — skip it once projects are loaded.
      if (inProject && (projectsLoading || seen.has(`${t.project_id}:${t.task_id}`))) continue;
      rows.push({
        key: `card:${t.card_id}`,
        title: t.title,
        projectId: t.project_id,
        projectName: t.project_name,
        taskId: t.task_id,
        url: t.url,
        status: t.status,
        priority: t.priority,
        due: day(t.due_at),
        assignees: names(t.assignee),
        subs: [],
        subCount: t.subtasks_count,
        comments: t.comments_count,
        hours: t.estimated_hours,
        tags: t.tags ?? [],
        description: t.description,
      });
    }

    return rows;
  }, [tasks, projects, projectsLoading, employees]);
}

const isOpen = (t: TaskRow) => t.status !== 'Completed' && t.status !== 'Cancelled';
const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
const dueTime = (t: TaskRow) => (t.due ? new Date(`${t.due}T00:00:00`).getTime() : null);

export type QuickKey = 'all' | 'open' | 'overdue' | 'week' | 'unassigned' | 'blocked' | 'done';
export const QUICK_KEYS: QuickKey[] = ['all', 'open', 'overdue', 'week', 'unassigned', 'blocked', 'done'];
const QUICK: { key: QuickKey; label: string; test: (t: TaskRow, today: number) => boolean }[] = [
  { key: 'all', label: 'All', test: () => true },
  { key: 'open', label: 'Open', test: (t) => isOpen(t) },
  { key: 'overdue', label: 'Overdue', test: (t, today) => isOpen(t) && (dueTime(t) ?? Infinity) < today },
  { key: 'week', label: 'Due this week', test: (t, today) => isOpen(t) && dueTime(t) !== null && dueTime(t)! >= today && dueTime(t)! < today + 7 * 86_400_000 },
  { key: 'unassigned', label: 'No owner', test: (t) => isOpen(t) && t.assignees.length === 0 },
  { key: 'blocked', label: 'Blocked', test: (t) => isOpen(t) && t.status.toLowerCase().includes('block') },
  { key: 'done', label: 'Completed', test: (t) => t.status === 'Completed' },
];

/** Same counts as the quick-filter chips on All tasks, so other screens can show matching numbers. */
export function countQuick(rows: TaskRow[]): Record<QuickKey, number> {
  const today = startOfToday();
  return Object.fromEntries(QUICK.map((q) => [q.key, rows.filter((t) => q.test(t, today)).length])) as Record<QuickKey, number>;
}

/** Flag-style counts (the Today tiles) computed from the same live rows as All tasks. */
export function liveFlagCounts(rows: TaskRow[]) {
  const today = startOfToday();
  const DAY = 86_400_000;
  const open = rows.filter(isOpen);
  const due = (t: TaskRow) => dueTime(t);
  return {
    overdue: open.filter((t) => (due(t) ?? Infinity) < today).length,
    blocked: open.filter((t) => t.status.toLowerCase().includes('block')).length,
    due_today: open.filter((t) => due(t) === today).length,
    due_soon: open.filter((t) => { const d = due(t); return d !== null && d > today && d <= today + 3 * DAY; }).length,
    unassigned: open.filter((t) => t.assignees.length === 0).length,
    subtasks_incomplete: rows.filter((t) => t.status === 'Completed' && t.subs.some((s) => s.status !== 'Completed' && s.status !== 'Cancelled')).length,
  };
}

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
  return s === 'urgent' || s === 'high' || s === 'critical' ? 'danger' : s === 'medium' ? 'warn' : 'neutral';
}

function dueInfo(t: TaskRow, today: number): { text: string; late: boolean } {
  const d = dueTime(t);
  if (d === null) return { text: 'No due date', late: false };
  const pretty = new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  return { text: pretty, late: isOpen(t) && d < today };
}

const PAGE = 40;
const field = 'rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm text-slate-700 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500';

export default function AllTasksPanel({
  rows,
  loading,
  projects: projectRecords = [],
  onProjectChanged,
  quickParam,
}: {
  rows: TaskRow[];
  loading?: boolean;
  projects?: Project[];
  onProjectChanged?: (project: Project) => void;
  /** Quick filter requested from elsewhere (e.g. a Today KPI card) — applied whenever it changes. */
  quickParam?: string | null;
}) {
  const [search, setSearch] = useState('');
  const [project, setProject] = useState('');
  const [staff, setStaff] = useState('');
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  const [quick, setQuick] = useState<QuickKey>('all');
  const [limit, setLimit] = useState(PAGE);
  // Per-task expand state; `expandAll` (when set) overrides the default for tasks not toggled by hand.
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({});
  const [expandAll, setExpandAll] = useState<boolean | null>(null);
  const [activeTask, setActiveTask] = useState<{ projectId: string; taskId: string } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const { employees, nameFor } = useEmployees();
  const today = startOfToday();
  const activeProject = activeTask ? projectRecords.find((p) => p._id === activeTask.projectId) ?? null : null;
  const activeProjectTask: ProjectTask | null = activeProject && activeTask ? activeProject.tasks.find((t) => t._id === activeTask.taskId) ?? null : null;

  useEffect(() => {
    if (quickParam && (QUICK_KEYS as string[]).includes(quickParam)) {
      setQuick(quickParam as QuickKey);
      setLimit(PAGE);
    }
  }, [quickParam]);

  const projects = useMemo(() => Array.from(new Set(rows.map((t) => t.projectName).filter((x): x is string => Boolean(x)))).sort(), [rows]);
  const staffNames = useMemo(
    () => Array.from(new Set(rows.flatMap((t) => [...t.assignees, ...t.subs.flatMap((s) => s.assignees)]))).filter(Boolean).sort(),
    [rows]
  );
  const statuses = useMemo(() => {
    const present = new Set(rows.flatMap((t) => [t.status, ...t.subs.map((s) => s.status)]).filter(Boolean));
    const known = (TASK_STATUSES as readonly string[]).filter((s) => present.has(s));
    return [...known, ...Array.from(present).filter((s) => !(TASK_STATUSES as readonly string[]).includes(s)).sort()];
  }, [rows]);

  const priorities = useMemo(() => {
    const order = ['Critical', 'Urgent', 'High', 'Medium', 'Low'];
    const present = Array.from(new Set(rows.map((t) => t.priority).filter((x): x is string => Boolean(x))));
    return present.sort((a, b) => (order.indexOf(a) === -1 ? 99 : order.indexOf(a)) - (order.indexOf(b) === -1 ? 99 : order.indexOf(b)));
  }, [rows]);

  const counts = useMemo(() => Object.fromEntries(QUICK.map((q) => [q.key, rows.filter((t) => q.test(t, today)).length])) as Record<QuickKey, number>, [rows, today]);
  const filterActive = Boolean(staff || status);

  const subMatches = (s: SubRow) => (!staff || s.assignees.includes(staff)) && (!status || s.status === status);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const test = QUICK.find((x) => x.key === quick)!.test;
    return rows.filter((t) => {
      if (!test(t, today)) return false;
      if (project && t.projectName !== project) return false;
      if (priority && t.priority !== priority) return false;
      // Staff / status match the task itself or any of its sub-tasks.
      if (staff && !t.assignees.includes(staff) && !t.subs.some((s) => s.assignees.includes(staff))) return false;
      if (status && t.status !== status && !t.subs.some((s) => s.status === status)) return false;
      if (!q) return true;
      return [t.title, t.description, t.projectName, t.status, t.priority, ...t.assignees, ...t.tags, ...t.subs.map((s) => s.title)]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [rows, search, project, staff, status, priority, quick, today]);

  const subtaskTotal = useMemo(() => rows.reduce((n, t) => n + (t.subs.length || t.subCount), 0), [rows]);
  const reset = () => setLimit(PAGE);
  const isExpanded = (t: TaskRow) => openMap[t.key] ?? expandAll ?? filterActive;

  return (
    <section className="rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-base font-semibold tracking-tight text-slate-900">All tasks</h3>
          <p className="text-xs text-slate-500">Every task from your Taskmandu projects with its sub-tasks, plus standalone tasks.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setCreateOpen(true)} className={btnSecondary}>+ New task</button>
          <button type="button" onClick={() => { setOpenMap({}); setExpandAll(true); }} className={btnSecondary}>
            Expand all
          </button>
          <button type="button" onClick={() => { setOpenMap({}); setExpandAll(false); }} className={btnSecondary}>
            Collapse all
          </button>
        </div>
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

      <div className="grid gap-2 border-b border-slate-100 p-4 sm:grid-cols-2 lg:grid-cols-5">
        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            reset();
          }}
          placeholder="Search tasks and sub-tasks…"
          className={`${field} sm:col-span-2 lg:col-span-1`}
        />
        <select value={project} onChange={(e) => { setProject(e.target.value); reset(); }} className={field} aria-label="Project">
          <option value="">All projects</option>
          {projects.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
        <select value={staff} onChange={(e) => { setStaff(e.target.value); reset(); }} className={field} aria-label="Staff">
          <option value="">All staff</option>
          {staffNames.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
        <select value={status} onChange={(e) => { setStatus(e.target.value); reset(); }} className={field} aria-label="Status">
          <option value="">All statuses</option>
          {statuses.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
        <select value={priority} onChange={(e) => { setPriority(e.target.value); reset(); }} className={field} aria-label="Priority">
          <option value="">All priorities</option>
          {priorities.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
      </div>

      <div className="px-4 py-2 text-xs text-slate-500">
        Showing {Math.min(limit, visible.length)} of {visible.length} matching tasks · {rows.length} tasks, {subtaskTotal} sub-tasks in total
        {filterActive && ' · sub-tasks that match your staff/status filter are highlighted'}
      </div>

      {loading && rows.length === 0 ? (
        <EmptyState title="Loading tasks…" />
      ) : visible.length === 0 ? (
        <p className="p-8 text-center text-sm text-slate-500">No tasks match those filters.</p>
      ) : (
        <>
          {/* Column labels (desktop only) */}
          <div className="hidden grid-cols-[minmax(0,1fr)_10rem_8rem_8rem] gap-4 border-y border-slate-100 bg-slate-50 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 md:grid">
            <span>Task</span>
            <span>Staff</span>
            <span>Status</span>
            <span>Due</span>
          </div>
          <ul className="divide-y divide-slate-100">
            {visible.slice(0, limit).map((t) => {
              const canOpen = Boolean(t.url || (t.projectId && t.taskId && projectRecords.some((p) => p._id === t.projectId && p.tasks.some((task) => task._id === t.taskId))));
              const due = dueInfo(t, today);
              const open = isExpanded(t);
              const hasSubs = t.subs.length > 0;
              return (
                <li key={t.key}>
                  <div className="flex w-full flex-col gap-2 px-4 py-3 text-left md:grid md:grid-cols-[minmax(0,1fr)_10rem_8rem_8rem] md:items-center md:gap-4">
                    <div className="min-w-0">
                      <button
                        type="button"
                        disabled={!canOpen}
                        onClick={() => {
                          if (t.projectId && t.taskId && projectRecords.some((p) => p._id === t.projectId && p.tasks.some((task) => task._id === t.taskId))) setActiveTask({ projectId: t.projectId, taskId: t.taskId });
                          else if (t.url) window.open(t.url, '_blank', 'noopener');
                        }}
                        className={`block break-words text-left text-sm font-medium text-slate-900 ${canOpen ? 'hover:text-indigo-700' : 'cursor-default'}`}
                      >
                        {t.title}
                      </button>
                      <div className="mt-0.5 truncate text-xs text-slate-500">{t.projectName ?? 'Standalone task'}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400">
                        {t.priority && <Pill tone={priorityTone(t.priority)}>{t.priority}</Pill>}
                        {hasSubs ? (
                          <button
                            type="button"
                            aria-expanded={open}
                            onClick={() => setOpenMap((m) => ({ ...m, [t.key]: !open }))}
                            className="font-medium text-indigo-600 hover:text-indigo-800"
                          >
                            {open ? '▾' : '▸'} {t.subs.length} sub-task{t.subs.length === 1 ? '' : 's'}
                          </button>
                        ) : (
                          <span>{t.subCount} sub-tasks</span>
                        )}
                        <span>{t.comments} comments</span>
                        {t.hours ? <span>{t.hours}h</span> : null}
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-2 text-xs md:block">
                      <span className="text-slate-400 md:hidden">Staff</span>
                      <span className={`break-words ${t.assignees.length ? 'text-slate-700' : 'font-medium text-amber-700'}`}>
                        {t.assignees.length ? t.assignees.join(', ') : 'Unassigned'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 md:block">
                      <span className="text-xs text-slate-400 md:hidden">Status</span>
                      <Pill tone={statusTone(t.status)}>{t.status}</Pill>
                    </div>
                    <div className="flex items-center justify-between gap-2 text-xs md:block">
                      <span className="text-slate-400 md:hidden">Due</span>
                      <span className={due.late ? 'font-semibold text-red-600' : 'text-slate-600'}>{due.late ? `Overdue · ${due.text}` : due.text}</span>
                    </div>
                  </div>

                  {hasSubs && open && (
                    <ul className="mb-3 ml-4 mr-4 space-y-1 border-l-2 border-slate-100 pl-3 sm:ml-6">
                      {t.subs.map((s) => {
                        const match = filterActive && subMatches(s);
                        const dim = filterActive && !match;
                        return (
                          <li key={s.id}>
                            <button
                              type="button"
                              disabled={!t.projectId || !t.taskId || !projectRecords.some((p) => p._id === t.projectId && p.tasks.some((task) => task._id === t.taskId))}
                              onClick={() => t.projectId && t.taskId && setActiveTask({ projectId: t.projectId, taskId: t.taskId })}
                              className={`flex w-full flex-col gap-1 rounded-lg px-3 py-2 text-left text-xs transition hover:bg-slate-50 md:grid md:grid-cols-[minmax(0,1fr)_10rem_8rem_8rem] md:items-center md:gap-4 ${
                                match ? 'bg-indigo-50/60 ring-1 ring-indigo-200' : ''
                              } ${dim ? 'opacity-50' : ''}`}
                            >
                              <span className="break-words text-slate-800">{s.title}</span>
                              <span className={s.assignees.length ? 'text-slate-600' : 'font-medium text-amber-700'}>
                                {s.assignees.length ? s.assignees.join(', ') : 'Unassigned'}
                              </span>
                              <span><Pill tone={statusTone(s.status)}>{s.status}</Pill></span>
                              <span className="text-slate-500">
                                {s.status === 'Completed' && s.completedAt
                                  ? new Date(s.completedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
                                  : ''}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
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

      {createOpen && (
        <NewTaskModal
          employees={employees}
          projects={projectRecords}
          defaultStatus="Assigned"
          onClose={() => setCreateOpen(false)}
          onSubmit={async (input, projectName) => {
            const requestedName = (projectName ?? '').trim();
            if (!requestedName) throw new Error('Choose an existing project or enter a new project name.');
            let target = projectRecords.find((p) => p.name.trim().toLowerCase() === requestedName.toLowerCase());
            if (!target) {
              const { data } = await pmApi.createProject({ name: requestedName, status: 'Active', color: 'bg-teal-500' });
              target = data.project;
              onProjectChanged?.(target);
            }
            const { data } = await pmApi.addProjectTask(target._id, input);
            onProjectChanged?.(data.project);
            setCreateOpen(false);
          }}
        />
      )}
      {activeProject && activeProjectTask && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/60 p-2 sm:p-5" role="dialog" aria-modal="true" aria-label={`Task details: ${activeProjectTask.title}`} onMouseDown={(e) => { if (e.target === e.currentTarget) setActiveTask(null); }}>
          <div className="flex max-h-[94dvh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-slate-50 shadow-2xl">
            <div className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
              <div className="min-w-0"><p className="text-xs text-slate-500">{activeProject.name}</p><h2 className="truncate text-sm font-semibold text-slate-900">{activeProjectTask.title}</h2></div>
              <button type="button" onClick={() => setActiveTask(null)} aria-label="Close task details" className="rounded-lg px-3 py-2 text-sm text-slate-500 hover:bg-slate-100">✕</button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-5">
              <TaskDetail key={`${activeProject._id}:${activeProjectTask._id}`} project={activeProject} task={activeProjectTask} employees={employees as Employee[]} nameFor={nameFor} onChanged={(updated) => onProjectChanged?.(updated)} onBack={() => setActiveTask(null)} showBackButton={false} />
            </div>
          </div>
        </div>
      )}

    </section>
  );
}
