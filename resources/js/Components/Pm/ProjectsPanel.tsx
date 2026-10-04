import { useEffect, useState } from 'react';
import { pmApi } from '../../lib/pmApi';
import type { Project, ProjectStatus } from '../../types/pm';
import { setUrlParams, useUrlParam } from '../../lib/urlState';
import { PROJECT_STATUSES } from '../../types/pm';
import ProjectWorkspace, { ColorPicker } from './Projects/ProjectWorkspace';
import {
  Badge,
  ErrorNote,
  Field,
  Modal,
  ProgressBar,
  err,
  ghostBtn,
  inputCls,
  primaryBtn,
  projectProgress,
  projectStatusColors,
  today,
  useEmployees,
} from './Projects/ui';

/**
 * Project tab — a live mirror of Taskmandu's Projects area: project list,
 * and per project the Details / Tasks (board + list + task detail with
 * sub-tasks and comments) / Documents / Secrets / Members views.
 * Everything is fetched from and written to Taskmandu via /pm/projects/*.
 */
export default function ProjectsPanel() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<ProjectStatus | 'All'>('All');
  const [health, setHealth] = useState<Record<string, any>>({});

  // Which project is open lives in the URL (?project=<id>), not in React state.
  const openId = useUrlParam('project');
  const openProject = (id: string) => setUrlParams({ project: id, ptab: null, task: null, sub: null });
  const closeProject = () => setUrlParams({ project: null, ptab: null, task: null, sub: null });

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const { data } = await pmApi.projects();
      setProjects(data.projects);
      const h = await pmApi.projectHealth();
      setHealth(Object.fromEntries(h.data.health.map((x: any) => [x.project_id, x])));
    } catch (e) {
      setError(err(e, "Couldn't load projects from Taskmandu."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  // A URL pointing at a project that no longer exists (renamed/deleted).
  useEffect(() => {
    if (!openId || loading || error) return;
    if (!projects.some((p) => p._id === openId)) {
      setError("That project wasn't found in Taskmandu — it may have been renamed or deleted.");
      setUrlParams({ project: null, ptab: null, task: null, sub: null }, { replace: true });
    }
  }, [openId, loading, error, projects]);

  const open = projects.find((p) => p._id === openId) ?? null;

  if (openId && loading) return <p className="text-sm text-slate-500">Loading project…</p>;

  if (open) {
    return (
      <ProjectWorkspace
        key={open._id}
        project={open}
        onBack={closeProject}
        onChanged={(updated) => setProjects((ps) => ps.map((p) => (p._id === updated._id ? updated : p)))}
        onDeleted={() => {
          setProjects((ps) => ps.filter((p) => p._id !== open._id));
          closeProject();
        }}
      />
    );
  }

  // Search + status filter are client-side (like Taskmandu's list page) — we already hold every project.
  const q = search.trim().toLowerCase();
  const filtered = projects.filter((p) => {
    const matchesSearch = !q || p.name.toLowerCase().includes(q) || p.manager.toLowerCase().includes(q) || p.description.toLowerCase().includes(q);
    return matchesSearch && (statusFilter === 'All' || p.status === statusFilter);
  });

  const totalTasks = projects.reduce((n, p) => n + p.tasks.length, 0);
  const doneTasks = projects.reduce((n, p) => n + p.tasks.filter((t) => t.status === 'Completed').length, 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search projects…"
          className="min-w-[160px] flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
        />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as ProjectStatus | 'All')} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm">
          <option value="All">All statuses</option>
          {PROJECT_STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <button onClick={load} disabled={loading} className={`${ghostBtn} disabled:opacity-50`}>Refresh</button>
        <button onClick={() => setShowNew(true)} className={primaryBtn}>New project</button>
      </div>

      {projects.length > 0 && (
        <p className="text-xs text-slate-400">
          {projects.length} project{projects.length === 1 ? '' : 's'} · {totalTasks} task{totalTasks === 1 ? '' : 's'} · {doneTasks} done
        </p>
      )}

      <ErrorNote message={error} />
      {loading && <p className="text-sm text-slate-500">Loading projects…</p>}

      {!loading && !error && projects.length === 0 && <p className="text-sm text-slate-500">No projects found in Taskmandu.</p>}
      {!loading && projects.length > 0 && filtered.length === 0 && <p className="text-sm text-slate-500">No projects match that filter.</p>}

      <div className="grid gap-2 sm:grid-cols-2">
        {filtered.map((p) => {
          const progress = projectProgress(p);
          return (
            <button key={p._id} onClick={() => openProject(p._id)} className="rounded-xl border border-slate-200 bg-white p-4 text-left hover:border-slate-300">
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${p.color || 'bg-slate-300'}`} />
                  <div className="truncate font-medium text-slate-900">{p.name}</div>
                </div>
                <div className="flex items-center gap-1.5">
                  {health[p._id] && <span className={"rounded-full px-2 py-0.5 text-[10px] font-medium " + (health[p._id].health === 'red' ? 'bg-red-100 text-red-700' : health[p._id].health === 'amber' ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700')}>Health {health[p._id].score}</span>}
                  <Badge className={projectStatusColors[p.status]}>{p.status}</Badge>
                </div>
              </div>
              {p.description && <div className="mt-1 line-clamp-2 text-xs text-slate-500">{p.description}</div>}
              {progress.total > 0 && <ProgressBar pct={progress.pct} className="mt-3" />}
              <div className="mt-2 text-xs text-slate-400">
                {progress.total} task{progress.total === 1 ? '' : 's'} · {progress.done} done · {p.members.length} member{p.members.length === 1 ? '' : 's'}
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
            openProject(p._id);
          }}
        />
      )}
    </div>
  );
}

function NewProjectModal({ onClose, onCreated }: { onClose: () => void; onCreated: (p: Project) => void }) {
  const { employees } = useEmployees();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<ProjectStatus>('Active');
  const [manager, setManager] = useState('');
  const [startDate, setStartDate] = useState(today());
  const [endDate, setEndDate] = useState(today(90));
  const [color, setColor] = useState('bg-teal-500');
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
        startDate: startDate || null,
        endDate: endDate || null,
        color,
      });
      onCreated(data.project);
    } catch (e) {
      setError(err(e, "Couldn't create the project."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="New project" onClose={onClose}>
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
            <input value={manager} onChange={(e) => setManager(e.target.value)} list="pm-new-managers" maxLength={100} className={inputCls} />
            <datalist id="pm-new-managers">
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
          <button onClick={submit} disabled={saving || !name.trim()} className={primaryBtn}>{saving ? 'Creating…' : 'Create project'}</button>
        </div>
      </div>
    </Modal>
  );
}
