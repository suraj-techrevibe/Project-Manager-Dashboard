import { useEffect, useRef, useState } from 'react';
import { pmApi } from '../../lib/pmApi';
import type { Project, ProjectStatus, TaskFocus } from '../../types/pm';
import TasksPage from './TasksPage';
import type { AllTask } from './AllTasksPanel';
import { setUrlParams, useUrlParam } from '../../lib/urlState';
import { PROJECT_STATUSES } from '../../types/pm';
import { EmptyState, JumpNav, PageHeader, Pill, Section, SortSelect, StatTile, btnChip, btnPrimary, btnSecondary, compareDates, type SortOption } from './ui/kit';
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
type ProjectSort = 'attention' | 'end-asc' | 'end-desc' | 'start-desc' | 'start-asc' | 'created-desc' | 'created-asc' | 'updated-desc';
const PROJECT_SORTS: SortOption<ProjectSort>[] = [
  { value: 'attention', label: 'Sort: needs attention first' },
  { value: 'end-asc', label: 'End date: soonest first' },
  { value: 'end-desc', label: 'End date: latest first' },
  { value: 'start-desc', label: 'Start date: newest first' },
  { value: 'start-asc', label: 'Start date: oldest first' },
  { value: 'created-desc', label: 'Created: newest first' },
  { value: 'created-asc', label: 'Created: oldest first' },
  { value: 'updated-desc', label: 'Recently updated' },
];

