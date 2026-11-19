import { useState } from 'react';
import type { Project, TaskFocus } from '../../types/pm';
import AllTasksPanel, { type AllTask } from './AllTasksPanel';
import CompletedSubtasksGrid, { useCompletedSubtasks } from './CompletedSubtasks';

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
}: {
  tasks: AllTask[] | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  projects: Project[];
  projectsLoading: boolean;
  onOpenTask: (f: TaskFocus) => void;
}) {
  const [view, setView] = useState<View>('tasks');
  const completed = useCompletedSubtasks(projects);

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
        {tab('tasks', 'All tasks', tasks?.length)}
        {tab('subtasks', 'Completed subtasks', projectsLoading ? undefined : completed.length)}
      </div>

      {view === 'tasks' &&
        (tasks ? (
          <AllTasksPanel tasks={tasks} onOpenTask={onOpenTask} />
        ) : (
          <div className="rounded-xl border border-slate-200/80 bg-white p-6 text-sm text-slate-500">
            {error ? (
              <>
                {error}{' '}
                <button onClick={onRetry} className="font-medium text-indigo-600 underline">
                  Try again
                </button>
              </>
            ) : loading ? (
              'Loading tasks…'
            ) : (
              'No task data yet.'
            )}
          </div>
        ))}

      {view === 'subtasks' && (
        <section className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-5">
          <div className="mb-4">
            <h3 className="text-base font-semibold tracking-tight text-slate-900">Completed subtasks</h3>
            <p className="text-xs text-slate-500">Finished in Taskmandu, newest first. Open one to review it in its parent task.</p>
          </div>
          <CompletedSubtasksGrid items={completed} loading={projectsLoading} onOpen={onOpenTask} pageSize={18} />
        </section>
      )}
    </div>
  );
}
