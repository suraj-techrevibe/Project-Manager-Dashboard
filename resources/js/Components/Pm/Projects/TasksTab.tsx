import { useState } from 'react';
import { setUrlParams, useUrlParam } from '../../../lib/urlState';
import { pmApi } from '../../../lib/pmApi';
import type { Employee, NewTaskInput, Project, ProjectTask, TaskPriority, TaskStatus } from '../../../types/pm';
import { TASK_PRIORITIES, TASK_STATUSES } from '../../../types/pm';
import TaskDetail from './TaskDetail';
import {
  AssigneePicker,
  Avatar,
  Badge,
  ErrorNote,
  Field,
  Modal,
  formatDate,
  ghostBtn,
  inputCls,
  isOverdue,
  primaryBtn,
  priorityColors,
  taskProgress,
  taskStatusColors,
  today,
  err,
} from './ui';

// Same four columns Taskmandu's board uses.
const COLUMNS: { title: string; statuses: TaskStatus[]; accent: string }[] = [
  { title: 'Backlog', statuses: ['Assigned', 'Pending'], accent: 'border-t-slate-400' },
  { title: 'In Progress', statuses: ['In Progress'], accent: 'border-t-blue-500' },
  { title: 'Blocked', statuses: ['Blocked'], accent: 'border-t-red-500' },
  { title: 'Done', statuses: ['Completed', 'Cancelled'], accent: 'border-t-green-500' },
];

export default function TasksTab({
  project,
  employees,
  nameFor,
  onChanged,
}: {
  project: Project;
  employees: Employee[];
  nameFor: (employeeId: string) => string;
  onChanged: (p: Project) => void;
}) {
  const [view, setView] = useState<'board' | 'list'>('board');
  // The open task is in the URL (?task=<id>) so it survives reload / Back.
  const openTaskId = useUrlParam('task');
  const setOpenTaskId = (id: string | null) => setUrlParams({ task: id, sub: null });
  const [createStatus, setCreateStatus] = useState<TaskStatus | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const openTask = project.tasks.find((t) => t._id === openTaskId) ?? null;

  if (openTask) {
    return (
      <TaskDetail
        project={project}
        task={openTask}
        employees={employees}
        nameFor={nameFor}
        onChanged={onChanged}
        onBack={() => setOpenTaskId(null)}
      />
    );
  }

  async function moveTask(task: ProjectTask, status: TaskStatus) {
    if (task.status === status) return;
    setError(null);
    // Optimistic: update the board immediately, then reconcile with the server.
    onChanged({ ...project, tasks: project.tasks.map((t) => (t._id === task._id ? { ...t, status } : t)) });
    try {
      const { data } = await pmApi.updateProjectTask(project._id, task._id, { status });
      onChanged(data.project);
    } catch (e) {
      setError(err(e, "Couldn't move that task."));
      try {
        const { data } = await pmApi.project(project._id);
        onChanged(data.project);
      } catch {
        /* keep optimistic state; error banner already shown */
      }
    }
  }

  function drop(statuses: TaskStatus[]) {
    const task = project.tasks.find((t) => t._id === dragId);
    setDragId(null);
    setDragOver(null);
    if (!task || statuses.includes(task.status)) return;
    moveTask(task, statuses.includes('Completed') ? 'Completed' : statuses[0]);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1">
          {(['board', 'list'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`rounded-md px-3 py-1 text-sm capitalize ${view === v ? 'bg-indigo-600 text-white' : 'border border-slate-200 text-slate-600 hover:bg-slate-50'}`}
            >
              {v}
            </button>
          ))}
        </div>
        <button onClick={() => setCreateStatus('Assigned')} className={primaryBtn}>Add task</button>
      </div>

      <ErrorNote message={error} />

      {view === 'board' ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {COLUMNS.map((col) => {
            const tasks = project.tasks.filter((t) => col.statuses.includes(t.status));
            const isOver = dragOver === col.title && dragId !== null;
            return (
              <div
                key={col.title}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(col.title);
                }}
                onDragLeave={() => setDragOver((c) => (c === col.title ? null : c))}
                onDrop={(e) => {
                  e.preventDefault();
                  drop(col.statuses);
                }}
                className={`flex flex-col gap-2 rounded-xl border border-t-4 bg-slate-50 p-2 ${col.accent} ${isOver ? 'ring-2 ring-slate-400/40' : 'border-slate-200'}`}
              >
                <div className="flex items-center justify-between px-1 text-xs font-medium text-slate-600">
                  <span>{col.title} <span className="text-slate-400">{tasks.length}</span></span>
                  <button onClick={() => setCreateStatus(col.statuses[0])} className="text-slate-400 hover:text-slate-700" title={`Add to ${col.title}`}>＋</button>
                </div>
                {tasks.map((t) => (
                  <TaskCard
                    key={t._id}
                    task={t}
                    nameFor={nameFor}
                    dragging={dragId === t._id}
                    highlighted={false}
                    onDragStart={() => setDragId(t._id)}
                    onDragEnd={() => {
                      setDragId(null);
                      setDragOver(null);
                    }}
                    onOpen={() => setOpenTaskId(t._id)}
                  />
                ))}
                {tasks.length === 0 && <div className="rounded-lg border border-dashed border-slate-200 p-3 text-center text-xs text-slate-400">—</div>}
              </div>
            );
          })}
        </div>
      ) : (
        <TaskList project={project} nameFor={nameFor} onOpen={setOpenTaskId} onMove={moveTask} />
      )}

      {createStatus && (
        <NewTaskModal
          employees={employees}
          defaultStatus={createStatus}
          onClose={() => setCreateStatus(null)}
          onSubmit={async (input) => {
            const { data } = await pmApi.addProjectTask(project._id, input);
            onChanged(data.project);
            setCreateStatus(null);
          }}
        />
      )}
    </div>
  );
}

