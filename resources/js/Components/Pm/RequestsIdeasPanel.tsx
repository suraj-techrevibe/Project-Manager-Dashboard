import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { pmApi } from '../../lib/pmApi';
import { visitPm } from '../../lib/pmNav';
import type {
  PmIntake,
  PmIntakeInput,
  PmIntakeKind,
  PmIntakeStatus,
  Project,
} from '../../types/pm';

type Section = 'requests' | 'ideas';
type IntakeForm = Omit<PmIntakeInput, 'kind' | 'business_id'> & {
  title: string;
  linked_project_id: string | null;
  linked_project_name: string | null;
  description: string;
  source_type: NonNullable<PmIntakeInput['source_type']>;
  source_name: string;
  priority: NonNullable<PmIntakeInput['priority']>;
  requested_due_at: string;
};

const REQUEST_STATUSES: PmIntakeStatus[] = [
  'received', 'needs_clarification', 'in_review', 'approved', 'rejected', 'deferred', 'planned',
];
const IDEA_STATUSES: PmIntakeStatus[] = [
  'captured', 'under_review', 'accepted', 'rejected', 'deferred', 'planned',
];

const STATUS_LABELS: Record<PmIntakeStatus, string> = {
  received: 'Received',
  needs_clarification: 'Needs clarification',
  in_review: 'In review',
  approved: 'Approved',
  captured: 'Captured',
  under_review: 'Under review',
  accepted: 'Accepted',
  rejected: 'Rejected',
  deferred: 'Deferred',
  planned: 'Planned',
};

function blankForm(): IntakeForm {
  return {
    title: '',
    linked_project_id: null,
    linked_project_name: null,
    description: '',
    source_type: 'other',
    source_name: '',
    priority: 'medium',
    requested_due_at: '',
  };
}

const PROJECT_STOP_WORDS = new Set(['a', 'an', 'the', 'and', 'or', 'of', 'to', 'for', 'in', 'on', 'with', 'from', 'new', 'add', 'fix', 'update', 'improve', 'build', 'create', 'make', 'implement', 'feature', 'project', 'business']);

function projectTokens(value: string): string[] {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(/\s+/)
    .filter((word) => word.length > 2 && !PROJECT_STOP_WORDS.has(word));
}

function detectTaskmanduProject(title: string, description: string, projects: Project[]): Project | null {
  const combined = `${title} ${description}`.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (!combined) return null;
  const input = new Set(projectTokens(combined));
  const ranked = projects.map((project) => {
    const normalizedName = project.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const nameTokens = projectTokens(project.name);
    const hits = nameTokens.filter((token) => input.has(token)).length;
    const exact = normalizedName.length > 2 && combined.includes(normalizedName);
    const coverage = nameTokens.length ? hits / nameTokens.length : 0;
    return { project, hits, exact, coverage, score: exact ? 1 : coverage };
  }).sort((a, b) => b.score - a.score || b.hits - a.hits);
  const best = ranked[0];
  const runnerUp = ranked[1];
  if (!best || (!best.exact && !(best.hits >= 2 && best.coverage >= 0.66) && !(best.hits === 1 && projectTokens(best.project.name).length === 1))) return null;
  if (runnerUp && !best.exact && best.score - runnerUp.score < 0.16) return null;
  return best.project;
}

function errorMessage(error: unknown, fallback: string): string {
  const response = error as { response?: { data?: { message?: string; errors?: Record<string, string[]> } } };
  const first = response.response?.data?.errors
    ? Object.values(response.response.data.errors)[0]?.[0]
    : null;
  return first || response.response?.data?.message || (error instanceof Error ? error.message : fallback);
}

function statusTone(status: PmIntakeStatus): string {
  if (status === 'rejected') return 'border-rose-200 bg-rose-50 text-rose-700';
  if (status === 'approved' || status === 'accepted' || status === 'planned') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (status === 'needs_clarification' || status === 'deferred') return 'border-amber-200 bg-amber-50 text-amber-800';
  return 'border-slate-200 bg-slate-50 text-slate-700';
}

function priorityTone(priority: PmIntake['priority']): string {
  if (priority === 'critical') return 'border-rose-200 bg-rose-50 text-rose-700';
  if (priority === 'high') return 'border-orange-200 bg-orange-50 text-orange-700';
  if (priority === 'medium') return 'border-blue-200 bg-blue-50 text-blue-700';
  return 'border-slate-200 bg-slate-50 text-slate-600';
}

