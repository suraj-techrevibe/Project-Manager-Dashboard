import { useEffect, useState } from 'react';
import { setUrlParams, useUrlParam } from '../../../lib/urlState';
import { pmApi } from '../../../lib/pmApi';
import type { Employee, Project, ProjectStatus } from '../../../types/pm';
import { PROJECT_STATUSES } from '../../../types/pm';
import DocumentsTab from './DocumentsTab';
import MembersTab from './MembersTab';
import SecretsTab from './SecretsTab';
import TasksTab from './TasksTab';
import {
  Avatar,
  Badge,
  ConfirmModal,
  ErrorNote,
  Field,
  Modal,
  PROJECT_COLORS,
  ProgressBar,
  dangerBtn,
  formatDate,
  formatTimestamp,
  ghostBtn,
  inputCls,
  primaryBtn,
  projectProgress,
  projectStatusColors,
  useEmployees,
  err,
} from './ui';

type Tab = 'details' | 'tasks' | 'documents' | 'secrets' | 'members';

export default function ProjectWorkspace({
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
  const { employees, nameFor } = useEmployees();
  const tabParam = useUrlParam('ptab');
  const tab: Tab = (['details', 'tasks', 'documents', 'secrets', 'members'] as Tab[]).includes(tabParam as Tab) ? (tabParam as Tab) : 'details';
  const setTab = (t: Tab) => setUrlParams({ ptab: t === 'details' ? null : t, task: null, sub: null });
  const [showEdit, setShowEdit] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setRefreshing(true);
    setError(null);
    try {
      const { data } = await pmApi.project(project._id);
      onChanged(data.project);
    } catch (e) {
      setError(err(e, "Couldn't refresh this project."));
    } finally {
      setRefreshing(false);
    }
  }

  // The list payload can be stale (or come from a shared link), so pull this
  // project fresh from Taskmandu every time it is opened.
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project._id]);

  async function removeProject() {
    setDeleting(true);
    setError(null);
    try {
      await pmApi.deleteProject(project._id);
      onDeleted();
    } catch (e) {
      setError(err(e, "Couldn't delete this project."));
      setConfirmDelete(false);
    } finally {
      setDeleting(false);
    }
  }

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: 'details', label: 'Details' },
    { key: 'tasks', label: 'Tasks', count: project.tasks.length },
    { key: 'documents', label: 'Documents', count: project.documents.length },
    { key: 'secrets', label: 'Secrets', count: project.sharedVariables.length },
    { key: 'members', label: 'Members', count: project.members.length },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button onClick={onBack} className="text-sm text-slate-500 hover:text-slate-700">← Projects</button>
        <div className="flex items-center gap-2">
          <button onClick={refresh} disabled={refreshing} className={`${ghostBtn} disabled:opacity-50`}>{refreshing ? 'Refreshing…' : 'Refresh'}</button>
          <button onClick={() => setShowEdit(true)} className={ghostBtn}>Edit project</button>
          <button onClick={() => setConfirmDelete(true)} className={dangerBtn}>Delete project</button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className={`h-3 w-3 shrink-0 rounded-full ${project.color || 'bg-slate-300'}`} />
        <h3 className="text-lg font-medium text-slate-900">{project.name}</h3>
        <Badge className={projectStatusColors[project.status]}>{project.status}</Badge>
      </div>

      <ErrorNote message={error} />

      <div className="flex flex-wrap gap-1 border-b border-slate-200">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === t.key ? 'border-slate-900 font-medium text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
          >
            {t.label}
            {t.count !== undefined && <span className="ml-1 text-xs text-slate-400">{t.count}</span>}
          </button>
        ))}
      </div>

      {tab === 'details' && <DetailsTab project={project} />}
      {tab === 'tasks' && <TasksTab
          project={project}
          employees={employees}
          nameFor={nameFor}
          onChanged={onChanged}
        />}
      {tab === 'documents' && <DocumentsTab project={project} onChanged={onChanged} />}
      {tab === 'secrets' && <SecretsTab project={project} onChanged={onChanged} />}
      {tab === 'members' && <MembersTab project={project} onChanged={onChanged} />}

      {showEdit && (
        <EditProjectModal
          project={project}
          employees={employees}
          onClose={() => setShowEdit(false)}
          onSaved={(p) => {
            onChanged(p);
            setShowEdit(false);
          }}
        />
      )}

      {confirmDelete && (
        <ConfirmModal
          title="Delete project"
          message={`Delete "${project.name}" with all its tasks, documents and variables? This can't be undone.`}
          busy={deleting}
          onConfirm={removeProject}
          onClose={() => setConfirmDelete(false)}
        />
      )}
    </div>
  );
}

