import { useEffect, useState } from 'react';
import { pmApi } from '../../lib/pmApi';
import { TASK_PRIORITIES } from '../../types/pm';
import type { BriefDraft, Employee, Project, TaskPriority } from '../../types/pm';

const inputCls =
  'rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm focus:border-slate-400 focus:outline-none';

type Ticket = BriefDraft['tickets'][number];

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
      setDraftId(data.draft.id);
      setBriefTitle(data.draft.title);
      setBrief(data.draft.brief ?? '');
      setTickets(data.draft.tickets ?? []);
      setError(null);
      setNotice('Draft loaded.');
    } catch (e) {
      setError(errorText(e, "Couldn't load that draft."));
    }
  }

  async function deleteDraft(id: number) {
    if (!window.confirm('Delete this saved brief?')) return;

    try {
      await pmApi.deleteBriefDraft(id);
      if (draftId === id) resetBrief();
      await loadSavedDrafts();
      setNotice('Brief deleted.');
    } catch (e) {
      setError(errorText(e, "Couldn't delete that brief."));
    }
  }

  function normaliseTickets(sourceTickets: Ticket[]) {
    return sourceTickets.map((t) => ({
      ...t,
      projectId: t.projectId ?? '',
      projectTitle: t.projectTitle ?? '',
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
      setError('Every ticket needs a project before the brief can be saved.');
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
          ? { ...t, ...patch, state: t.state === 'failed' ? 'draft' : t.state }
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

    if (pending.some((t) => !t.projectId)) {
      setError('Every ticket must have a project before it can be pushed.');
      return;
    }

    if (pending.some((t) => !t.title.trim())) {
      setError('Every ticket needs a title.');
      return;
    }

    if (pending.some((t) => !t.assigneeId)) {
      setError('Every ticket needs an assignee.');
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
        project_id: t.projectId,
        title: t.title.trim(),
        description: t.description.trim(),
        level: t.level,
        estimate_hours: t.estimate_hours === '' ? null : Number(t.estimate_hours),
        priority: t.priority,
        assignee_employee_id: t.assigneeId,
        due_date: t.dueDate || null,
      }));

      const { data } = await pmApi.pushTickets(payload);
      const resultByUid = new Map(data.results.map((r) => [pending[r.index].uid, r]));

      const next = tickets.map((t) => {
        const result = resultByUid.get(t.uid);
        if (!result) return t;
        return result.ok
          ? { ...t, state: 'pushed' as const, error: undefined }
          : { ...t, state: 'failed' as const, error: result.error ?? 'Push failed' };
      });

      setTickets(next);
      await saveDraft(next);

      setNotice(
        data.failed
          ? `${data.created} pushed, ${data.failed} failed. Fix the failed tickets and push again.`
          : `${data.created} ticket${data.created === 1 ? '' : 's'} pushed to Taskmandu.`,
      );
    } catch (e) {
      setError(errorText(e, "Couldn't push the tickets."));
    } finally {
      setPushing(false);
    }
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">
        Loading Briefs…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-base font-semibold text-slate-800">Briefs</h3>
            <p className="text-xs text-slate-500">Write a brief, turn it into tickets, save it, then push when ready.</p>
          </div>
          <button
            onClick={resetBrief}
            className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
          >
            + New brief
          </button>
        </div>

        {savedDrafts.length > 0 && (
          <div className="border-t border-slate-100 pt-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Saved briefs</div>
            <div className="space-y-1">
              {savedDrafts.map((d) => (
                <div key={d.id} className="rounded-md border border-slate-200 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => void openDraft(d.id)}
                      className="min-w-0 flex-1 truncate text-left text-sm font-medium text-slate-700 hover:underline"
                    >
                      {d.title}
                    </button>
                    <button
                      onClick={() => void openDraft(d.id)}
                      className="shrink-0 rounded border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                    >
                      Open
                    </button>
                    <button
                      onClick={() => void deleteDraft(d.id)}
                      className="shrink-0 text-xs text-slate-400 hover:text-red-600"
                    >
                      Delete
                    </button>
                  </div>
                  <div className="mt-1 flex gap-3 text-[11px] text-slate-400">
                    <span>{d.status}</span>
                    <span>{d.updated_at ? `Updated ${new Date(d.updated_at).toLocaleString()}` : ''}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <input
            value={briefTitle}
            onChange={(e) => setBriefTitle(e.target.value)}
            maxLength={200}
            placeholder="Brief title"
            className={`${inputCls} min-w-[16rem] flex-1 font-medium`}
          />
          {draftId && <span className="text-xs text-slate-400">Draft #{draftId}</span>}
        </div>

        <label className="mb-1 block text-xs font-medium text-slate-600">Notes</label>
        <textarea
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          placeholder="Mobile checkout is broken…"
          className="min-h-[110px] w-full resize-y rounded-md border border-slate-200 p-2 text-sm"
        />

        {error && <div className="mt-3 rounded-md bg-red-50 p-2 text-xs text-red-700">{error}</div>}
        {notice && <div className="mt-3 rounded-md bg-slate-50 p-2 text-xs text-slate-600">{notice}</div>}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between border-b border-slate-100 pb-3">
          <div>
            <h3 className="text-base font-semibold text-slate-800">Tickets</h3>
            <p className="text-xs text-slate-500">Simple manual ticket drafting — no AI.</p>
          </div>
          <button
            onClick={addTicket}
            disabled={tickets.length >= 30}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            + Add ticket
          </button>
        </div>

        <div className="space-y-3">
          {tickets.length === 0 && (
            <div className="rounded-md border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">
              No tickets yet. Add one below.
            </div>
          )}

          {tickets.map((t, index) => (
            <div
              key={t.uid}
              className={`rounded-lg border p-4 ${
                t.state === 'pushed' ? 'border-green-200 bg-green-50/40' : 'border-slate-200'
              }`}
            >
              <div className="mb-3 flex items-center gap-2">
                <span className="text-xs font-semibold text-slate-400">#{index + 1}</span>
                {t.state === 'pushed' && <span className="text-xs font-medium text-green-700">Pushed</span>}
                {t.state === 'failed' && <span className="text-xs font-medium text-red-600">Failed</span>}
                <button
                  onClick={() => removeTicket(t.uid)}
                  className="ml-auto text-xs text-slate-400 hover:text-red-600"
                >
                  Delete ticket
                </button>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Project</label>
                  <select
                    value={t.projectId}
                    onChange={(e) => selectProject(t.uid, e.target.value)}
                    disabled={t.state === 'pushed'}
                    className={`${inputCls} w-full`}
                  >
                    <option value="">Select project…</option>
                    {projects.map((p) => (
                      <option key={p._id} value={p._id}>{p.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Task</label>
                  <input
                    value={t.title}
                    onChange={(e) => updateTicket(t.uid, { title: e.target.value })}
                    disabled={t.state === 'pushed'}
                    placeholder="Fix mobile checkout"
                    className={`${inputCls} w-full`}
                  />
                </div>
              </div>

              <div className="mt-3">
                <label className="mb-1 block text-xs font-medium text-slate-600">Description</label>
                <textarea
                  value={t.description}
                  onChange={(e) => updateTicket(t.uid, { description: e.target.value })}
                  disabled={t.state === 'pushed'}
                  placeholder="What needs to change?"
                  className="min-h-[80px] w-full resize-y rounded-md border border-slate-200 p-2 text-sm"
                />
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Priority</label>
                  <select
                    value={t.priority}
                    onChange={(e) => updateTicket(t.uid, { priority: e.target.value as TaskPriority })}
                    disabled={t.state === 'pushed'}
                    className={`${inputCls} w-full`}
                  >
                    {TASK_PRIORITIES.map((priority) => (
                      <option key={priority} value={priority}>{priority}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Assignee</label>
                  <select
                    value={t.assigneeId}
                    onChange={(e) => updateTicket(t.uid, { assigneeId: e.target.value })}
                    disabled={t.state === 'pushed'}
                    className={`${inputCls} w-full`}
                  >
                    <option value="">Select assignee…</option>
                    {employees.map((employee) => (
                      <option key={employee.employeeId} value={employee.employeeId}>{employee.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Estimate</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min="0"
                      step="0.5"
                      value={t.estimate_hours}
                      onChange={(e) =>
                        updateTicket(t.uid, {
                          estimate_hours: e.target.value === '' ? '' : Number(e.target.value),
                        })
                      }
                      disabled={t.state === 'pushed'}
                      className={`${inputCls} w-full`}
                    />
                    <span className="text-xs text-slate-400">h</span>
                  </div>
                </div>
              </div>

              {t.error && <div className="mt-2 text-xs text-red-600">{t.error}</div>}
            </div>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-3">
          <button
            onClick={() => void saveDraft()}
            disabled={saving || pushing}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save draft'}
          </button>
          <button
            onClick={() => void pushTickets()}
            disabled={pushing || saving || tickets.length === 0}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {pushing ? 'Pushing…' : 'Push'}
          </button>
        </div>
      </section>
    </div>
  );
}
