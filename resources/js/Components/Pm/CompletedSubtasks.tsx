import { useMemo, useState } from 'react';
import type { Project, TaskFocus } from '../../types/pm';
import { EmptyState, Icon, btnSecondary } from './ui/kit';

export interface CompletedSubtask {
  projectId: string;
  projectName: string;
  taskId: string;
  taskTitle: string;
  subtaskId: string;
  subtaskTitle: string;
  completedAt?: string | null;
}

/** Every completed sub-task across the loaded projects, newest first. */
export function useCompletedSubtasks(projects: Project[]): CompletedSubtask[] {
  return useMemo(
    () =>
      projects
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
              }))
          )
        )
        .sort((a, b) => (b.completedAt ? new Date(b.completedAt).getTime() : 0) - (a.completedAt ? new Date(a.completedAt).getTime() : 0)),
    [projects]
  );
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
  const [limit, setLimit] = useState(pageSize);

  const visible = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? items.filter((i) => [i.subtaskTitle, i.taskTitle, i.projectName].some((v) => v.toLowerCase().includes(s))) : items;
  }, [items, q]);

  if (loading) return <EmptyState title="Loading project subtasks…" />;
  if (!items.length)
    return <EmptyState title="No completed subtasks yet">Nothing found in the loaded project data. Sync from Taskmandu, then check again.</EmptyState>;

  return (
    <div>
      {searchable && (
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setLimit(pageSize);
          }}
          placeholder="Search completed subtasks…"
          className="mb-3 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm placeholder:text-slate-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 sm:max-w-sm"
        />
      )}

      {visible.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-500">No completed subtasks match “{q}”.</p>
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
