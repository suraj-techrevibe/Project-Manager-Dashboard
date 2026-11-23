import { useState } from 'react';
import type { Project, TaskFocus } from '../../types/pm';
import { useUrlParam } from '../../lib/urlState';
import AllTasksPanel, { useTaskRows, type AllTask } from './AllTasksPanel';
import CompletedSubtasksGrid, { useCompletedSubtasks } from './CompletedSubtasks';
import { useEmployees } from './Projects/ui';

type View = 'tasks' | 'subtasks';

/** The "All tasks" sidebar page: every task, plus every completed sub-task, in two clear sections. */
export default function TasksPage({
  tasks,
  loading,
  error,
  onRetry,
  projects,
  projectsLoading,
  onOpenTask,
  onProjectChanged,
}: {
  tasks: AllTask[] | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  projects: Project[];
  projectsLoading: boolean;
  onOpenTask: (f: TaskFocus) => void;
  onProjectChanged?: (project: Project) => void;
}) {
  const [view, setView] = useState<View>('tasks');
  const completed = useCompletedSubtasks(projects);
  const rows = useTaskRows(tasks, projects, projectsLoading);
  const quickParam = useUrlParam('tq');
  const { employees: staffList, error: staffError, reload: reloadStaff } = useEmployees();

  const tab = (key: View, label: string, count?: number) => (
    <button
      key={key}
      type="button"
      role="tab"
      aria-selected={view === key}
      onClick={() => setView(key)}
      className={`flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition ${
        view === key ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-800'
      }`}
    >
      {label}
      {count !== undefined && <span className={`rounded-full px-2 py-0.5 text-xs tabular-nums ${view === key ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-100 text-slate-600'}`}>{count}</span>}
    </button>
  );

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Task views" className="flex gap-1 overflow-x-auto border-b border-slate-200">
        {tab('tasks', 'All tasks', projectsLoading && rows.length === 0 ? undefined : rows.length)}
        {tab('subtasks', 'Completed subtasks', projectsLoading ? undefined : completed.length)}
      </div>

      {view === 'tasks' && (
        <>
          {staffError && staffList.length === 0 && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Staff names could not be loaded, so people may show as codes.{' '}
              <button onClick={reloadStaff} className="font-medium underline">Try again</button>
            </p>
          )}
          {error && !tasks && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Standalone tasks from the synced board couldn't be loaded ({error}).{' '}
              <button onClick={onRetry} className="font-medium underline">Try again</button>
            </p>
          )}
          <AllTasksPanel rows={rows} loading={projectsLoading || loading} projects={projects} onProjectChanged={onProjectChanged} quickParam={quickParam} />
        </>
      )}

      {view === 'subtasks' && (
        <section className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-5">
          <div className="mb-4">
            <h3 className="text-base font-semibold tracking-tight text-slate-900">Completed subtasks</h3>
            <p className="text-xs text-slate-500">Finished in Taskmandu, newest first. Filter by project or staff, and open one to review it in its parent task.</p>
          </div>
          <CompletedSubtasksGrid items={completed} loading={projectsLoading} onOpen={onOpenTask} pageSize={18} />
        </section>
      )}
    </div>
  );
}