function DetailsTab({ project }: { project: Project }) {
  const progress = projectProgress(project);
  const stats = [
    { label: 'Tasks', value: project.tasks.length },
    { label: 'Completed', value: progress.done },
    { label: 'Documents', value: project.documents.length },
    { label: 'Variables', value: project.sharedVariables.length },
    { label: 'Members', value: project.members.length },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h4 className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Description</h4>
        <p className="whitespace-pre-wrap text-sm text-slate-700">{project.description || <span className="text-slate-400">No description.</span>}</p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {stats.map((s) => (
          <div key={s.label} className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="text-xl font-medium text-slate-900">{s.value}</div>
            <div className="text-xs text-slate-500">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-2 flex items-center justify-between text-xs text-slate-500">
          <span>Task progress</span>
          <span>{progress.pct}%</span>
        </div>
        <ProgressBar pct={progress.pct} />
      </div>

      <ProjectTimeline project={project} />

      <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 text-sm sm:grid-cols-2">
        <Info label="Project manager" value={project.manager || 'Unassigned'} />
        <Info label="Status" value={project.status} />
        <Info label="Start date" value={formatDate(project.startDate)} />
        <Info label="End date" value={formatDate(project.endDate)} />
        <Info label="Created" value={formatTimestamp(project.createdAt)} />
        <Info label="Last updated" value={formatTimestamp(project.updatedAt)} />
      </div>

      {project.members.length > 0 && (
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <div className="flex -space-x-1">
            {project.members.slice(0, 6).map((m) => (
              <Avatar key={m._id} name={m.name || m.email || '?'} size="h-6 w-6 text-[10px] ring-2 ring-white" />
            ))}
          </div>
          {project.members.length > 6 && <span>+{project.members.length - 6} more</span>}
        </div>
      )}
    </div>
  );
}

function ProjectTimeline({ project }: { project: Project }) {
  const tasks = [...project.tasks].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const active = tasks.filter((t) => t.status !== 'Completed' && t.status !== 'Cancelled');
  const completed = tasks.filter((t) => t.status === 'Completed').length;
  const blocked = tasks.filter((t) => t.status === 'Blocked').length;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const overdue = active.filter((t) => new Date(t.dueDate).getTime() < today.getTime()).length;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <div><h4 className="text-sm font-medium text-slate-900">Project timeline</h4><p className="text-xs text-slate-500">Schedule, delivery and upcoming task milestones.</p></div>
        <span className="text-xs text-slate-500">{completed}/{tasks.length} done</span>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2">
        <div className="rounded-lg bg-slate-50 p-2"><div className="font-medium text-slate-900">{tasks.length}</div><div className="text-[11px] text-slate-500">Total tasks</div></div>
        <div className="rounded-lg bg-slate-50 p-2"><div className="font-medium text-slate-900">{overdue}</div><div className="text-[11px] text-slate-500">Overdue</div></div>
        <div className="rounded-lg bg-slate-50 p-2"><div className="font-medium text-slate-900">{blocked}</div><div className="text-[11px] text-slate-500">Blocked</div></div>
      </div>
      <div className="mt-4 flex items-center gap-3 text-xs text-slate-500">
        <span>Start: {formatDate(project.startDate)}</span><span className="text-slate-300">→</span><span>End: {formatDate(project.endDate)}</span>
      </div>
      <div className="mt-4 border-t border-slate-100 pt-3">
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">Upcoming milestones</div>
        <div className="space-y-2">
          {active.slice(0, 6).map((t) => <div key={t._id} className="flex items-center justify-between gap-3 text-sm"><span className="truncate text-slate-700">{t.title}</span><span className="shrink-0 text-xs text-slate-500">{formatDate(t.dueDate)}</span></div>)}
          {!active.length && <div className="text-xs text-slate-400">No upcoming task milestones.</div>}
        </div>
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-slate-400">{label}</div>
      <div className="text-slate-800">{value}</div>
    </div>
  );
}

function EditProjectModal({
  project,
  employees,
  onClose,
  onSaved,
}: {
  project: Project;
  employees: Employee[];
  onClose: () => void;
  onSaved: (p: Project) => void;
}) {
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);
  const [status, setStatus] = useState<ProjectStatus>(project.status);
  const [manager, setManager] = useState(project.manager);
  const [startDate, setStartDate] = useState(project.startDate ?? '');
  const [endDate, setEndDate] = useState(project.endDate ?? '');
  const [color, setColor] = useState(project.color || 'bg-teal-500');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const { data } = await pmApi.updateProject(project._id, {
        name: name.trim(),
        description: description.trim(),
        status,
        manager: manager.trim(),
        startDate: startDate || null,
        endDate: endDate || null,
        color,
      });
      onSaved(data.project);
    } catch (e) {
      setError(err(e, "Couldn't save the project."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Edit project" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <Field label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} className={inputCls} autoFocus />
        </Field>
        <Field label="Description">
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={5000} className={inputCls} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Status">
            <select value={status} onChange={(e) => setStatus(e.target.value as ProjectStatus)} className={inputCls}>
              {PROJECT_STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </Field>
          <Field label="Manager">
            <input value={manager} onChange={(e) => setManager(e.target.value)} list="pm-managers" maxLength={100} className={inputCls} />
            <datalist id="pm-managers">
              {employees.map((e) => (
                <option key={e.employeeId} value={e.name} />
              ))}
            </datalist>
          </Field>
          <Field label="Start date">
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputCls} />
          </Field>
          <Field label="End date">
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={inputCls} />
          </Field>
        </div>
        <Field label="Color">
          <ColorPicker value={color} onChange={setColor} />
        </Field>
        <ErrorNote message={error} />
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={ghostBtn}>Cancel</button>
          <button onClick={submit} disabled={saving || !name.trim()} className={primaryBtn}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </Modal>
  );
}

export function ColorPicker({ value, onChange }: { value: string; onChange: (bg: string) => void }) {
  return (
    <div className="flex gap-2">
      {PROJECT_COLORS.map((c) => (
        <button
          key={c.bg}
          type="button"
          title={c.name}
          onClick={() => onChange(c.bg)}
          className={`h-6 w-6 rounded-full ${c.bg} ${value === c.bg ? 'ring-2 ring-slate-900 ring-offset-2' : ''}`}
        />
      ))}
    </div>
  );
}
