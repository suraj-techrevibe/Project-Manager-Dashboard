import { useState } from 'react';
import { setUrlParams, useUrlParam } from '../../../lib/urlState';
import { pmApi } from '../../../lib/pmApi';
import type { Employee, Project, ProjectComment, ProjectTask, SubTask, TaskPriority, TaskStatus } from '../../../types/pm';
import { TASK_PRIORITIES, TASK_STATUSES } from '../../../types/pm';
import {
  AssigneePicker,
  Avatar,
  Badge,
  ConfirmModal,
  ErrorNote,
  Field,
  dangerBtn,
  formatTimestamp,
  ghostBtn,
  inputCls,
  isOverdue,
  primaryBtn,
  priorityColors,
  taskProgress,
  taskStatusColors,
  useRunner,
} from './ui';

export default function TaskDetail({
  project,
  task,
  employees,
  nameFor,
  onChanged,
  onBack,
}: {
  project: Project;
  task: ProjectTask;
  employees: Employee[];
  nameFor: (employeeId: string) => string;
  onChanged: (p: Project) => void;
  onBack: () => void;
}) {
  const { busy, error, run } = useRunner(onChanged);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(task.title);
  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState(task.description);
  const [commentText, setCommentText] = useState('');
  const [hours, setHours] = useState(String(task.estimatedHours ?? 0));
  const [tags, setTags] = useState((task.tags ?? []).join(', '));
  const [confirmDelete, setConfirmDelete] = useState(false);

  const index = project.tasks.findIndex((t) => t._id === task._id);
  const taskKey = `${project.name.slice(0, 4).toUpperCase()}-${index + 1}`;
  const sub = taskProgress(task);

  const update = (patch: Parameters<typeof pmApi.updateProjectTask>[2], key = 'task') =>
    run(key, () => pmApi.updateProjectTask(project._id, task._id, patch), "Couldn't update that task.");

  async function saveTitle() {
    const t = titleDraft.trim();
    if (!t) return;
    if (t !== task.title && !(await update({ title: t }))) return;
    setEditingTitle(false);
  }

  async function saveDesc() {
    if (descDraft !== task.description && !(await update({ description: descDraft }))) return;
    setEditingDesc(false);
  }

  async function addComment() {
    const text = commentText.trim();
    if (!text) return;
    const ok = await run('comment', () => pmApi.addTaskComment(project._id, task._id, text), "Couldn't add that comment.");
    if (ok) setCommentText('');
  }

  function commitHours() {
    const n = Math.max(0, Number(hours) || 0);
    setHours(String(n));
    if (n !== task.estimatedHours) update({ estimatedHours: n });
  }

  function commitTags() {
    const next = tags.split(',').map((t) => t.trim()).filter(Boolean);
    if (next.join(', ') !== (task.tags ?? []).join(', ')) update({ tags: next });
  }

  async function removeTask() {
    const ok = await run('delete', () => pmApi.deleteProjectTask(project._id, task._id), "Couldn't delete that task.");
    if (ok) onBack();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <button onClick={onBack} className="text-sm text-slate-500 hover:text-slate-700">← Back to {project.name}</button>
        <button onClick={() => setConfirmDelete(true)} className={dangerBtn}>Delete task</button>
      </div>

      <div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-500">{taskKey}</span>
          <Badge className={priorityColors[task.priority]}>{task.priority}</Badge>
          <Badge className={taskStatusColors[task.status]}>{task.status}</Badge>
        </div>

        {editingTitle ? (
          <div className="mt-2 flex gap-2">
            <input value={titleDraft} onChange={(e) => setTitleDraft(e.target.value)} maxLength={200} className={inputCls} autoFocus />
            <button onClick={saveTitle} disabled={busy === 'task' || !titleDraft.trim()} className={primaryBtn}>Save</button>
            <button onClick={() => { setTitleDraft(task.title); setEditingTitle(false); }} className={ghostBtn}>Cancel</button>
          </div>
        ) : (
          <h3 className="mt-1 flex items-center gap-2 text-lg font-medium text-slate-900">
            {task.title}
            <button onClick={() => { setTitleDraft(task.title); setEditingTitle(true); }} className="text-xs font-normal text-slate-400 hover:text-slate-700">Edit</button>
          </h3>
        )}
        <p className="mt-1 text-xs text-slate-400">
          {project.name} · Created {formatTimestamp(task.createdAt)}
          {task.assignedByName && ` · Assigned by ${task.assignedByName}`}
        </p>
      </div>

      <ErrorNote message={error} />

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Main column */}
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Section title="Description" action={!editingDesc && <button onClick={() => { setDescDraft(task.description); setEditingDesc(true); }} className="text-xs text-slate-500 hover:text-slate-800">Edit</button>}>
            {editingDesc ? (
              <div className="flex flex-col gap-2">
                <textarea value={descDraft} onChange={(e) => setDescDraft(e.target.value)} rows={6} maxLength={5000} className={inputCls} autoFocus />
                <div className="flex gap-2">
                  <button onClick={saveDesc} disabled={busy === 'task'} className={primaryBtn}>Save</button>
                  <button onClick={() => setEditingDesc(false)} className={ghostBtn}>Cancel</button>
                </div>
              </div>
            ) : (
              <p className="whitespace-pre-wrap text-sm text-slate-700">{task.description || <span className="text-slate-400">No description provided.</span>}</p>
            )}
          </Section>

          <Section title={`Sub-tasks (${sub.done}/${sub.total})`}>
            <SubTasks project={project} task={task} employees={employees} nameFor={nameFor} onChanged={onChanged} />
          </Section>

          <Section title={`Comments (${task.comments.length})`}>
            <CommentList comments={task.comments} />
            <div className="mt-3 flex gap-2">
              <input
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addComment()}
                maxLength={2000}
                placeholder="Write a comment…"
                className={inputCls}
              />
              <button onClick={addComment} disabled={busy === 'comment' || !commentText.trim()} className={primaryBtn}>Post</button>
            </div>
          </Section>
        </div>

        {/* Sidebar */}
        <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 self-start">
          <Field label="Status">
            <select value={task.status} onChange={(e) => update({ status: e.target.value as TaskStatus })} disabled={busy === 'task'} className={inputCls}>
              {TASK_STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </Field>
          <Field label="Priority">
            <select value={task.priority} onChange={(e) => update({ priority: e.target.value as TaskPriority })} disabled={busy === 'task'} className={inputCls}>
              {TASK_PRIORITIES.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </Field>
          <Field label={isOverdue(task) ? 'Due date (overdue)' : 'Due date'}>
            <input
              type="date"
              value={task.dueDate}
              onChange={(e) => e.target.value && update({ dueDate: e.target.value })}
              className={`${inputCls} ${isOverdue(task) ? 'border-red-300 text-red-600' : ''}`}
            />
          </Field>
          <Field label="Estimated hours">
            <input type="number" min={0} max={1000} value={hours} onChange={(e) => setHours(e.target.value)} onBlur={commitHours} className={inputCls} />
          </Field>
          <Field label="Tags (comma separated)">
            <input value={tags} onChange={(e) => setTags(e.target.value)} onBlur={commitTags} className={inputCls} />
          </Field>
          <Field label={`Assignees (${task.assignedToId.length})`}>
            <AssigneePicker employees={employees} value={task.assignedToId} onChange={(ids) => update({ assignedToId: ids })} />
          </Field>
        </div>
      </div>

      {confirmDelete && (
        <ConfirmModal
          title="Delete task"
          message={`Delete "${task.title}" along with its sub-tasks and comments? This can't be undone.`}
          busy={busy === 'delete'}
          onConfirm={removeTask}
          onClose={() => setConfirmDelete(false)}
        />
      )}
    </div>
  );
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-xs font-medium uppercase tracking-wide text-slate-500">{title}</h4>
        {action}
      </div>
      {children}
    </div>
  );
}

