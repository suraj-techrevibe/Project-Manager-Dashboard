import { useEffect, useMemo, useRef } from 'react';
import { Icon } from '@/Components/Pm/ui/kit';
import { PM_LOOK } from '@/Components/Pm/PmShell';
import { PM_PAGES, visitPm } from '@/lib/pmNav';
import type { AllTask } from '@/Components/Pm/AllTasksPanel';
import type { Project, TaskFocus } from '@/types/pm';

interface Props {
  open: boolean;
  query: string;
  onQuery: (q: string) => void;
  onClose: () => void;
  tasks: AllTask[];
  projects: Project[];
  onOpenTask: (f: TaskFocus) => void;
}

const Heading = ({ children }: { children: string }) => <div className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{children}</div>;
const rowCls = 'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition hover:bg-indigo-50 focus:bg-indigo-50 focus:outline-none disabled:opacity-50';

/** Ctrl/⌘+K palette: jump to a section, a project or a task already loaded by the dashboard. */
export default function QuickSearch({ open, query, onQuery, onClose, tasks, projects, onOpenTask }: Props) {
  const q = query.trim().toLowerCase();
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) requestAnimationFrame(() => input.current?.focus());
  }, [open]);

  const pages = useMemo(() => PM_PAGES.filter((p) => !q || p.label.toLowerCase().includes(q) || p.key.includes(q)).slice(0, 6), [q]);
  const foundProjects = useMemo(() => (q ? projects.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 5) : []), [q, projects]);
  const foundTasks = useMemo(
    () => (q ? tasks.filter((t) => [t.title, t.project_name, t.assignee, t.status, t.description].filter(Boolean).join(' ').toLowerCase().includes(q)).slice(0, 7) : []),
    [q, tasks]
  );

  if (!open) return null;

  const done = () => {
    onClose();
    onQuery('');
  };

  return (
    <div className="fixed inset-0 z-[60] bg-slate-950/40 p-3 backdrop-blur-[2px] sm:p-6" onClick={onClose} role="dialog" aria-modal="true" aria-label="Search">
      <div className="mx-auto mt-10 max-w-2xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3">
          <Icon name="search" className="h-5 w-5 text-slate-400" />
          <input
            ref={input}
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Search tasks, projects or jump to a section…"
            className="w-full border-0 bg-transparent p-0 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-0"
          />
          <button type="button" onClick={onClose} className="rounded border border-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 hover:bg-slate-50">
            Esc
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto p-2">
          <Heading>Go to</Heading>
          {pages.map((p) => (
            <button key={p.key} type="button" className={rowCls} onClick={() => { done(); visitPm(p.key, {}); }}>
              <Icon name={PM_LOOK[p.key].icon} className="h-4 w-4 text-slate-400" />
              <span className="text-slate-800">{p.label}</span>
            </button>
          ))}

          {q ? (
            <>
              <Heading>Projects</Heading>
              {foundProjects.map((p) => (
                <button key={p._id} type="button" className={rowCls} onClick={() => { done(); visitPm('projects', { project: p._id }); }}>
                  <Icon name="folder" className="h-4 w-4 text-slate-400" />
                  <span className="truncate text-slate-800">{p.name}</span>
                </button>
              ))}
              {foundProjects.length === 0 && <p className="px-3 py-1 text-xs text-slate-400">No matching projects.</p>}

              <Heading>Tasks</Heading>
              {foundTasks.map((t) => (
                <button
                  key={t.card_id}
                  type="button"
                  disabled={!t.project_id || !t.task_id}
                  className={`${rowCls} items-start`}
                  onClick={() => {
                    done();
                    if (t.project_id && t.task_id) onOpenTask({ projectId: t.project_id, taskId: t.task_id });
                  }}
                >
                  <Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                  <span className="min-w-0">
                    <span className="block truncate text-slate-800">{t.title}</span>
                    <span className="block truncate text-xs text-slate-500">
                      {t.project_name ?? 'Project'} · {t.status}
                      {t.assignee ? ` · ${t.assignee}` : ''}
                    </span>
                  </span>
                </button>
              ))}
              {foundTasks.length === 0 && <p className="px-3 py-2 text-sm text-slate-500">No matching tasks found.</p>}
            </>
          ) : (
            <p className="px-3 py-3 text-xs text-slate-500">Type to search. Task results cover the tasks currently loaded on the dashboard.</p>
          )}
        </div>
      </div>
    </div>
  );
}
