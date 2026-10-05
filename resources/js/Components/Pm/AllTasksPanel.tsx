import { useMemo, useState } from 'react';
import type { TaskFocus } from '../../types/pm';
import { btnSecondary } from './ui/kit';

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

function dueLabel(date: string | null): string {
  if (!date) return 'No due date';
  const due = new Date(`${date}T00:00:00`);
  return due.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function AllTasksPanel({
  tasks,
  onOpenTask,
  onBack,
}: {
  tasks: AllTask[];
  onOpenTask: (focus: TaskFocus) => void;
  onBack: () => void;
}) {
  const [search, setSearch] = useState('');
  const [project, setProject] = useState('');
  const [assignee, setAssignee] = useState('');
  const [status, setStatus] = useState('');

  const projects = useMemo(
    () => Array.from(new Set(tasks.map((t) => t.project_name).filter((x): x is string => Boolean(x)))).sort(),
    [tasks]
  );
  const assignees = useMemo(
    () => Array.from(new Set(tasks.flatMap((t) => (t.assignee ?? '').split(',').map((x) => x.trim()).filter(Boolean)))).sort(),
    [tasks]
  );
  const statuses = useMemo(() => Array.from(new Set(tasks.map((t) => t.status).filter(Boolean))).sort(), [tasks]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tasks.filter((t) => {
      if (project && t.project_name !== project) return false;
      if (assignee && !(t.assignee ?? '').split(',').map((x) => x.trim()).includes(assignee)) return false;
      if (status && t.status !== status) return false;
      if (!q) return true;
      return [t.title, t.description, t.project_name, t.assignee, t.status, t.priority, ...t.tags]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [tasks, search, project, assignee, status]);

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-base font-semibold text-slate-900">All tasks</h3>
          <p className="text-xs text-slate-500">Every task on the board — flagged and unflagged.</p>
        </div>
        <button onClick={onBack} className={btnSecondary}>Back to Today</button>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-slate-100 p-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search tasks…"
          className="min-w-[220px] flex-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
        <select value={project} onChange={(e) => setProject(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm">
          <option value="">All projects</option>
          {projects.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
        <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm">
          <option value="">All assignees</option>
          {assignees.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm">
          <option value="">All statuses</option>
          {statuses.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
      </div>

      <div className="border-b border-slate-100 px-4 py-2 text-xs text-slate-500">
        Showing {visible.length} of {tasks.length} tasks
      </div>

      {visible.length === 0 ? (
        <p className="p-6 text-sm text-slate-500">No tasks match those filters.</p>
      ) : (
        <div className="divide-y divide-slate-100">
          {visible.map((t) => {
            const canOpen = Boolean((t.project_id && t.task_id) || t.url);
            return (
              <button
                key={t.card_id}
                type="button"
                disabled={!canOpen}
                onClick={() => {
                  if (t.project_id && t.task_id) onOpenTask({ projectId: t.project_id, taskId: t.task_id });
                  else if (t.url) window.open(t.url, '_blank', 'noopener');
                }}
                className={`block w-full p-4 text-left ${canOpen ? 'cursor-pointer hover:bg-slate-50' : 'cursor-default'}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="mb-1 text-xs text-slate-500">
                      {t.project_name ?? 'Standalone task'} · {t.assignee ?? 'Unassigned'}
                    </div>
                    <div className="text-sm font-medium text-slate-900">{t.title}</div>
                    {t.description && <div className="mt-1 line-clamp-2 text-xs text-slate-500">{t.description}</div>}
                  </div>
                  <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                    {t.priority && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{t.priority}</span>}
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{t.status}</span>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-400">
                  <span>Due: {dueLabel(t.due_at)}</span>
                  <span>{t.subtasks_count} subtasks</span>
                  <span>{t.comments_count} comments</span>
                  {t.estimated_hours ? <span>{t.estimated_hours}h</span> : null}
                  {canOpen && <span className="text-indigo-500">Open →</span>}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