function TaskCard({
  task,
  nameFor,
  dragging,
  highlighted,
  onDragStart,
  onDragEnd,
  onOpen,
}: {
  task: ProjectTask;
  nameFor: (id: string) => string;
  dragging: boolean;
  highlighted: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onOpen: () => void;
}) {
  const sub = taskProgress(task);
  const overdue = isOverdue(task);

  return (
    <div
      id={`task-${task._id}`}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={`cursor-grab rounded-lg border bg-white p-3 transition active:cursor-grabbing ${dragging ? 'opacity-40' : ''} ${
        highlighted ? 'border-indigo-600 ring-2 ring-indigo-500/30' : 'border-slate-200'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <button onClick={onOpen} className="text-left text-sm text-slate-900 hover:underline">{task.title}</button>
        <Badge className={priorityColors[task.priority]}>{task.priority}</Badge>
      </div>

      {task.tags.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {task.tags.slice(0, 3).map((tag) => (
            <span key={tag} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">{tag}</span>
          ))}
        </div>
      )}

      <div className={`mt-1.5 text-xs ${overdue ? 'font-medium text-red-600' : 'text-slate-500'}`}>
        Due {formatDate(task.dueDate)}{overdue && ' · overdue'}
      </div>

      <div className="mt-2 flex items-center justify-between">
        <div className="flex -space-x-1">
          {task.assignedToId.slice(0, 3).map((id) => (
            <Avatar key={id} name={nameFor(id)} size="h-5 w-5 text-[9px] ring-2 ring-white" />
          ))}
          {task.assignedToId.length > 3 && <span className="pl-2 text-[10px] text-slate-400">+{task.assignedToId.length - 3}</span>}
        </div>
        <div className="flex items-center gap-2 text-[11px] text-slate-400">
          {sub.total > 0 && <span title="Sub-tasks done">☑ {sub.done}/{sub.total}</span>}
          {task.comments.length > 0 && <span title="Comments">💬 {task.comments.length}</span>}
        </div>
      </div>
    </div>
  );
}

function TaskList({
  project,
  nameFor,
  onOpen,
  onMove,
}: {
  project: Project;
  nameFor: (id: string) => string;
  onOpen: (id: string) => void;
  onMove: (task: ProjectTask, status: TaskStatus) => void;
}) {
  if (project.tasks.length === 0) {
    return <div className="rounded-lg border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">No tasks yet.</div>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
          <tr>
            <th className="px-3 py-2 font-medium">Task</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">Priority</th>
            <th className="px-3 py-2 font-medium">Due</th>
            <th className="px-3 py-2 font-medium">Assignees</th>
            <th className="px-3 py-2 font-medium">Sub-tasks</th>
          </tr>
        </thead>
        <tbody>
          {project.tasks.map((t) => {
            const sub = taskProgress(t);
            return (
              <tr key={t._id} className="border-b border-slate-100 last:border-0">
                <td className="px-3 py-2">
                  <button onClick={() => onOpen(t._id)} className="text-left text-slate-900 hover:underline">{t.title}</button>
                </td>
                <td className="px-3 py-2">
                  <select
                    value={t.status}
                    onChange={(e) => onMove(t, e.target.value as TaskStatus)}
                    className={`rounded border-0 px-1.5 py-0.5 text-xs ${taskStatusColors[t.status]}`}
                  >
                    {TASK_STATUSES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2"><Badge className={priorityColors[t.priority]}>{t.priority}</Badge></td>
                <td className={`px-3 py-2 text-xs ${isOverdue(t) ? 'font-medium text-red-600' : 'text-slate-500'}`}>{formatDate(t.dueDate)}</td>
                <td className="px-3 py-2 text-xs text-slate-500">{t.assignedToId.map(nameFor).join(', ') || '—'}</td>
                <td className="px-3 py-2 text-xs text-slate-500">{sub.total ? `${sub.done}/${sub.total}` : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function NewTaskModal({
  employees,
  defaultStatus,
  onClose,
  onSubmit,
}: {
  employees: Employee[];
  defaultStatus: TaskStatus;
  onClose: () => void;
  onSubmit: (input: NewTaskInput) => Promise<void>;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assignedToId, setAssignedToId] = useState<string[]>([]);
  const [priority, setPriority] = useState<TaskPriority>('Medium');
  const [dueDate, setDueDate] = useState(today());
  const [estimatedHours, setEstimatedHours] = useState(4);
  const [status, setStatus] = useState<TaskStatus>(defaultStatus);
  const [tags, setTags] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!title.trim() || !dueDate) return;
    setSaving(true);
    setError(null);
    try {
      await onSubmit({
        title: title.trim(),
        description: description.trim() || undefined,
        assignedToId,
        priority,
        dueDate,
        estimatedHours: estimatedHours || 0,
        status,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      });
    } catch (e) {
      setError(err(e, "Couldn't create that task."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Add task" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <Field label="Title">
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} className={inputCls} autoFocus />
        </Field>
        <Field label="Description">
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={5000} className={inputCls} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Due date (required)">
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Estimated hours">
            <input type="number" min={0} max={1000} value={estimatedHours} onChange={(e) => setEstimatedHours(Number(e.target.value))} className={inputCls} />
          </Field>
          <Field label="Priority">
            <select value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)} className={inputCls}>
              {TASK_PRIORITIES.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </Field>
          <Field label="Status">
            <select value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)} className={inputCls}>
              {TASK_STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Tags (comma separated)">
          <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Feature, Code" className={inputCls} />
        </Field>
        <Field label="Assignees">
          <AssigneePicker employees={employees} value={assignedToId} onChange={setAssignedToId} />
        </Field>
        <ErrorNote message={error} />
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={ghostBtn}>Cancel</button>
          <button onClick={submit} disabled={saving || !title.trim() || !dueDate} className={primaryBtn}>{saving ? 'Saving…' : 'Create task'}</button>
        </div>
      </div>
    </Modal>
  );
}