export default function RequestsIdeasPanel() {
  const [section, setSection] = useState<Section>('requests');
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectMatchMode, setProjectMatchMode] = useState<'auto' | 'manual'>('auto');
  const [intakes, setIntakes] = useState<PmIntake[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<IntakeForm>(blankForm());
  const [projectSelection, setProjectSelection] = useState<Record<number, string>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'needs_attention' | PmIntakeStatus>('all');
  const [projectFilter, setProjectFilter] = useState('all');
  const [editingContextId, setEditingContextId] = useState<number | null>(null);
  const [contextDraft, setContextDraft] = useState({ clarification: '', decision_notes: '' });
  const [contextSaving, setContextSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [requestResult, ideaResult, projectResult] = await Promise.all([
        pmApi.intakes('request'),
        pmApi.intakes('idea'),
        pmApi.projects().catch(() => null),
      ]);
      setIntakes([...requestResult.data.intakes, ...ideaResult.data.intakes]
        .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || '')));
      setProjects(projectResult?.data.projects ?? []);
    } catch (e) {
      setError(errorMessage(e, "Couldn't load Requests & Ideas."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Dashboard quick-capture links reopen this panel directly in the requested form.
  useEffect(() => {
    if (!formOpen || projectMatchMode !== 'auto' || !projects.length || !form.title.trim()) return;
    const match = detectTaskmanduProject(form.title, form.description, projects);
    if (match?._id !== form.linked_project_id) {
      setForm((current) => ({ ...current, linked_project_id: match?._id ?? null, linked_project_name: match?.name ?? null }));
    }
  }, [formOpen, projectMatchMode, projects, form.title, form.description]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const capture = params.get('new');
    if (capture === 'request' || capture === 'idea') {
      setSection(capture === 'idea' ? 'ideas' : 'requests');
      setForm(blankForm());
      setFormOpen(true);
      params.delete('new');
      const query = params.toString();
      window.history.replaceState(
        window.history.state,
        '',
        `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`,
      );
    }
  }, []);

  const currentKind: PmIntakeKind = section === 'ideas' ? 'idea' : 'request';
  const visibleIntakes = useMemo(
    () => intakes.filter((item) => item.kind === currentKind),
    [currentKind, intakes],
  );
  const filteredIntakes = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return visibleIntakes.filter((item) => {
      const searchable = [
        item.title,
        item.description,
        item.source_name,
        item.source_type,
        item.linked_project_name,
        item.business?.name,
      ].filter(Boolean).join(' ').toLowerCase();
      const matchesSearch = !query || searchable.includes(query);
      const matchesStatus = statusFilter === 'all'
        || (statusFilter === 'needs_attention'
          ? ['received', 'needs_clarification', 'in_review', 'captured', 'under_review'].includes(item.status)
          : item.status === statusFilter);
      const matchesProject = projectFilter === 'all' || String(item.linked_project_id ?? '') === projectFilter;
      return matchesSearch && matchesStatus && matchesProject;
    });
  }, [visibleIntakes, searchQuery, statusFilter, projectFilter]);
  const requestCount = intakes.filter((item) => item.kind === 'request').length;
  const ideaCount = intakes.filter((item) => item.kind === 'idea').length;

  function updateForm<K extends keyof IntakeForm>(key: K, value: IntakeForm[K]) {
    setForm((current) => {
      const next = { ...current, [key]: value };
      if ((key === 'title' || key === 'description') && projectMatchMode === 'auto') {
        const match = detectTaskmanduProject(next.title, next.description, projects);
        next.linked_project_id = match?._id ?? null;
        next.linked_project_name = match?.name ?? null;
      }
      return next;
    });
  }

  function chooseProject(projectId: string) {
    const project = projects.find((item) => item._id === projectId);
    setProjectMatchMode('manual');
    setForm((current) => ({ ...current, linked_project_id: project?._id ?? null, linked_project_name: project?.name ?? null }));
  }

  function autoDetectProject() {
    const match = detectTaskmanduProject(form.title, form.description, projects);
    setProjectMatchMode('auto');
    setForm((current) => ({ ...current, linked_project_id: match?._id ?? null, linked_project_name: match?.name ?? null }));
  }

  function startNewIntake(kind: PmIntakeKind) {
    setSection(kind === 'request' ? 'requests' : 'ideas');
    setForm(blankForm());
    setProjectMatchMode('auto');
    setFormOpen(true);
    setError(null);
    setNotice(null);
  }

  async function createIntake(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const payload: PmIntakeInput = {
        kind: currentKind,
        title: form.title.trim(),
        linked_project_id: form.linked_project_id,
        linked_project_name: form.linked_project_name,
        description: form.description.trim() || null,
        source_type: form.source_type,
        source_name: form.source_name.trim() || null,
        priority: form.priority,
        requested_due_at: form.requested_due_at || null,
      };
      const { data } = await pmApi.createIntake(payload);
      setIntakes((items) => [data.intake, ...items]);
      setForm(blankForm());
      setFormOpen(false);
      setNotice(currentKind === 'request'
        ? `Request saved${data.intake.linked_project_name ? ` and matched to ${data.intake.linked_project_name}` : ''}. Approve it to plan and assign Taskmandu tasks.`
        : `Idea saved${data.intake.linked_project_name ? ` and matched to ${data.intake.linked_project_name}` : ''}. Accept it to plan and assign Taskmandu tasks.`);
    } catch (e) {
      setError(errorMessage(e, 'Could not save this item.'));
    } finally {
      setSaving(false);
    }
  }

  async function updateStatus(item: PmIntake, status: PmIntakeStatus) {
    setError(null);
    try {
      const { data } = await pmApi.updateIntake(item.id, { status });
      setIntakes((items) => items.map((current) => current.id === item.id ? data.intake : current));
    } catch (e) {
      setError(errorMessage(e, 'Could not update the status.'));
    }
  }

  function startContextEdit(item: PmIntake) {
    setEditingContextId(item.id);
    setContextDraft({
      clarification: item.clarification ?? '',
      decision_notes: item.decision_notes ?? '',
    });
    setError(null);
    setNotice(null);
  }

  async function saveContext(item: PmIntake) {
    setContextSaving(true);
    setError(null);
    setNotice(null);
    try {
      const { data } = await pmApi.updateIntake(item.id, {
        clarification: contextDraft.clarification.trim() || null,
        decision_notes: contextDraft.decision_notes.trim() || null,
      });
      setIntakes((items) => items.map((current) => current.id === item.id ? data.intake : current));
      setEditingContextId(null);
      setNotice('Coordination notes saved.');
    } catch (e) {
      setError(errorMessage(e, 'Could not save the coordination notes.'));
    } finally {
      setContextSaving(false);
    }
  }

  async function deleteIntake(item: PmIntake) {
    if (!window.confirm('Delete this request/idea record and its local links? Existing Taskmandu tasks will not be deleted.')) return;
    setError(null);
    try {
      await pmApi.deleteIntake(item.id);
      setIntakes((items) => items.filter((current) => current.id !== item.id));
    } catch (e) {
      setError(errorMessage(e, 'Could not delete this item.'));
    }
  }

  async function saveProjectMatch(item: PmIntake) {
    const projectId = projectSelection[item.id] ?? item.linked_project_id ?? '';
    const project = projects.find((candidate) => candidate._id === projectId);
    if (!project) return;
    setError(null);
    try {
      const { data } = await pmApi.updateIntake(item.id, { linked_project_id: project._id, linked_project_name: project.name });
      setIntakes((items) => items.map((current) => current.id === item.id ? data.intake : current));
      setProjectSelection((current) => ({ ...current, [item.id]: '' }));
      setNotice(`Matched to Taskmandu project: ${project.name}.`);
    } catch (e) {
      setError(errorMessage(e, 'Could not save the Taskmandu project match.'));
    }
  }

  const tabClass = (key: Section) => section === key
    ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50';

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-indigo-600">Company operations</div>
          <h2 className="mt-1 text-2xl font-semibold text-slate-900">Requests & Ideas</h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Capture requests and ideas, match them to an existing Taskmandu project, then convert approved work into assigned Tasks.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </header>

      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => { setSection('requests'); setFormOpen(false); }} className={'rounded-xl border px-3 py-3 text-left ' + tabClass('requests')}>
          <span className="block text-xs opacity-75">Incoming work</span>
          <span className="mt-1 block text-2xl font-semibold">{requestCount}</span>
          <span className="block text-sm font-medium">Requests</span>
        </button>
        <button type="button" onClick={() => { setSection('ideas'); setFormOpen(false); }} className={'rounded-xl border px-3 py-3 text-left ' + tabClass('ideas')}>
          <span className="block text-xs opacity-75">Future opportunities</span>
          <span className="mt-1 block text-2xl font-semibold">{ideaCount}</span>
          <span className="block text-sm font-medium">Ideas</span>
        </button>
      </div>

      {error && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
      {notice && <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</div>}

      {(
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-slate-900">{section === 'requests' ? 'Incoming requests' : 'Ideas backlog'}</h3>
              <p className="mt-0.5 text-sm text-slate-500">
                {section === 'requests'
                  ? 'Record who asked, which Taskmandu project it belongs to and what needs clarification.'
                  : 'Keep opportunities visible; accepted ideas can become Tasks in their matched project.'}
              </p>
            </div>
            <button type="button" onClick={() => startNewIntake(currentKind)} className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800">
              {section === 'requests' ? '+ New request' : '+ New idea'}
            </button>
          </div>

          {formOpen && (
            <form onSubmit={createIntake} className="mt-4 grid gap-3 rounded-xl border border-indigo-100 bg-indigo-50/40 p-4">
              <div className="grid gap-3 md:grid-cols-2">
                <label className="block text-sm font-medium text-slate-700">
                  Title *
                  <input required maxLength={200} value={form.title} onChange={(e) => updateForm('title', e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" placeholder="What is needed?" />
                </label>
                <label className="block text-sm font-medium text-slate-700">
                  Taskmandu project / business
                  <select value={form.linked_project_id ?? ''} onChange={(e) => chooseProject(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
                    <option value="">No confident match — choose later</option>
                    {projects.map((project) => <option key={project._id} value={project._id}>{project.name}</option>)}
                  </select>
                  <span className="mt-1 block text-xs font-normal text-slate-500">
                    {projectMatchMode === 'auto'
                      ? (form.linked_project_name ? `Auto-matched: ${form.linked_project_name}` : 'No confident automatic match. Select the correct Taskmandu project.')
                      : 'Project selected manually.'}
                    {' '}
                    <button type="button" onClick={autoDetectProject} className="font-semibold text-indigo-700">Auto-detect</button>
                  </span>
                </label>
              </div>
              <label className="block text-sm font-medium text-slate-700">
                Description / context
                <textarea rows={3} maxLength={10000} value={form.description} onChange={(e) => updateForm('description', e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" placeholder="Why is this needed? What outcome is expected?" />
              </label>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <label className="block text-sm font-medium text-slate-700">
                  Source
                  <select value={form.source_type} onChange={(e) => updateForm('source_type', e.target.value as IntakeForm['source_type'])} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm">
                    <option value="boss">Boss / management</option>
                    <option value="client">Client</option>
                    <option value="team">Team</option>
                    <option value="self">Self</option>
                    <option value="other">Other</option>
                  </select>
                </label>
                <label className="block text-sm font-medium text-slate-700">
                  Source name
                  <input maxLength={120} value={form.source_name} onChange={(e) => updateForm('source_name', e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" placeholder="Who asked?" />
                </label>
                <label className="block text-sm font-medium text-slate-700">
                  Priority
                  <select value={form.priority} onChange={(e) => updateForm('priority', e.target.value as IntakeForm['priority'])} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm">
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="critical">Critical</option>
                  </select>
                </label>
                <label className="block text-sm font-medium text-slate-700">
                  Requested deadline
                  <input type="date" value={form.requested_due_at} onChange={(e) => updateForm('requested_due_at', e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm" />
                </label>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <button type="button" onClick={() => setFormOpen(false)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-600">Cancel</button>
                <button type="submit" disabled={saving} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
                  {saving ? 'Saving…' : 'Save locally'}
                </button>
              </div>
              <p className="text-xs text-slate-500">This saves the request locally. After approval, “Plan & assign tasks” creates real Tasks inside the selected Taskmandu project.</p>
            </form>
          )}

          <div className="mt-4 grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 md:grid-cols-[minmax(0,1fr)_190px_190px]">
            <label className="block text-xs font-semibold text-slate-600">
              Search {section}
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search title, details, source or project…"
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-800"
              />
            </label>
            <label className="block text-xs font-semibold text-slate-600">
              Status
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm font-normal text-slate-800"
              >
                <option value="all">All statuses</option>
                <option value="needs_attention">Needs attention</option>
                {(section === 'ideas' ? IDEA_STATUSES : REQUEST_STATUSES).map((status) => (
                  <option key={status} value={status}>{STATUS_LABELS[status]}</option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-semibold text-slate-600">
              Taskmandu project
              <select
                value={projectFilter}
                onChange={(e) => setProjectFilter(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm font-normal text-slate-800"
              >
                <option value="all">All projects</option>
                <option value="">No project matched</option>
                {projects.map((project) => <option key={project._id} value={project._id}>{project.name}</option>)}
              </select>
            </label>
          </div>
          <div className="mt-3 flex items-center justify-between gap-2 text-xs text-slate-500">
            <span>{filteredIntakes.length} of {visibleIntakes.length} {section}</span>
            {(searchQuery || statusFilter !== 'all' || projectFilter !== 'all') && (
              <button type="button" onClick={() => { setSearchQuery(''); setStatusFilter('all'); setProjectFilter('all'); }} className="font-semibold text-indigo-700 hover:text-indigo-900">
                Clear filters
              </button>
            )}
          </div>
          <div className="mt-2 divide-y divide-slate-100">
            {loading && <p className="py-8 text-center text-sm text-slate-400">Loading records…</p>}
            {!loading && visibleIntakes.length === 0 && (
              <div className="py-10 text-center">
                <p className="text-sm font-medium text-slate-700">No {section} yet</p>
                <p className="mt-1 text-sm text-slate-500">Capture the first one when it arrives.</p>
              </div>
            )}
            {!loading && visibleIntakes.length > 0 && filteredIntakes.length === 0 && (
              <div className="py-10 text-center">
                <p className="text-sm font-medium text-slate-700">No matching {section}</p>
                <p className="mt-1 text-sm text-slate-500">Try a different search or clear the filters.</p>
              </div>
            )}
            {!loading && filteredIntakes.map((item) => {
              const statuses = item.kind === 'request' ? REQUEST_STATUSES : IDEA_STATUSES;
              const accepted = item.kind === 'request' ? item.status === 'approved' : item.status === 'accepted';
              const canPlan = accepted || item.status === 'planned';
              const overdue = Boolean(
                item.kind === 'request'
                && item.requested_due_at
                && item.requested_due_at < (() => {
                  const now = new Date();
                  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
                })()
                && !['rejected', 'deferred', 'planned'].includes(item.status),
              );
              return (
                <article key={item.id} className="flex flex-col gap-3 py-4 first:pt-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="font-semibold text-slate-900">{item.title}</h4>
                      <span className={'rounded-full border px-2 py-0.5 text-xs font-medium ' + priorityTone(item.priority)}>{item.priority}</span>
                      <span className={'rounded-full border px-2 py-0.5 text-xs font-medium ' + statusTone(item.status)}>{STATUS_LABELS[item.status]}</span>
                      {overdue && <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700">Overdue</span>}
                    </div>
                    <p className="mt-1 text-sm text-slate-600">{item.description || 'No description provided.'}</p>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                      <span>{item.linked_project_name || item.business?.name || 'No Taskmandu project matched'}</span>
                      <span>Source: {item.source_name || item.source_type}</span>
                      {item.requested_due_at && <span className={overdue ? 'font-semibold text-rose-700' : ''}>Requested due: {item.requested_due_at}</span>}
                    </div>
                    {item.clarification && <p className="mt-2 rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-800">Clarification: {item.clarification}</p>}
                    {item.decision_notes && <p className="mt-2 rounded-md bg-slate-50 px-2 py-1 text-xs text-slate-600">Decision: {item.decision_notes}</p>}
                    {editingContextId === item.id ? (
                      <div className="mt-3 grid gap-2 rounded-xl border border-amber-200 bg-amber-50/50 p-3">
                        <label className="block text-xs font-semibold text-slate-700">
                          Clarification needed / answer
                          <textarea
                            rows={2}
                            maxLength={5000}
                            value={contextDraft.clarification}
                            onChange={(e) => setContextDraft((current) => ({ ...current, clarification: e.target.value }))}
                            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal"
                            placeholder="What needs to be clarified, and what answer was received?"
                          />
                        </label>
                        <label className="block text-xs font-semibold text-slate-700">
                          Decision notes
                          <textarea
                            rows={2}
                            maxLength={5000}
                            value={contextDraft.decision_notes}
                            onChange={(e) => setContextDraft((current) => ({ ...current, decision_notes: e.target.value }))}
                            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal"
                            placeholder="Record approval, rejection or deferral context."
                          />
                        </label>
                        <div className="flex justify-end gap-2">
                          <button type="button" onClick={() => setEditingContextId(null)} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600">Cancel</button>
                          <button type="button" onClick={() => void saveContext(item)} disabled={contextSaving} className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">{contextSaving ? 'Saving…' : 'Save notes'}</button>
                        </div>
                      </div>
                    ) : (
                      <button type="button" onClick={() => startContextEdit(item)} className="mt-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:border-indigo-200 hover:text-indigo-700">
                        {item.clarification || item.decision_notes ? 'Edit coordination notes' : '+ Add clarification / decision'}
                      </button>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2 sm:flex-col sm:items-end">
                    <select
                      aria-label={'Status for ' + item.title}
                      value={item.status}
                      onChange={(e) => void updateStatus(item, e.target.value as PmIntakeStatus)}
                      disabled={item.status === 'planned'}
                      className="max-w-48 rounded-lg border border-slate-300 bg-white px-2 py-2 text-xs disabled:bg-slate-100"
                    >
                      {statuses.map((status) => (
                        <option key={status} value={status} disabled={status === 'planned'}>
                          {status === 'planned' ? 'In delivery (set after Taskmandu push)' : STATUS_LABELS[status]}
                        </option>
                      ))}
                    </select>
                    {canPlan && item.linked_project_id && (
                      <button type="button" onClick={() => visitPm('brief', { intake: String(item.id) })} className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700">
                        {item.task_links?.length ? 'Add / assign tasks' : 'Plan & assign tasks'}
                      </button>
                    )}
                    {canPlan && !item.linked_project_id && <span className="max-w-48 text-right text-xs text-amber-700">Select a Taskmandu project before planning.</span>}
                    <button type="button" onClick={() => void deleteIntake(item)} className="px-2 py-1 text-xs text-slate-400 hover:text-rose-600">Delete</button>
                  </div>
                  {item.task_links?.length > 0 && (
                    <div className="rounded-lg border border-indigo-100 bg-indigo-50/40 px-3 py-2">
                      <div className="mb-1 text-xs font-semibold text-indigo-900">Tasks linked in Taskmandu ({item.task_links.length})</div>
                      <div className="flex flex-wrap gap-x-3 gap-y-1">
                        {item.task_links.map((task) => (
                          <span key={task.id} className="inline-flex flex-wrap items-center gap-1 text-xs">
                            {task.url
                              ? <a href={task.url} target="_blank" rel="noreferrer" className="font-medium text-indigo-700 underline">{task.title}</a>
                              : <span className="text-slate-700">{task.title}</span>}
                            {task.status && <span className="text-slate-500">· {task.status}</span>}
                            {task.assignee && <span className="text-slate-500">· {task.assignee}</span>}
                            {task.due_at && <span className="text-slate-500">· Due {task.due_at}</span>}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      aria-label={'Taskmandu project for ' + item.title}
                      value={projectSelection[item.id] ?? item.linked_project_id ?? ''}
                      onChange={(e) => setProjectSelection((current) => ({ ...current, [item.id]: e.target.value }))}
                      disabled={Boolean(item.task_links?.length)}
                      className="max-w-xs rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs disabled:bg-slate-100"
                    >
                      <option value="">Choose Taskmandu project…</option>
                      {projects.map((project) => <option key={project._id} value={project._id}>{project.name}</option>)}
                    </select>
                    <button type="button" onClick={() => void saveProjectMatch(item)} disabled={Boolean(item.task_links?.length) || !(projectSelection[item.id] ?? item.linked_project_id)} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 disabled:opacity-40">Save project match</button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      <footer className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs leading-relaxed text-slate-600">
        <strong className="text-slate-700">Workflow:</strong> Capture a request or idea → auto-match it to a Taskmandu project → approve / accept it → plan and assign Tasks → follow progress in that project. The Taskmandu project is the business record; there is no duplicate business directory.
      </footer>
    </div>
  );
}
