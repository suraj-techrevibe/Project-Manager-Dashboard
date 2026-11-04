import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { pmApi } from '../../lib/pmApi';
import type {
  PmBusiness,
  PmIntake,
  PmIntakeInput,
  PmIntakeKind,
  PmIntakeStatus,
  Project,
} from '../../types/pm';

type Section = 'requests' | 'ideas' | 'businesses';
type IntakeForm = Omit<PmIntakeInput, 'kind'> & {
  title: string;
  business_id: number | null;
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
    business_id: null,
    description: '',
    source_type: 'other',
    source_name: '',
    priority: 'medium',
    requested_due_at: '',
  };
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
  const [businesses, setBusinesses] = useState<PmBusiness[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [intakes, setIntakes] = useState<PmIntake[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<IntakeForm>(blankForm());
  const [businessName, setBusinessName] = useState('');
  const [businessDescription, setBusinessDescription] = useState('');
  const [businessSaving, setBusinessSaving] = useState(false);
  const [projectSelection, setProjectSelection] = useState<Record<number, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [businessResult, requestResult, ideaResult] = await Promise.all([
        pmApi.businesses(),
        pmApi.intakes('request'),
        pmApi.intakes('idea'),
      ]);
      setBusinesses(businessResult.data.businesses);
      setIntakes([...requestResult.data.intakes, ...ideaResult.data.intakes]
        .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || '')));

      // Project linking is useful but must not prevent local operations records from loading.
      const projectResult = await pmApi.projects().catch(() => null);
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

  const currentKind: PmIntakeKind = section === 'ideas' ? 'idea' : 'request';
  const visibleIntakes = useMemo(
    () => intakes.filter((item) => item.kind === currentKind),
    [currentKind, intakes],
  );
  const requestCount = intakes.filter((item) => item.kind === 'request').length;
  const ideaCount = intakes.filter((item) => item.kind === 'idea').length;

  function updateForm<K extends keyof IntakeForm>(key: K, value: IntakeForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function startNewIntake(kind: PmIntakeKind) {
    setSection(kind === 'request' ? 'requests' : 'ideas');
    setForm(blankForm());
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
        business_id: form.business_id,
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
        ? 'Request saved. Nothing has been sent to Taskmandu.'
        : 'Idea saved. Nothing has been sent to Taskmandu.');
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

  async function deleteIntake(item: PmIntake) {
    if (!window.confirm('Delete this local request/idea record? This does not change Taskmandu.')) return;
    setError(null);
    try {
      await pmApi.deleteIntake(item.id);
      setIntakes((items) => items.filter((current) => current.id !== item.id));
    } catch (e) {
      setError(errorMessage(e, 'Could not delete this item.'));
    }
  }

  async function createBusiness(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusinessSaving(true);
    setError(null);
    try {
      const { data } = await pmApi.createBusiness({
        name: businessName.trim(),
        description: businessDescription.trim() || undefined,
      });
      setBusinesses((items) => [...items, data.business].sort((a, b) => a.name.localeCompare(b.name)));
      setBusinessName('');
      setBusinessDescription('');
      setNotice('Business added. No Taskmandu project was created.');
    } catch (e) {
      setError(errorMessage(e, 'Could not create the business.'));
    } finally {
      setBusinessSaving(false);
    }
  }

  async function toggleBusinessStatus(business: PmBusiness) {
    setError(null);
    try {
      const status = business.status === 'active' ? 'paused' : 'active';
      const { data } = await pmApi.updateBusiness(business.id, { status });
      setBusinesses((items) => items.map((item) => item.id === business.id ? data.business : item));
    } catch (e) {
      setError(errorMessage(e, 'Could not update the business.'));
    }
  }

  async function linkProject(business: PmBusiness) {
    const projectId = projectSelection[business.id];
    const project = projects.find((item) => item._id === projectId);
    if (!project) return;

    setError(null);
    try {
      await pmApi.linkBusinessProject(business.id, {
        project_id: project._id,
        project_name: project.name,
        is_primary: business.project_links.length === 0,
      });
      setProjectSelection((current) => ({ ...current, [business.id]: '' }));
      await load();
    } catch (e) {
      setError(errorMessage(e, 'Could not link this Taskmandu project.'));
    }
  }

  async function unlinkProject(business: PmBusiness, projectId: string) {
    setError(null);
    try {
      await pmApi.unlinkBusinessProject(business.id, projectId);
      await load();
    } catch (e) {
      setError(errorMessage(e, 'Could not remove this project link.'));
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
            Capture business needs before they become planned work. These records stay in this app until you explicitly move them into the delivery workflow.
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

      <div className="grid grid-cols-3 gap-2">
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
        <button type="button" onClick={() => { setSection('businesses'); setFormOpen(false); }} className={'rounded-xl border px-3 py-3 text-left ' + tabClass('businesses')}>
          <span className="block text-xs opacity-75">Company directory</span>
          <span className="mt-1 block text-2xl font-semibold">{businesses.length}</span>
          <span className="block text-sm font-medium">Businesses</span>
        </button>
      </div>

      {error && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
      {notice && <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</div>}

      {section !== 'businesses' && (
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-slate-900">{section === 'requests' ? 'Incoming requests' : 'Ideas backlog'}</h3>
              <p className="mt-0.5 text-sm text-slate-500">
                {section === 'requests'
                  ? 'Record who asked, which business it affects and what needs clarification.'
                  : 'Keep opportunities visible without turning them into assigned work.'}
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
                  Business
                  <select value={form.business_id ?? ''} onChange={(e) => updateForm('business_id', e.target.value ? Number(e.target.value) : null)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
                    <option value="">Not assigned to a business</option>
                    {businesses.filter((b) => b.status === 'active').map((business) => <option key={business.id} value={business.id}>{business.name}</option>)}
                  </select>
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
              <p className="text-xs text-slate-500">Saving here creates only a local operations record. It does not create or update a Taskmandu task.</p>
            </form>
          )}

          <div className="mt-4 divide-y divide-slate-100">
            {loading && <p className="py-8 text-center text-sm text-slate-400">Loading records…</p>}
            {!loading && visibleIntakes.length === 0 && (
              <div className="py-10 text-center">
                <p className="text-sm font-medium text-slate-700">No {section} yet</p>
                <p className="mt-1 text-sm text-slate-500">Capture the first one when it arrives.</p>
              </div>
            )}
            {!loading && visibleIntakes.map((item) => {
              const statuses = item.kind === 'request' ? REQUEST_STATUSES : IDEA_STATUSES;
              const accepted = item.kind === 'request' ? item.status === 'approved' : item.status === 'accepted';
              return (
                <article key={item.id} className="flex flex-col gap-3 py-4 first:pt-2 sm:flex-row sm:items-start">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="font-semibold text-slate-900">{item.title}</h4>
                      <span className={'rounded-full border px-2 py-0.5 text-xs font-medium ' + priorityTone(item.priority)}>{item.priority}</span>
                      <span className={'rounded-full border px-2 py-0.5 text-xs font-medium ' + statusTone(item.status)}>{STATUS_LABELS[item.status]}</span>
                    </div>
                    <p className="mt-1 text-sm text-slate-600">{item.description || 'No description provided.'}</p>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                      <span>{item.business?.name || 'No business assigned'}</span>
                      <span>Source: {item.source_name || item.source_type}</span>
                      {item.requested_due_at && <span>Requested by: {item.requested_due_at}</span>}
                    </div>
                    {item.clarification && <p className="mt-2 rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-800">Clarification: {item.clarification}</p>}
                    {item.decision_notes && <p className="mt-2 rounded-md bg-slate-50 px-2 py-1 text-xs text-slate-600">Decision: {item.decision_notes}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-2 sm:flex-col sm:items-end">
                    <select
                      aria-label={'Status for ' + item.title}
                      value={item.status}
                      onChange={(e) => void updateStatus(item, e.target.value as PmIntakeStatus)}
                      className="max-w-48 rounded-lg border border-slate-300 bg-white px-2 py-2 text-xs"
                    >
                      {statuses.map((status) => (
                        <option key={status} value={status} disabled={status === 'planned' && !accepted && item.status !== 'planned'}>
                          {STATUS_LABELS[status]}
                        </option>
                      ))}
                    </select>
                    <button type="button" onClick={() => void deleteIntake(item)} className="px-2 py-1 text-xs text-slate-400 hover:text-rose-600">Delete</button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {section === 'businesses' && (
        <section className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div>
            <h3 className="text-base font-semibold text-slate-900">Business registry</h3>
            <p className="mt-1 text-sm text-slate-500">Create local business records, then associate existing Taskmandu projects. This never creates a project in Taskmandu.</p>
          </div>

          <form onSubmit={createBusiness} className="grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 md:grid-cols-[1fr_2fr_auto]">
            <input required maxLength={160} value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="Business name" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" />
            <input maxLength={3000} value={businessDescription} onChange={(e) => setBusinessDescription(e.target.value)} placeholder="Short description (optional)" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" />
            <button type="submit" disabled={businessSaving} className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
              {businessSaving ? 'Adding…' : 'Add business'}
            </button>
          </form>

          {projects.length === 0 && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">Taskmandu projects could not be loaded. Business records still work; project linking will be available when Taskmandu is reachable.</p>}

          <div className="grid gap-3 lg:grid-cols-2">
            {businesses.map((business) => {
              const linkedIds = new Set(business.project_links.map((link) => link.project_id));
              const available = projects.filter((project) => !linkedIds.has(project._id));
              return (
                <article key={business.id} className="rounded-xl border border-slate-200 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h4 className="font-semibold text-slate-900">{business.name}</h4>
                      <p className="mt-0.5 text-xs text-slate-500">{business.description || business.slug}</p>
                    </div>
                    <button type="button" onClick={() => void toggleBusinessStatus(business)} className="shrink-0 rounded-full border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50">
                      {business.status === 'active' ? 'Active · Pause' : 'Paused · Activate'}
                    </button>
                  </div>
                  <div className="mt-4">
                    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Linked Taskmandu projects</div>
                    {business.project_links.length === 0 && <p className="text-sm text-slate-400">No projects linked yet.</p>}
                    <div className="flex flex-col gap-2">
                      {business.project_links.map((link) => (
                        <div key={link.id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2">
                          <span className="min-w-0 truncate text-sm text-slate-700">
                            {link.project_name}
                            {link.is_primary && <span className="ml-2 text-xs text-indigo-600">Primary</span>}
                          </span>
                          <button type="button" onClick={() => void unlinkProject(business, link.project_id)} className="text-xs text-slate-400 hover:text-rose-600">Unlink</button>
                        </div>
                      ))}
                    </div>
                  </div>
                  {available.length > 0 && (
                    <div className="mt-3 flex gap-2">
                      <select
                        aria-label={'Choose project for ' + business.name}
                        value={projectSelection[business.id] || ''}
                        onChange={(e) => setProjectSelection((current) => ({ ...current, [business.id]: e.target.value }))}
                        className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2 py-2 text-xs"
                      >
                        <option value="">Link an existing project…</option>
                        {available.map((project) => <option key={project._id} value={project._id}>{project.name}</option>)}
                      </select>
                      <button type="button" onClick={() => void linkProject(business)} disabled={!projectSelection[business.id]} className="rounded-lg border border-indigo-200 px-3 py-2 text-xs font-medium text-indigo-700 disabled:opacity-40">Link</button>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
          {!loading && businesses.length === 0 && <p className="py-8 text-center text-sm text-slate-400">No businesses registered yet.</p>}
        </section>
      )}

      <footer className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs leading-relaxed text-slate-600">
        <strong className="text-slate-700">Workflow boundary:</strong> Requests and ideas are stored locally. Marking a request approved or an idea accepted records a decision; marking it planned means it is ready for planning. No action on this screen creates, edits or deletes a Taskmandu task.
      </footer>
    </div>
  );
}