function CommentList({ comments }: { comments: ProjectComment[] }) {
  if (comments.length === 0) return <p className="text-sm text-slate-400">No comments yet.</p>;

  return (
    <div className="flex flex-col gap-3">
      {comments.map((c) => (
        <div key={c._id} className="flex gap-2">
          <Avatar name={c.authorName || '?'} />
          <div className="min-w-0">
            <div className="text-xs text-slate-500">
              <span className="font-medium text-slate-700">{c.authorName || 'Unknown'}</span>
              {c.authorRole && ` · ${c.authorRole}`} · {formatTimestamp(c.createdAt)}
            </div>
            <p className="whitespace-pre-wrap text-sm text-slate-700">{c.text}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function SubTasks({
  project,
  task,
  employees,
  nameFor,
  onChanged,
}: {
  project: Project;
  task: ProjectTask;
  employees: Employee[];
  nameFor: (employeeId: string) => string;
  onChanged: (p: Project) => void;
}) {
  const { busy, error, run } = useRunner(onChanged);
  const [title, setTitle] = useState('');
  const [assignees, setAssignees] = useState<string[]>([]);
  const [showAssignees, setShowAssignees] = useState(false);
  // The expanded sub-task is in the URL (?sub=<id>).
  const openSub = useUrlParam('sub');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [deleting, setDeleting] = useState<SubTask | null>(null);

  async function add() {
    const t = title.trim();
    if (!t) return;
    const ok = await run('new', () => pmApi.addSubTask(project._id, task._id, { title: t, assignedToId: assignees }), "Couldn't add that sub-task.");
    if (ok) {
      setTitle('');
      setAssignees([]);
      setShowAssignees(false);
    }
  }

  // Same toggle Taskmandu uses: done ↔ in progress.
  const toggle = (s: SubTask) =>
    run(s._id, () => pmApi.updateSubTask(project._id, task._id, s._id, { status: s.status === 'Completed' ? 'In Progress' : 'Completed' }), "Couldn't update that sub-task.");

  const setStatus = (s: SubTask, status: TaskStatus) =>
    run(s._id, () => pmApi.updateSubTask(project._id, task._id, s._id, { status }), "Couldn't update that sub-task.");

  async function comment(s: SubTask) {
    const text = (drafts[s._id] ?? '').trim();
    if (!text) return;
    const ok = await run(`c-${s._id}`, () => pmApi.addSubTaskComment(project._id, task._id, s._id, text), "Couldn't add that comment.");
    if (ok) setDrafts((d) => ({ ...d, [s._id]: '' }));
  }

  async function confirmDelete() {
    if (!deleting) return;
    const ok = await run(deleting._id, () => pmApi.deleteSubTask(project._id, task._id, deleting._id), "Couldn't delete that sub-task.");
    if (ok) setDeleting(null);
  }

  return (
    <div className="flex flex-col gap-2">
      <ErrorNote message={error} />

      {task.subTasks.length === 0 && <p className="text-sm text-slate-400">No sub-tasks yet.</p>}

      {task.subTasks.map((s) => {
        const done = s.status === 'Completed';
        const open = openSub === s._id;
        return (
          <div key={s._id} className="rounded-lg border border-slate-100 p-2">
            <div className="flex items-start gap-2">
              <input type="checkbox" checked={done} onChange={() => toggle(s)} disabled={busy === s._id} className="mt-1" />
              <div className="min-w-0 flex-1">
                <div className={`text-sm ${done ? 'text-slate-400 line-through' : 'text-slate-800'}`}>{s.title}</div>
                {s.assignedToId.length > 0 && <div className="text-xs text-slate-400">{s.assignedToId.map(nameFor).join(', ')}</div>}
              </div>
              <select
                value={s.status}
                onChange={(e) => setStatus(s, e.target.value as TaskStatus)}
                disabled={busy === s._id}
                className={`shrink-0 rounded border-0 px-1.5 py-0.5 text-xs ${taskStatusColors[s.status]}`}
              >
                {TASK_STATUSES.map((st) => (
                  <option key={st} value={st}>{st}</option>
                ))}
              </select>
              <button onClick={() => setUrlParams({ sub: open ? null : s._id })} className="shrink-0 text-xs text-slate-400 hover:text-slate-700" title="Comments">
                💬 {s.comments.length}
              </button>
              <button onClick={() => setDeleting(s)} disabled={busy === s._id} className="shrink-0 text-xs text-slate-300 hover:text-red-600 disabled:opacity-50" title="Delete sub-task">✕</button>
            </div>

            {open && (
              <div className="ml-6 mt-2 flex flex-col gap-2 border-l border-slate-100 pl-3">
                <CommentList comments={s.comments} />
                <div className="flex gap-2">
                  <input
                    value={drafts[s._id] ?? ''}
                    onChange={(e) => setDrafts((d) => ({ ...d, [s._id]: e.target.value }))}
                    onKeyDown={(e) => e.key === 'Enter' && comment(s)}
                    maxLength={2000}
                    placeholder="Comment…"
                    className="min-w-0 flex-1 rounded border border-slate-200 px-2 py-1 text-xs"
                  />
                  <button onClick={() => comment(s)} disabled={busy === `c-${s._id}` || !(drafts[s._id] ?? '').trim()} className="rounded bg-indigo-600 px-2 py-1 text-xs text-white disabled:opacity-50">
                    Post
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      <div className="mt-1 flex flex-col gap-2 rounded-lg border border-slate-200 p-2">
        <div className="flex gap-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            maxLength={200}
            placeholder="Add a sub-task…"
            className={inputCls}
          />
          <button onClick={add} disabled={busy === 'new' || !title.trim()} className={primaryBtn}>Add</button>
        </div>
        <button onClick={() => setShowAssignees((v) => !v)} className="self-start text-xs text-slate-500 hover:text-slate-800">
          {showAssignees ? '▾' : '▸'} Assignees{assignees.length > 0 && ` (${assignees.length})`}
        </button>
        {showAssignees && <AssigneePicker employees={employees} value={assignees} onChange={setAssignees} />}
      </div>

      {deleting && (
        <ConfirmModal
          title="Delete sub-task"
          message={`Delete "${deleting.title}" and all its comments?`}
          busy={busy === deleting._id}
          onConfirm={confirmDelete}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
