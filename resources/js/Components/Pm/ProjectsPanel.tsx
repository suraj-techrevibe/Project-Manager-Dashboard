import { useEffect, useState } from 'react';
import { pmApi } from '../../lib/pmApi';
import type { Project, ProjectStatus } from '../../types/pm';
import { setUrlParams, useUrlParam } from '../../lib/urlState';
import { PROJECT_STATUSES } from '../../types/pm';
import { EmptyState, JumpNav, PageHeader, Pill, Section, StatTile, btnChip, btnPrimary, btnSecondary } from './ui/kit';
import ProjectWorkspace, { ColorPicker } from './Projects/ProjectWorkspace';
import {
  Badge,
  ErrorNote,
  Field,
  Modal,
  ProgressBar,
  err,
  ghostBtn,
  isOverdue,
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
  // Quick filter driven by the overview tiles.
  const [risk, setRisk] = useState<'all' | 'overdue' | 'blocked'>('all');

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

  // Search + status + risk filters are client-side (like Taskmandu's list page) — we already hold every project.
  const q = search.trim().toLowerCase();
  const stats = (p: Project) => ({
    overdue: p.tasks.filter(isOverdue).length,
    blocked: p.tasks.filter((t) => t.status === 'Blocked').length,
  });
  const filtered = projects.filter((p) => {
    const matchesSearch = !q || p.name.toLowerCase().includes(q) || p.manager.toLowerCase().includes(q) || p.description.toLowerCase().includes(q);
    const st = stats(p);
    const matchesRisk = risk === 'all' || (risk === 'overdue' ? st.overdue > 0 : st.blocked > 0);
    return matchesSearch && matchesRisk && (statusFilter === 'All' || p.status === statusFilter);
  });

  const totalTasks = projects.reduce((n, p) => n + p.tasks.length, 0);
  const doneTasks = projects.reduce((n, p) => n + p.tasks.filter((t) => t.status === 'Completed').length, 0);
  const overdueTasks = projects.reduce((n, p) => n + stats(p).overdue, 0);
  const blockedTasks = projects.reduce((n, p) => n + stats(p).blocked, 0);
  const atRisk = projects.filter((p) => stats(p).overdue > 0 || stats(p).blocked > 0).length;
  const donePct = totalTasks ? Math.round((doneTasks / totalTasks) * 100) : 0;
  const filtersOn = Boolean(search || statusFilter !== 'All' || risk !== 'all');
  const goList = () => document.getElementById('projects-list')?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        icon="folder"
        title="Projects"
        description="Live from Taskmandu — open a project to manage its tasks, documents, secrets and members."
        status={projects.length ? `${projects.length} project${projects.length === 1 ? '' : 's'} · ${totalTasks} task${totalTasks === 1 ? '' : 's'}` : undefined}
        actions={
          <>
            <button onClick={load} disabled={loading} className={btnSecondary}>
              {loading ? 'Loading…' : 'Refresh'}
            </button>
            <button onClick={() => setShowNew(true)} className={btnPrimary}>
              + New project
            </button>
          </>
        }
        links={[
          { label: 'Today', tab: 'today' },
          { label: 'Meeting minutes', tab: 'minutes' },
          { label: 'Brief to tickets', tab: 'brief' },
          { label: 'Reports', tab: 'reports' },
        ]}
      />

      <JumpNav
        items={[
          { id: 'projects-overview', label: 'Overview' },
          { id: 'projects-list', label: 'All projects', count: projects.length },
        ]}
      />

      <ErrorNote message={error} />

      <Section id="projects-overview" title="Overview" subtitle="Click a number to filter the list below" tone="brand">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <StatTile
            label="Projects"
            value={projects.length}
            hint={atRisk ? `${atRisk} at risk` : 'none at risk'}
            active={!filtersOn}
            onClick={() => {
              setRisk('all');
              setStatusFilter('All');
              setSearch('');
              goList();
            }}
          />
          <StatTile
            label="Overdue tasks"
            value={overdueTasks}
            tone={overdueTasks ? 'danger' : 'neutral'}
            hint="projects with late tasks"
            active={risk === 'overdue'}
            onClick={() => {
              setRisk((r) => (r === 'overdue' ? 'all' : 'overdue'));
              goList();
            }}
          />
          <StatTile
            label="Blocked tasks"
            value={blockedTasks}
            tone={blockedTasks ? 'warn' : 'neutral'}
            hint="projects with blockers"
            active={risk === 'blocked'}
            onClick={() => {
              setRisk((r) => (r === 'blocked' ? 'all' : 'blocked'));
              goList();
            }}
          />
          <StatTile label="Completed" value={`${donePct}%`} tone="ok" hint={`${doneTasks} of ${totalTasks} tasks`} />
          <StatTile
            label="Active projects"
            value={projects.filter((p) => p.status === 'Active').length}
            tone="info"
            active={statusFilter === 'Active'}
            onClick={() => {
              setStatusFilter((s) => (s === 'Active' ? 'All' : 'Active'));
              goList();
            }}
          />
        </div>
      </Section>

      <Section
        id="projects-list"
        title="All projects"
        count={filtersOn ? `${filtered.length} of ${projects.length}` : projects.length}
        tone="info"
        actions={
          filtersOn ? (
            <button
              onClick={() => {
                setSearch('');
                setStatusFilter('All');
                setRisk('all');
              }}
              className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
            >
              Clear filters
            </button>
          ) : undefined
        }
      >
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search projects…"
            aria-label="Search projects"
            className="min-w-[10rem] flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          <div className="flex flex-wrap gap-1.5">
            {(['All', ...PROJECT_STATUSES] as const).map((s) => (
              <button key={s} onClick={() => setStatusFilter(s)} className={btnChip(statusFilter === s)}>
                {s}
              </button>
            ))}
          </div>
        </div>

        {loading && <p className="text-sm text-slate-500">Loading projects…</p>}
        {!loading && !error && projects.length === 0 && <EmptyState title="No projects found in Taskmandu" />}
        {!loading && projects.length > 0 && filtered.length === 0 && <EmptyState title="No projects match those filters" />}

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((p) => {
            const progress = projectProgress(p);
            const st = stats(p);
            return (
              <button
                key={p._id}
                onClick={() => openProject(p._id)}
                className="group flex flex-col rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className={`h-3 w-3 shrink-0 rounded-full ${p.color || 'bg-slate-300'}`} />
                    <div className="truncate font-semibold text-slate-900 group-hover:text-indigo-700">{p.name}</div>
                  </div>
                  <Badge className={projectStatusColors[p.status]}>{p.status}</Badge>
                </div>
                {p.description && <div className="mt-1.5 line-clamp-2 text-xs text-slate-500">{p.description}</div>}

                <div className="mt-3">
                  <div className="mb-1 flex items-center justify-between text-[11px] text-slate-400">
                    <span>
                      {progress.done}/{progress.total} tasks done
                    </span>
                    <span>{progress.pct}%</span>
                  </div>
                  <ProgressBar pct={progress.pct} />
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  {st.overdue > 0 && <Pill tone="danger">{st.overdue} overdue</Pill>}
                  {st.blocked > 0 && <Pill tone="warn">{st.blocked} blocked</Pill>}
                  {st.overdue === 0 && st.blocked === 0 && progress.total > 0 && <Pill tone="ok">On track</Pill>}
                  <span className="ml-auto text-[11px] text-slate-400">
                    {p.members.length} member{p.members.length === 1 ? '' : 's'}
                    {p.manager && ` · ${p.manager}`}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </Section>

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
