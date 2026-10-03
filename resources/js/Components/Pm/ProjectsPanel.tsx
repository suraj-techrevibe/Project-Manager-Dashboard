import { useEffect, useState } from 'react';
import { pmApi } from '../../lib/pmApi';
import type {
  Project,
  ProjectTask,
  Employee,
  ProjectStatus,
  TaskStatus,
  TaskPriority,
  NewTaskInput,
} from '../../types/pm';
import { PROJECT_STATUSES, TASK_STATUSES, TASK_PRIORITIES } from '../../types/pm';

const statusColors: Record<ProjectStatus, string> = {
  Planning: 'bg-slate-100 text-slate-600',
  Active: 'bg-green-50 text-green-700',
  Blocked: 'bg-red-50 text-red-700',
  'On Hold': 'bg-amber-50 text-amber-700',
  Completed: 'bg-blue-50 text-blue-700',
};

const priorityColors: Record<TaskPriority, string> = {
  Low: 'bg-slate-100 text-slate-500',
  Medium: 'bg-blue-50 text-blue-600',
  High: 'bg-amber-50 text-amber-700',
  Critical: 'bg-red-50 text-red-700',
};

function err(e: any, fallback: string) {
  return e?.response?.data?.error ?? fallback;
}

export default function ProjectsPanel() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [search, setSearch] = useState('');

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const { data } = await pmApi.projects(search ? { search } : undefined);
      setProjects(data.projects);
    } catch (e) {
      setError(err(e, "Couldn't load projects from Taskmandu."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const open = projects.find((p) => p._id === openId) ?? null;

  if (open) {
    return (
      <ProjectBoard
        project={open}
        onBack={() => setOpenId(null)}
        onChanged={(updated) => setProjects((ps) => ps.map((p) => (p._id === updated._id ? updated : p)))}
        onDeleted={() => {
          setProjects((ps) => ps.filter((p) => p._id !== open._id));
          setOpenId(null);
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && load()}
          placeholder="Search projects…"
          className="flex-1 min-w-[160px] rounded-md border border-slate-300 px-3 py-1.5 text-sm"
        />
        <button onClick={load} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
          Search
        </button>
        <button onClick={() => setShowNew(true)} className="rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white">
          New project
        </button>
      </div>

      {error && <div className="rounded-md bg-red-50 p-2 text-xs text-red-700">{error}</div>}
      {loading && <p className="text-sm text-slate-500">Loading projects…</p>}

      {!loading && projects.length === 0 && !error && (
        <p className="text-sm text-slate-500">No projects found in Taskmandu.</p>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        {projects.map((p) => {
          const done = p.tasks.filter((t) => t.status === 'Completed').length;
          return (
            <button
              key={p._id}
              onClick={() => setOpenId(p._id)}
              className="rounded-xl border border-slate-200 bg-white p-4 text-left hover:border-slate-300"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="font-medium text-slate-900">{p.name}</div>
                <span className={`shrink-0 rounded px-2 py-0.5 text-xs ${statusColors[p.status]}`}>{p.status}</span>
              </div>
              {p.description && <div className="mt-1 line-clamp-2 text-xs text-slate-500">{p.description}</div>}
              <div className="mt-2 text-xs text-slate-400">
                {p.tasks.length} task{p.tasks.length === 1 ? '' : 's'} · {done} done
                {p.manager && ` · ${p.manager}`}
              </div>
            </button>
          );
        })}
      </div>

      {showNew && (
        <NewProjectModal
          onClose={() => setShowNew(false)}
          onCreated={(p) => {
            setProjects((ps) => [p, ...ps]);
            setShowNew(false);
            setOpenId(p._id);
          }}
        />
      )}
    </div>
  );
}

function NewProjectModal({ onClose, onCreated }: { onClose: () => void; onCreated: (p: Project) => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<ProjectStatus>('Planning');
  const [manager, setManager] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const { data } = await pmApi.createProject({
        name: name.trim(),
        description: description.trim() || undefined,
        status,
        manager: manager.trim() || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      });
      onCreated(data.project);
    } catch (e) {
      setError(err(e, "Couldn't create the project."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal onClose={onClose} title="New project">
      <div className="flex flex-col gap-3">
        <Field label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm" autoFocus />
        </Field>
        <Field label="Description">
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Status">
            <select value={status} onChange={(e) => setStatus(e.target.value as ProjectStatus)} className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm">
              {PROJECT_STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </Field>
          <Field label="Manager">
            <input value={manager} onChange={(e) => setManager(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm" />
          </Field>
          <Field label="Start date">
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm" />
          </Field>
          <Field label="End date">
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm" />
          </Field>
        </div>
        {error && <div className="rounded-md bg-red-50 p-2 text-xs text-red-700">{error}</div>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700">Cancel</button>
          <button onClick={submit} disabled={saving || !name.trim()} className="rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50">
            {saving ? 'Creating…' : 'Create project'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function ProjectBoard({
  project,
  onBack,
  onChanged,
  onDeleted,
}: {
  project: Project;
  onBack: () => void;
  onChanged: (p: Project) => void;
  onDeleted: () => void;
}) {
  const [showNewTask, setShowNewTask] = useState(false);
  const [editTask, setEditTask] = useState<ProjectTask | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyTask, setBusyTask] = useState<string | null>(null);

  useEffect(() => {
    pmApi.employees().then(({ data }) => setEmployees(data.employees)).catch(() => {});
  }, []);

  function nameFor(employeeId: string) {
    return employees.find((e) => e.employeeId === employeeId)?.name ?? employeeId;
  }

  async function changeStatus(task: ProjectTask, status: TaskStatus) {
    setBusyTask(task._id);
    setError(null);
    try {
      const { data } = await pmApi.updateProjectTask(project._id, task._id, { status });
      onChanged(data.project);
    } catch (e) {
      setError(err(e, "Couldn't update that task."));
    } finally {
      setBusyTask(null);
    }
  }

  async function removeTask(task: ProjectTask) {
    if (!confirm(`Delete "${task.title}"?`)) return;
    setBusyTask(task._id);
    try {
      await pmApi.deleteProjectTask(project._id, task._id);
      onChanged({ ...project, tasks: project.tasks.filter((t) => t._id !== task._id) });
    } catch (e) {
      setError(err(e, "Couldn't delete that task."));
    } finally {
      setBusyTask(null);
    }
  }

  async function removeProject() {
    if (!confirm(`Delete project "${project.name}"? This can't be undone.`)) return;
    try {
      await pmApi.deleteProject(project._id);
      onDeleted();
    } catch (e) {
      setError(err(e, "Couldn't delete this project."));
    }
  }

  const columns = TASK_STATUSES;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button onClick={onBack} className="text-sm text-slate-500 hover:text-slate-700">← Projects</button>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowNewTask(true)} className="rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white">
            Add task
          </button>
          <button onClick={removeProject} className="rounded-md border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50">
            Delete project
          </button>
        </div>
      </div>

      <div>
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-medium text-slate-900">{project.name}</h3>
          <span className={`rounded px-2 py-0.5 text-xs ${statusColors[project.status]}`}>{project.status}</span>
        </div>
        {project.description && <p className="mt-1 text-sm text-slate-500">{project.description}</p>}
        <div className="mt-1 text-xs text-slate-400">
          {project.manager && `Manager: ${project.manager} · `}
          {project.startDate && `${project.startDate} → ${project.endDate || '—'}`}
        </div>
      </div>

      {error && <div className="rounded-md bg-red-50 p-2 text-xs text-red-700">{error}</div>}

      <div className="flex gap-3 overflow-x-auto pb-2">
        {columns.map((col) => {
          const tasks = project.tasks.filter((t) => t.status === col);
          return (
            <div key={col} className="w-64 shrink-0">
              <div className="mb-2 flex items-center justify-between text-xs font-medium text-slate-500">
                <span>{col}</span>
                <span className="text-slate-400">{tasks.length}</span>
              </div>
              <div className="flex flex-col gap-2">
                {tasks.map((t) => (
                  <div key={t._id} className="rounded-lg border border-slate-200 bg-white p-3">
                    <div className="flex items-start justify-between gap-2">
                      <button onClick={() => setEditTask(t)} className="text-left text-sm text-slate-900 hover:underline">
                        {t.title}
                      </button>
                      <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs ${priorityColors[t.priority]}`}>{t.priority}</span>
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      Due {t.dueDate}
                      {t.assignedToId.length > 0 && ` · ${t.assignedToId.map(nameFor).join(', ')}`}
                    </div>
                    <div className="mt-2 flex items-center gap-1.5">
                      <select
                        value={t.status}
                        onChange={(e) => changeStatus(t, e.target.value as TaskStatus)}
                        disabled={busyTask === t._id}
                        className="flex-1 rounded border border-slate-200 px-1.5 py-1 text-xs disabled:opacity-50"
                      >
                        {TASK_STATUSES.map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                      <button
                        onClick={() => removeTask(t)}
                        disabled={busyTask === t._id}
                        className="rounded px-1.5 py-1 text-xs text-slate-400 hover:text-red-600 disabled:opacity-50"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
                {tasks.length === 0 && <div className="rounded-lg border border-dashed border-slate-200 p-3 text-center text-xs text-slate-400">—</div>}
              </div>
            </div>
          );
        })}
      </div>

      {showNewTask && (
        <TaskModal
          title="Add task"
          employees={employees}
          onClose={() => setShowNewTask(false)}
          onSubmit={async (input) => {
            const { data } = await pmApi.addProjectTask(project._id, input);
            onChanged(data.project);
            setShowNewTask(false);
          }}
        />
      )}

      {editTask && (
        <TaskModal
          title="Edit task"
          employees={employees}
          initial={editTask}
          onClose={() => setEditTask(null)}
          onSubmit={async (input) => {
            const { data } = await pmApi.updateProjectTask(project._id, editTask._id, input);
            onChanged(data.project);
            setEditTask(null);
          }}
        />
      )}
    </div>
  );
}

function TaskModal({
  title,
  employees,
  initial,
  onClose,
  onSubmit,
}: {
  title: string;
  employees: Employee[];
  initial?: ProjectTask;
  onClose: () => void;
  onSubmit: (input: NewTaskInput) => Promise<void>;
}) {
  const [t, setT] = useState(initial?.title ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [assignedToId, setAssignedToId] = useState<string[]>(initial?.assignedToId ?? []);
  const [priority, setPriority] = useState<TaskPriority>(initial?.priority ?? 'Medium');
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? '');
  const [status, setStatus] = useState<TaskStatus>(initial?.status ?? 'Assigned');
  const [estimatedHours, setEstimatedHours] = useState(initial?.estimatedHours ?? 0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleAssignee(id: string) {
    setAssignedToId((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  }

  async function submit() {
    if (!t.trim() || !dueDate) return;
    setSaving(true);
    setError(null);
    try {
      await onSubmit({
        title: t.trim(),
        description: description.trim() || undefined,
        assignedToId,
        priority,
        dueDate,
        status,
        estimatedHours: estimatedHours || 0,
      });
    } catch (e) {
      setError(err(e, "Couldn't save that task."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal onClose={onClose} title={title}>
      <div className="flex flex-col gap-3">
        <Field label="Title">
          <input value={t} onChange={(e) => setT(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm" autoFocus />
        </Field>
        <Field label="Description">
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Due date (required)">
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm" />
          </Field>
          <Field label="Estimated hours">
            <input type="number" min={0} value={estimatedHours} onChange={(e) => setEstimatedHours(Number(e.target.value))} className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm" />
          </Field>
          <Field label="Priority">
            <select value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)} className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm">
              {TASK_PRIORITIES.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </Field>
          <Field label="Status">
            <select value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)} className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm">
              {TASK_STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Assignees">
          <div className="flex max-h-32 flex-col gap-1 overflow-y-auto rounded-md border border-slate-200 p-2">
            {employees.length === 0 && <span className="text-xs text-slate-400">No employees loaded.</span>}
            {employees.map((e) => (
              <label key={e.employeeId} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={assignedToId.includes(e.employeeId)} onChange={() => toggleAssignee(e.employeeId)} />
                {e.name}
              </label>
            ))}
          </div>
        </Field>
        {error && <div className="rounded-md bg-red-50 p-2 text-xs text-red-700">{error}</div>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700">Cancel</button>
          <button onClick={submit} disabled={saving || !t.trim() || !dueDate} className="rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-500">{label}</span>
      {children}
    </label>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl bg-white p-5 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h4 className="text-base font-medium text-slate-900">{title}</h4>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
