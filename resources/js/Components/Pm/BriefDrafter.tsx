import { useEffect, useState } from 'react';
import { pmApi } from '../../lib/pmApi';
import { TASK_PRIORITIES } from '../../types/pm';
import type { BriefDraft, Employee, Project, TaskPriority } from '../../types/pm';

const inputCls =
  'rounded-md border border-slate-200 px-2 py-1.5 text-sm focus:border-slate-400 focus:outline-none';

type Ticket = BriefDraft['tickets'][number] & {
  projectId?: string;
  projectTitle?: string;
};

const newUid = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

function blankTicket(): Ticket {
  return {
    uid: newUid(),
    projectId: '',
    projectTitle: '',
    title: '',
    description: '',
    level: 'intern',
    estimate_hours: 2,
    priority: 'Medium',
    assigneeId: '',
    dueDate: '',
    state: 'draft',
  };
}

function errorText(e: any, fallback: string): string {
  const d = e?.response?.data;
  if (d?.error) return d.error;
  if (d?.errors) {
    const first = Object.values(d.errors)[0] as string[] | undefined;
    if (first?.[0]) return first[0];
  }
  if (d?.message) return d.message;
  return fallback;
}

export default function BriefDrafter() {
  const [briefTitle, setBriefTitle] = useState('Untitled brief');
  const [brief, setBrief] = useState('');
  const [draftId, setDraftId] = useState<number | null>(null);
  const [savedDrafts, setSavedDrafts] = useState<BriefDraft[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    void loadInitial();
  }, []);

  async function loadInitial() {
    setLoading(true);
    try {
      const [draftsRes, projectsRes, contextRes] = await Promise.all([
        pmApi.briefDrafts(),
        pmApi.projects(),
        pmApi.briefContext(),
      ]);
      setSavedDrafts(draftsRes.data.drafts as BriefDraft[]);
      setProjects(projectsRes.data.projects);
      setEmployees(contextRes.data.employees);
      setError(null);
    } catch (e) {
      setError(errorText(e, "Couldn't load Brief data."));
    } finally {
      setLoading(false);
    }
  }

  async function loadSavedDrafts() {
    const { data } = await pmApi.briefDrafts();
    setSavedDrafts(data.drafts as BriefDraft[]);
  }

  function resetBrief() {
    setDraftId(null);
    setBriefTitle('Untitled brief');
    setBrief('');
    setTickets([]);
    setError(null);
    setNotice(null);
  }

  async function openDraft(id: number) {
    try {
      const { data } = await pmApi.briefDraft(id);
      const loaded = (data.draft.tickets ?? []).map((t) => {
        const projectId = t.projectId ?? '';
        const project = projects.find((p) => p._id === projectId);
        return {
          ...t,
          projectId,
          projectTitle: t.projectTitle ?? project?.name ?? '',
        };
      });
      setDraftId(data.draft.id);
      setBriefTitle(data.draft.title);
      setBrief(data.draft.brief ?? '');
      setTickets(loaded);
      setError(null);
      setNotice('Draft loaded. Nothing has been sent to Taskmandu.');
    } catch (e) {
      setError(errorText(e, "Couldn't load that draft."));
    }
  }

  async function deleteDraft(id: number) {
    if (!window.confirm('Delete this saved brief draft?')) return;
    try {
      await pmApi.deleteBriefDraft(id);
      if (draftId === id) resetBrief();
      await loadSavedDrafts();
      setNotice('Draft deleted.');
    } catch (e) {
      setError(errorText(e, "Couldn't delete that draft."));
    }
  }

  function normaliseTickets(source: Ticket[]) {
    return source.map((t) => ({
      uid: t.uid,
      projectId: t.projectId ?? '',
      projectTitle: t.projectTitle ?? '',
      title: t.title,
      description: t.description,
      level: t.level,
      estimate_hours: t.estimate_hours,
      priority: t.priority,
      assigneeId: t.assigneeId,
      dueDate: t.dueDate,
      state: t.state,
      ...(t.error ? { error: t.error } : {}),
    }));
  }

  async function saveDraft(sourceTickets = tickets) {
    if (!briefTitle.trim()) {
      setError('Give this brief a title.');
      return false;
    }
    if (!brief.trim() && sourceTickets.length === 0) {
      setError('Add notes or at least one ticket before saving.');
      return false;
    }

    const missingProject = sourceTickets.find((t) => t.state !== 'pushed' && !t.projectId);
    if (missingProject) {
      setError('Every ticket needs a project before the draft can be saved.');
      return false;
    }

    setSaving(true);
    setError(null);
    try {
      const payload = {
        title: briefTitle.trim(),
        brief,
        project_id: null,
        tickets: normaliseTickets(sourceTickets),
      };
      const { data } = draftId
        ? await pmApi.updateBriefDraft(draftId, payload)
        : await pmApi.saveBriefDraft(payload);

      setDraftId(data.draft.id);
      setBriefTitle(data.draft.title);
      await loadSavedDrafts();
      setNotice('Draft saved.');
      return true;
    } catch (e) {
      setError(errorText(e, "Couldn't save this draft."));
      return false;
    } finally {
      setSaving(false);
    }
  }

  function addTicket() {
    if (tickets.length >= 30) {
      setError('A brief can contain at most 30 tickets.');
      return;
    }
    setTickets((prev) => [...prev, blankTicket()]);
    setError(null);
  }

  function updateTicket(uid: string, patch: Partial<Ticket>) {
    setTickets((prev) =>
      prev.map((t) =>
        t.uid === uid
          ? {
              ...t,
              ...patch,
              state: t.state === 'failed' ? 'draft' : t.state,
            }
          : t,
      ),
    );
  }

  function removeTicket(uid: string) {
    setTickets((prev) => prev.filter((t) => t.uid !== uid));
  }

  function selectProject(uid: string, projectId: string) {
    const project = projects.find((p) => p._id === projectId);
    updateTicket(uid, {
      projectId,
      projectTitle: project?.name ?? '',
    });
  }

  async function pushTickets() {
    const pending = tickets.filter((t) => t.state !== 'pushed');
    if (!pending.length) {
      setError('There are no unpushed tickets.');
      return;
    }

    const missingProject = pending.find((t) => !t.projectId);
    if (missingProject) {
      setError('Every ticket must have a project before it can be pushed.');
      return;
    }

    const missingTitle = pending.find((t) => !t.title.trim());
    if (missingTitle) {
      setError('Every ticket needs a title.');
      return;
    }

    const missingAssignee = pending.find((t) => !t.assigneeId);
    if (missingAssignee) {
      setError('Every ticket needs an assignee — Taskmandu requires one per task.');
      return;
    }

    if (!window.confirm(`Push ${pending.length} ticket${pending.length === 1 ? '' : 's'} to Taskmandu?`)) {
      return;
    }

    setPushing(true);
    setError(null);
    setNotice(null);

    try {
      const payload = pending.map((t) => ({
        project_id: t.projectId!,
        title: t.title.trim(),
        description: t.description.trim(),
        level: t.level,
        estimate_hours: t.estimate_hours === '' ? null : Number(t.estimate_hours),
        priority: t.priority,
        assignee_employee_id: t.assigneeId,
        due_date: t.dueDate || null,
      }));

      const { data } = await pmApi.pushTickets(payload);
      const resultByUid = new Map(
        data.results.map((r) => [pending[r.index].uid, r]),
      );

      const next = tickets.map((t) => {
        const result = resultByUid.get(t.uid);
        if (!result) return t;
        return result.ok
          ? { ...t, state: 'pushed' as const, error: undefined }
          : { ...t, state: 'failed' as const, error: result.error ?? 'Push failed' };
      });

      setTickets(next);
      await saveDraft(next);

      const failed = data.failed;
      setNotice(
        failed
          ? `${data.created} pushed, ${failed} failed. Fix the failed tickets and push again.`
          : `${data.created} ticket${data.created === 1 ? '' : 's'} pushed to Taskmandu.`,
      );
    } catch (e) {
      setError(errorText(e, "Couldn't push the tickets."));
    } finally {
      setPushing(false);
    }
  }

  if (loading) {
    return <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">Loading Briefs…</div>;
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={briefTitle}
          onChange={(e) => setBriefTitle(e.target.value)}
          maxLength={200}
          placeholder="Brief title"
          className={`${inputCls} min-w-[16rem] flex-1 font-medium`}
        />
        {draftId && <span className="text-xs text-slate-400">Draft #{draftId}</span>}
        <button
          onClick={() => void saveDraft()}
          disabled={saving}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {saving ? 'Saving…' : draftId ? 'Save changes' : 'Save draft'}
        </button>
        <button
          onClick={resetBrief}
          className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-50"
        >
          New brief
        </button>
      </div>

      {savedDrafts.length > 0 && (
        <div className="mb-3 rounded-md border border-slate-200 bg-slate-50 p-2">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-xs font-semibold text-slate-600">Saved briefs</div>
            <div className="text-[11px] text-slate-400">{savedDrafts.length} saved</div>
          </div>
          <div className="space-y-1">
            {savedDrafts.map((d) => (
              <div key={d.id} className="flex items-center gap-2 rounded border border-slate-200 bg-white px-2 py-1.5">
                <button
                  onClick={() => void openDraft(d.id)}
                  className="min-w-0 flex-1 truncate text-left text-xs font-medium text-slate-700 hover:underline"
                >
                  {d.title}
                </button>
                <span className="shrink-0 text-[11px] text-slate-400">
                  {new Date(d.updated_at).toLocaleString()}
                </span>
                <button
                  onClick={() => void deleteDraft(d.id)}
                  className="shrink-0 text-xs text-slate-400 hover:text-red-600"
                  title="Delete draft"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mb-3">
        <label className="mb-1 block text-xs font-medium text-slate-600">Brief / notes</label>
        <textarea
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          placeholder="Write what you remember or what needs to be done. This is saved locally in PM until you push tickets."
          className="min-h-[110px] w-full resize-y rounded-md border border-slate-200 p-2 text-sm"
        />
      </div>

      {error && <div className="mb-2 rounded-md bg-red-50 p-2 text-xs text-red-700">{error}</div>}
      {notice && <div className="mb-2 rounded-md bg-slate-50 p-2 text-xs text-slate-600">{notice}</div>}

      <div className="mb-2 flex items-center justify-between border-t border-slate-100 pt-3">
        <div>
          <div className="text-sm font-semibold text-slate-800">Tickets</div>
          <div className="text-xs text-slate-400">Every ticket belongs to a Taskmandu project.</div>
        </div>
        <button
          onClick={addTicket}
          disabled={tickets.length >= 30}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          + Add ticket
        </button>
      </div>

      <div className="space-y-2">
        {tickets.map((t, index) => (
          <div
            key={t.uid}
            className={`rounded-lg border p-3 ${t.state === 'pushed' ? 'border-green-200 bg-green-50/40' : 'border-slate-200 bg-white'}`}
          >
            <div className="mb-2 flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-400">#{index + 1}</span>
              {t.state === 'pushed' && <span className="text-xs font-medium text-green-700">Pushed</span>}
              {t.state === 'failed' && <span className="text-xs font-medium text-red-600">Failed</span>}
              <button
                onClick={() => removeTicket(t.uid)}
                className="ml-auto text-xs text-slate-400 hover:text-red-600"
              >
                Delete
              </button>
            </div>

            <div className="grid gap-2 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Project *</label>
                <select
                  value={t.projectId ?? ''}
                  onChange={(e) => selectProject(t.uid, e.target.value)}
                  disabled={t.state === 'pushed'}
                  className={`${inputCls} w-full`}
                >
                  <option value="">Select existing project…</option>
                  {projects.map((p) => (
                    <option key={p._id} value={p._id}>{p.name}</option>
                  ))}
                </select>
                {t.projectTitle && <div className="mt-1 text-[11px] text-slate-400">{t.projectTitle}</div>}
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Task title *</label>
                <input
                  value={t.title}
                  onChange={(e) => updateTicket(t.uid, { title: e.target.value })}
                  disabled={t.state === 'pushed'}
                  className={`${inputCls} w-full`}
                  placeholder="What needs to be done?"
                />
              </div>

              <div className="md:col-span-2">
                <label className="mb-1 block text-xs font-medium text-slate-600">Description</label>
                <textarea
                  value={t.description}
                  onChange={(e) => updateTicket(t.uid, { description: e.target.value })}
                  disabled={t.state === 'pushed'}
                  className="min-h-[70px] w-full rounded-md border border-slate-200 p-2 text-sm focus:border-slate-400 focus:outline-none disabled:bg-slate-50"
                  placeholder="Optional task details"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Assignee *</label>
                <select
                  value={t.assigneeId}
                  onChange={(e) => updateTicket(t.uid, { assigneeId: e.target.value })}
                  disabled={t.state === 'pushed'}
                  className={`${inputCls} w-full`}
                >
                  <option value="">Select employee…</option>
                  {employees.map((e) => (
                    <option key={e.employeeId} value={e.employeeId}>{e.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Priority</label>
                <select
                  value={t.priority}
                  onChange={(e) => updateTicket(t.uid, { priority: e.target.value as TaskPriority })}
                  disabled={t.state === 'pushed'}
                  className={`${inputCls} w-full`}
                >
                  {TASK_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Estimate (hours)</label>
                <input
                  type="number"
                  min={0}
                  step="0.5"
                  value={t.estimate_hours}
                  onChange={(e) => updateTicket(t.uid, { estimate_hours: e.target.value === '' ? '' : Number(e.target.value) })}
                  disabled={t.state === 'pushed'}
                  className={`${inputCls} w-full`}
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Due date</label>
                <input
                  type="date"
                  value={t.dueDate}
                  onChange={(e) => updateTicket(t.uid, { dueDate: e.target.value })}
                  disabled={t.state === 'pushed'}
                  className={`${inputCls} w-full`}
                />
              </div>
            </div>

            {t.error && <div className="mt-2 text-xs text-red-600">{t.error}</div>}
          </div>
        ))}

        {tickets.length === 0 && (
          <div className="rounded-lg border border-dashed border-slate-300 p-5 text-center text-sm text-slate-500">
            No tickets yet. Add a ticket, choose its project, then save the brief.
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
        <span className="text-xs text-slate-400">{tickets.length} / 30 tickets</span>
        <button
          onClick={() => void pushTickets()}
          disabled={pushing || !tickets.some((t) => t.state !== 'pushed')}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {pushing ? 'Pushing…' : 'Push tickets to Taskmandu'}
        </button>
      </div>
    </div>
  );
}
