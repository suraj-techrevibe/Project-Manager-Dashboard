import { useMemo, useState } from 'react';
import type { Project, TaskFocus } from '../../types/pm';
import { EmptyState, Icon, btnSecondary } from './ui/kit';
import { useEmployees } from './Projects/ui';

export interface CompletedSubtask {
  projectId: string;
  projectName: string;
  taskId: string;
  taskTitle: string;
  subtaskId: string;
  subtaskTitle: string;
  completedAt?: string | null;
  assignees: string[];
  /** Status of the parent task, for filtering. */
  taskStatus: string;
}

/** Every completed sub-task across the loaded projects, newest first. */
export function useCompletedSubtasks(projects: Project[]): CompletedSubtask[] {
  const { employees } = useEmployees();
  return useMemo(() => {
    const nameFor = (id: string) => employees.find((e) => e.employeeId === id || e.id === id)?.name ?? id;
    return projects
      .flatMap((project) =>
        project.tasks.flatMap((task) =>
          (task.subTasks ?? [])
            .filter((s) => s.status === 'Completed')
            .map((s) => ({
              projectId: project._id,
              projectName: project.name,
              taskId: task._id,
              taskTitle: task.title,
              subtaskId: s._id,
              subtaskTitle: s.title,
              completedAt: s.completedAt,
              assignees: (s.assignedToId ?? []).map(nameFor),
              taskStatus: task.status,
            }))
        )
      )
      .sort((a, b) => (b.completedAt ? new Date(b.completedAt).getTime() : 0) - (a.completedAt ? new Date(a.completedAt).getTime() : 0));
  }, [projects, employees]);
}

const when = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : 'Date not recorded';

/** Responsive card grid: 1 column on phones, 2 on tablets, 3 on wide screens. */
export default function CompletedSubtasksGrid({
  items,
  loading,
  onOpen,
  pageSize = 12,
  searchable = true,
}: {
  items: CompletedSubtask[];
  loading?: boolean;
  onOpen: (f: TaskFocus) => void;
  pageSize?: number;
  searchable?: boolean;
}) {
  const [q, setQ] = useState('');
  const [project, setProject] = useState('');
  const [staff, setStaff] = useState('');
  const [parentStatus, setParentStatus] = useState('');
  const [limit, setLimit] = useState(pageSize);

  const projects = useMemo(() => Array.from(new Set(items.map((i) => i.projectName))).sort(), [items]);
  const staffNames = useMemo(() => Array.from(new Set(items.flatMap((i) => i.assignees))).filter(Boolean).sort(), [items]);
  const parentStatuses = useMemo(() => Array.from(new Set(items.map((i) => i.taskStatus))).filter(Boolean).sort(), [items]);

  const visible = useMemo(() => {
    const s = q.trim().toLowerCase();
    return items.filter((i) => {
      if (project && i.projectName !== project) return false;
      if (staff && !i.assignees.includes(staff)) return false;
      if (parentStatus && i.taskStatus !== parentStatus) return false;
      return !s || [i.subtaskTitle, i.taskTitle, i.projectName, ...i.assignees].some((v) => v.toLowerCase().includes(s));
    });
  }, [items, q, project, staff, parentStatus]);

  const filtersOn = Boolean(q || project || staff || parentStatus);
  const pick = (set: (v: string) => void) => (e: { target: { value: string } }) => {
    set(e.target.value);
    setLimit(pageSize);
  };
  const field = 'rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm text-slate-700 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500';

  if (loading) return <EmptyState title="Loading project subtasks…" />;
  if (!items.length)
    return <EmptyState title="No completed subtasks yet">Nothing found in the loaded project data. Sync from Taskmandu, then check again.</EmptyState>;

  return (
    <div>
      {searchable && (
        <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <input
            value={q}
            onChange={pick(setQ)}
            placeholder="Search completed subtasks…"
            className={`${field} placeholder:text-slate-400 sm:col-span-2 lg:col-span-1`}
          />
          <select value={project} onChange={pick(setProject)} className={field} aria-label="Project">
            <option value="">All projects</option>
            {projects.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
          <select value={staff} onChange={pick(setStaff)} className={field} aria-label="Staff">
            <option value="">All staff</option>
            {staffNames.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
          <select value={parentStatus} onChange={pick(setParentStatus)} className={field} aria-label="Parent task status">
            <option value="">Any parent task status</option>
            {parentStatuses.map((x) => <option key={x} value={x}>Parent: {x}</option>)}
          </select>
        </div>
      )}
      {searchable && (
        <p className="mb-3 text-xs text-slate-500">
          Showing {Math.min(limit, visible.length)} of {visible.length} matching · {items.length} completed in total
        </p>
      )}

      {visible.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-500">No completed subtasks match {filtersOn ? 'those filters' : 'that search'}.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visible.slice(0, limit).map((i) => (
            <li key={`${i.projectId}:${i.taskId}:${i.subtaskId}`} className="flex min-w-0 flex-col rounded-xl border border-slate-200/80 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition hover:border-emerald-200 hover:shadow-sm">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-inset ring-emerald-100">
                  <Icon name="check" className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="break-words text-sm font-semibold leading-snug text-slate-900">{i.subtaskTitle}</div>
                  <div className="mt-1 truncate text-xs text-slate-500" title={i.projectName}>{i.projectName}</div>
                </div>
              </div>
              <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                <span className="text-slate-400">Parent task · </span>
                <span className="break-words">{i.taskTitle}</span>
              </div>
              <div className="mt-2 text-xs text-slate-500">
                <span className="text-slate-400">Staff · </span>
                <span className={i.assignees.length ? 'text-slate-700' : 'font-medium text-amber-700'}>{i.assignees.length ? i.assignees.join(', ') : 'Unassigned'}</span>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 pt-1">
                <span className="text-[11px] font-medium text-emerald-700">Completed · {when(i.completedAt)}</span>
                <button
                  type="button"
                  onClick={() => onOpen({ projectId: i.projectId, taskId: i.taskId, subId: i.subtaskId })}
                  className="text-xs font-semibold text-indigo-600 hover:text-indigo-800"
                >
                  Review →
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {visible.length > limit && (
        <div className="mt-4 flex justify-center">
          <button type="button" onClick={() => setLimit((l) => l + pageSize)} className={btnSecondary}>
            Show more ({visible.length - limit} left)
          </button>
        </div>
      )}
    </div>
  );
}