export default function ProjectsPanel({
  seedProjects = [],
  onProjectsChange,
  tasks = null,
  tasksLoading = false,
  tasksError = null,
  onRetryTasks,
  onOpenTask,
}: {
  /** Projects the app already loaded (e.g. for All tasks). Shown immediately so opening a task never waits on a re-fetch. */
  seedProjects?: Project[];
  /** Called when this tab changes its project list, so other tabs don't go stale. */
  onProjectsChange?: (projects: Project[]) => void;
  tasks?: AllTask[] | null;
  tasksLoading?: boolean;
  tasksError?: string | null;
  onRetryTasks?: () => void;
  onOpenTask?: (focus: TaskFocus) => void;
}) {
  const [projects, setProjects] = useState<Project[]>(seedProjects);
  const [loading, setLoading] = useState(seedProjects.length === 0);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [workspaceView, setWorkspaceView] = useState<'projects' | 'tasks'>('projects');
  const quickTaskParam = useUrlParam('tq');
  const legacyTasksPath = typeof window !== 'undefined' && window.location.pathname.replace(/\/+$/, '') === '/pm/tasks';
  useEffect(() => { if (quickTaskParam || legacyTasksPath) setWorkspaceView('tasks'); }, [quickTaskParam, legacyTasksPath]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<ProjectStatus | 'All'>('All');
  const [sort, setSort] = useState<ProjectSort>('attention');
  // Quick filter driven by the overview tiles.
  const [risk, setRisk] = useState<'all' | 'overdue' | 'blocked'>('all');
  const [health, setHealth] = useState<Record<string, any>>({});

  // Which project is open lives in the URL (?project=<id>), not in React state.
  const openId = useUrlParam('project');
  const openProject = (id: string) => setUrlParams({ project: id, ptab: null, task: null, sub: null });
  const closeProject = () => setUrlParams({ project: null, ptab: null, task: null, sub: null });

  async function load() {
    // With projects already on screen, refresh quietly instead of swapping the view for a spinner.
    if (projects.length === 0) setLoading(true);
    setError(null);
    try {
      const { data } = await pmApi.projects();
      // A refresh that comes back empty must not wipe projects we already hold.
      setProjects((prev) => (data.projects.length === 0 && prev.length > 0 ? prev : data.projects));
      // Health badges are optional — if that endpoint fails the projects still load.
      try {
        const h = await pmApi.projectHealth();
        setHealth(Object.fromEntries(h.data.health.map((x: any) => [x.project_id, x])));
      } catch {
        setHealth({});
      }
    } catch (e) {
      setError(err(e, "Couldn't load projects from Taskmandu."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  // Keep the rest of the app (All tasks, Today) in step with edits made here.
  const firstProjects = useRef(true);
  useEffect(() => {
    if (firstProjects.current) {
      firstProjects.current = false;
      return;
    }
    onProjectsChange?.(projects);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects]);

  // A URL pointing at a project the list doesn't have. First try fetching that one project directly
  // (the list can fail or be slow while a single project still loads); only then say it wasn't found.
  const lookedUp = useRef<string | null>(null);
  useEffect(() => {
    if (!openId || loading) return;
    if (projects.some((p) => p._id === openId)) return;
    if (lookedUp.current === openId) return;
    lookedUp.current = openId;
    pmApi
      .project(openId)
      .then(({ data }) => {
        setProjects((ps) => (ps.some((p) => p._id === data.project._id) ? ps : [...ps, data.project]));
        setError(null);
      })
      .catch(() => {
        setError("That project wasn't found in Taskmandu — it may have been renamed or deleted.");
        setUrlParams({ project: null, ptab: null, task: null, sub: null }, { replace: true });
      });
  }, [openId, loading, projects]);

  const open = projects.find((p) => p._id === openId) ?? null;
  const workspaceNav = <div role="tablist" aria-label="Projects workspace" className="flex gap-1 border-b border-slate-200"><button type="button" role="tab" aria-selected={workspaceView === 'projects'} onClick={() => setWorkspaceView('projects')} className={'border-b-2 px-4 py-2.5 text-sm font-medium ' + (workspaceView === 'projects' ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500')}>Projects</button><button type="button" role="tab" aria-selected={workspaceView === 'tasks'} onClick={() => setWorkspaceView('tasks')} className={'border-b-2 px-4 py-2.5 text-sm font-medium ' + (workspaceView === 'tasks' ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500')}>All tasks</button></div>;

  if (workspaceView === 'tasks') return <div className="flex flex-col gap-4">{workspaceNav}<TasksPage tasks={tasks} loading={tasksLoading} error={tasksError} onRetry={onRetryTasks ?? (() => undefined)} projects={projects} projectsLoading={loading} onOpenTask={onOpenTask ?? (() => undefined)} onProjectChanged={(updated) => setProjects((ps) => ps.some((p) => p._id === updated._id) ? ps.map((p) => p._id === updated._id ? updated : p) : [updated, ...ps])} /></div>;

  if (openId && loading) return <div className="flex flex-col gap-4">{workspaceNav}<p className="text-sm text-slate-500">Loading project…</p></div>;

  if (open) {
    return (
      <div className="flex flex-col gap-4">{workspaceNav}<ProjectWorkspace
        key={open._id}
        project={open}
        onBack={closeProject}
        onChanged={(updated) => setProjects((ps) => ps.map((p) => (p._id === updated._id ? updated : p)))}
        onDeleted={() => {
          setProjects((ps) => ps.filter((p) => p._id !== open._id));
          closeProject();
        }}
      /></div>
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
  // In the default portfolio view, surface projects needing attention before healthy projects.
  const sortedFiltered = [...filtered].sort((a, b) => {
    if (sort !== 'attention') {
      const [key, dir] = sort.split('-') as ['end' | 'start' | 'created' | 'updated', 'asc' | 'desc'];
      const get = (p: Project) => ({ end: p.endDate, start: p.startDate, created: p.createdAt, updated: p.updatedAt }[key]);
      return compareDates(get(a), get(b), dir) || a.name.localeCompare(b.name);
    }
    const sa = stats(a), sb = stats(b);
    const scoreA = sa.overdue * 3 + sa.blocked * 2;
    const scoreB = sb.overdue * 3 + sb.blocked * 2;
    return scoreB - scoreA || a.name.localeCompare(b.name);
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
      {workspaceNav}
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
          <SortSelect value={sort} onChange={setSort} options={PROJECT_SORTS} className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-700 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
        </div>

        {loading && <p className="text-sm text-slate-500">Loading projects…</p>}
        {!loading && !error && projects.length === 0 && <EmptyState title="No projects found in Taskmandu" />}
        {!loading && projects.length > 0 && filtered.length === 0 && <EmptyState title="No projects match those filters" />}

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {sortedFiltered.map((p) => {
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
