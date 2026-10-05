import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import type { Employee, Project, TaskPriority } from '../../types/pm';
import { TASK_PRIORITIES } from '../../types/pm';

type Ticket = {
  uid: string;
  title: string;
  description: string;
  level: string;
  estimate_hours: number | '';
  priority: TaskPriority;
  assigneeId: string;
  dueDate: string;
  state: 'draft' | 'pushed' | 'failed';
  error?: string | null;
};

type DraftSummary = {
  id: number;
  title: string;
  status: string;
  total: number;
  pushed: number;
  project_id: string | null;
  updated_at: string | null;
};

type Draft = DraftSummary & { brief: string; tickets: Ticket[] };

const input = 'rounded-md border border-slate-200 px-2 py-1.5 text-sm focus:border-slate-400 focus:outline-none';
const uid = () => `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const blankTicket = (title = ''): Ticket => ({
  uid: uid(),
  title,
  description: '',
  level: 'intern',
  estimate_hours: '',
  priority: 'Medium',
  assigneeId: '',
  dueDate: '',
  state: 'draft',
  error: null,
});

function errorText(e: any, fallback: string) {
  return e?.response?.data?.message || e?.response?.data?.error || fallback;
}

export default function PmDraftsPanel() {
  const [drafts, setDrafts] = useState<DraftSummary[]>([]);
  const [openId, setOpenId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newProject, setNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [creatingProject, setCreatingProject] = useState(false);
  const [converting, setConverting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [d, p, e] = await Promise.all([
        axios.get<{ drafts: DraftSummary[] }>('/pm/drafts'),
        axios.get<{ projects: Project[] }>('/pm/projects'),
        axios.get<{ employees: Employee[] }>('/pm/employees'),
      ]);
      setDrafts(d.data.drafts);
      setProjects(p.data.projects);
      setEmployees(e.data.employees);
    } catch (err) {
      setError(errorText(err, "Couldn't load saved briefs."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const currentProject = useMemo(() => projects.find((p) => p._id === draft?.project_id), [projects, draft?.project_id]);

  async function openDraft(id: number) {
    if (openId === id) {
      setOpenId(null);
      setDraft(null);
      return;
    }
    try {
      const { data } = await axios.get<{ draft: Draft }>(`/pm/drafts/${id}`);
      setDraft({ ...data.draft, tickets: data.draft.tickets || [] });
      setOpenId(id);
      setNewProject(false);
      setError(null);
    } catch (err) {
      setError(errorText(err, "Couldn't open that brief."));
    }
  }

  function newDraft() {
    const d: Draft = {
      id: 0,
      title: '',
      brief: '',
      status: 'draft',
      total: 0,
      pushed: 0,
      project_id: null,
      updated_at: null,
      tickets: [blankTicket()],
    };
    setDraft(d);
    setOpenId(0);
    setNewProject(false);
    setError(null);
    setMessage(null);
  }

  async function saveDraft() {
    if (!draft) return;
    if (!draft.title.trim() && !draft.brief.trim()) return setError('Write something in the brief first.');
    setSaving(true);
    setError(null);
    try {
      const payload = {
        title: draft.title.trim(),
        brief: draft.brief,
        project_id: draft.project_id,
        tickets: draft.tickets,
      };
      const res = draft.id
        ? await axios.patch<{ draft: DraftSummary }>(`/pm/drafts/${draft.id}`, payload)
        : await axios.post<{ draft: DraftSummary }>('/pm/drafts', payload);
      const saved = res.data.draft;
      setDraft((prev) => prev ? { ...prev, ...saved } : prev);
      setOpenId(saved.id);
      setDrafts((prev) => [saved, ...prev.filter((x) => x.id !== saved.id)]);
      setMessage('Draft saved.');
    } catch (err) {
      setError(errorText(err, "Couldn't save the draft."));
    } finally {
      setSaving(false);
    }
  }

  async function deleteDraft(id: number) {
    if (!window.confirm('Delete this saved brief?')) return;
    try {
      await axios.delete(`/pm/drafts/${id}`);
      setDrafts((prev) => prev.filter((x) => x.id !== id));
      if (openId === id) { setOpenId(null); setDraft(null); }
      setMessage('Draft deleted.');
    } catch (err) {
      setError(errorText(err, "Couldn't delete the draft."));
    }
  }

  async function verifyDraft() {
    if (!draft?.id) return saveDraft();
    setError(null);
    try {
      const { data } = await axios.post<{ draft: Draft }>(`/pm/drafts/${draft.id}/verify`);
      setDraft(data.draft);
      setDrafts((prev) => prev.map((x) => x.id === data.draft.id ? { ...x, ...data.draft } : x));
      setMessage(data.draft.status === 'verified' ? 'Brief verified.' : 'Verification removed.');
    } catch (err) {
      setError(errorText(err, "Couldn't update verification."));
    }
  }

  const setTicket = (ticketId: string, patch: Partial<Ticket>) =>
    setDraft((d) => d ? { ...d, tickets: d.tickets.map((t) => t.uid === ticketId ? { ...t, ...patch } : t) } : d);

  const addTicket = () => setDraft((d) => d ? { ...d, tickets: [...d.tickets, blankTicket()] } : d);
  const removeTicket = (ticketId: string) => setDraft((d) => d ? { ...d, tickets: d.tickets.filter((t) => t.uid !== ticketId) } : d);

  async function chooseOrCreateProject() {
    if (!draft) return null;
    if (!newProject) return draft.project_id || null;
    if (!newProjectName.trim()) {
      setError('Enter the new project name first.');
      return null;
    }
    setCreatingProject(true);
    try {
      const { data } = await axios.post<{ project: Project }>('/pm/projects', {
        name: newProjectName.trim(),
        description: draft.brief.trim().slice(0, 4000),
        status: 'Planning',
      });
      setProjects((prev) => [data.project, ...prev]);
      setDraft((d) => d ? { ...d, project_id: data.project._id } : d);
      setNewProject(false);
      setNewProjectName('');
      return data.project._id;
    } catch (err) {
      setError(errorText(err, "Couldn't create the project."));
      return null;
    } finally {
      setCreatingProject(false);
    }
  }

  async function convertToTickets() {
    if (!draft) return;
    if (draft.status !== 'verified') return setError('Verify the brief before converting it to tickets.');
    const incomplete = draft.tickets.filter((t) => !t.title.trim() || !t.assigneeId);
    if (incomplete.length) return setError('Every ticket needs a title and an assignee before conversion.');
    if (!draft.tickets.length) return setError('Add at least one ticket.');

    setConverting(true);
    setError(null);
    try {
      const projectId = await chooseOrCreateProject();
      if (!projectId) return;
      const { data } = await axios.post<{ results: Array<{ index: number; ok: boolean; error?: string }>; created: number; failed: number }>('/pm/brief/push', {
        project_id: projectId,
        tickets: draft.tickets.map((t) => ({
          title: t.title.trim(),
          description: t.description.trim(),
          level: t.level,
          estimate_hours: t.estimate_hours === '' ? null : Number(t.estimate_hours),
          priority: t.priority,
          assignee_employee_id: t.assigneeId,
          due_date: t.dueDate || null,
        })),
      });

      const results = new Map(data.results.map((r) => [r.index, r]));
      const nextTickets = draft.tickets.map((t, i) => {
        const r = results.get(i);
        return r?.ok ? { ...t, state: 'pushed' as const, error: null } : { ...t, state: 'failed' as const, error: r?.error || 'Failed' };
      });
      setDraft({ ...draft, project_id: projectId, tickets: nextTickets, status: data.failed ? 'partial' : 'pushed' });
      await axios.patch(`/pm/drafts/${draft.id}`, {
        title: draft.title,
        brief: draft.brief,
        project_id: projectId,
        tickets: nextTickets,
      });
      await load();
      setMessage(`${data.created} ticket${data.created === 1 ? '' : 's'} converted. ${data.failed ? `${data.failed} failed — review and retry.` : ''}`.trim());
    } catch (err) {
      setError(errorText(err, "Couldn't convert the brief to tickets."));
    } finally {
      setConverting(false);
    }
  }

  return (
    <section className="mb-5 rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div>
          <div className="text-sm font-semibold text-slate-800">Saved briefs</div>
          <div className="text-xs text-slate-500">Save any thought now. Verify and turn it into tickets later.</div>
        </div>
        <button onClick={newDraft} className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700">+ New draft</button>
      </div>

      {message && <div className="border-b border-emerald-100 bg-emerald-50 px-4 py-2 text-xs text-emerald-700">{message}</div>}
      {error && <div className="border-b border-rose-100 bg-rose-50 px-4 py-2 text-xs text-rose-700">{error}</div>}

      <div className="divide-y divide-slate-100">
        {loading && <div className="px-4 py-4 text-sm text-slate-500">Loading drafts…</div>}
        {!loading && !drafts.length && <div className="px-4 py-4 text-sm text-slate-400">No saved briefs yet.</div>}
        {drafts.map((d) => (
          <div key={d.id}>
            <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50">
              <button onClick={() => openDraft(d.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                <span className="text-slate-400">{openId === d.id ? '▾' : '▸'}</span>
                <span className="truncate text-sm font-medium text-slate-700">{d.title || 'Untitled draft'}</span>
                <span className="shrink-0 text-[11px] text-slate-400">{d.total} ticket{d.total === 1 ? '' : 's'} · {d.status}</span>
              </button>
              <button onClick={() => deleteDraft(d.id)} className="text-xs text-rose-600 hover:underline">Delete</button>
            </div>
            {openId === d.id && draft && <Editor />}
          </div>
        ))}
        {openId === 0 && draft && <Editor />}
      </div>

      {!loading && drafts.length > 0 && <div className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-400">Click a brief to expand/collapse it.</div>}
    </section>
  );

  function Editor() {
    if (!draft) return null;
    return (
      <div className="border-t border-slate-200 bg-slate-50 px-4 py-4">
        <div className="grid gap-3 md:grid-cols-[220px_1fr]">
          <input className={input} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="Brief title" />
          <textarea className={`${input} min-h-24`} value={draft.brief} onChange={(e) => setDraft({ ...draft, brief: e.target.value })} placeholder="Write anything you are thinking about…" />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button onClick={saveDraft} disabled={saving} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 disabled:opacity-50">{saving ? 'Saving…' : 'Save draft'}</button>
          <button onClick={verifyDraft} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700">{draft.status === 'verified' ? 'Unverify' : 'Verify brief'}</button>
          <span className="text-xs text-slate-500">Status: {draft.status}</span>
        </div>

        <div className="mt-5 rounded-md border border-slate-200 bg-white p-3">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <div className="text-xs font-semibold text-slate-700">Tickets to create</div>
              <div className="text-[11px] text-slate-400">Review and edit before converting. No AI is involved here.</div>
            </div>
            <button onClick={addTicket} className="text-xs font-medium text-slate-700 hover:underline">+ Add ticket</button>
          </div>

          <div className="space-y-3">
            {draft.tickets.map((t, i) => (
              <div key={t.uid} className="rounded-md border border-slate-200 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-600">Ticket {i + 1}</span>
                  <button onClick={() => removeTicket(t.uid)} className="text-xs text-rose-600 hover:underline">Delete</button>
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  <input className={input} value={t.title} onChange={(e) => setTicket(t.uid, { title: e.target.value })} placeholder="Ticket title" />
                  <select className={input} value={t.priority} onChange={(e) => setTicket(t.uid, { priority: e.target.value as TaskPriority })}>{TASK_PRIORITIES.map((p) => <option key={p}>{p}</option>)}</select>
                  <textarea className={`${input} min-h-20 md:col-span-2`} value={t.description} onChange={(e) => setTicket(t.uid, { description: e.target.value })} placeholder="Description / acceptance notes" />
                  <select className={input} value={t.assigneeId} onChange={(e) => setTicket(t.uid, { assigneeId: e.target.value })}>
                    <option value="">Assignee…</option>
                    {employees.map((e) => <option key={e.employeeId} value={e.employeeId}>{e.name}</option>)}
                  </select>
                  <div className="grid grid-cols-2 gap-2">
                    <input className={input} type="number" min="0" step="0.5" value={t.estimate_hours} onChange={(e) => setTicket(t.uid, { estimate_hours: e.target.value === '' ? '' : Number(e.target.value) })} placeholder="Hours" />
                    <input className={input} type="date" value={t.dueDate} onChange={(e) => setTicket(t.uid, { dueDate: e.target.value })} />
                  </div>
                </div>
                {t.error && <div className="mt-2 text-xs text-rose-600">{t.error}</div>}
              </div>
            ))}
          </div>
        </div>

        <div className="mt-4 rounded-md border border-slate-200 bg-white p-3">
          <div className="text-xs font-semibold text-slate-700">Project</div>
          <div className="mt-2 flex flex-wrap gap-2">
            <select className={`${input} min-w-64`} value={newProject ? '__new__' : (draft.project_id || '')} onChange={(e) => {
              if (e.target.value === '__new__') setNewProject(true);
              else { setNewProject(false); setDraft({ ...draft, project_id: e.target.value || null }); }
            }}>
              <option value="">Select a project…</option>
              {projects.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}
              <option value="__new__">+ New project</option>
            </select>
            {newProject && <input className={input} value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)} placeholder="New project name" />}
          </div>
          {currentProject && <div className="mt-1 text-[11px] text-slate-500">Selected: {currentProject.name}</div>}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <div className="text-[11px] text-slate-500">{draft.updated_at ? `Updated ${new Date(draft.updated_at).toLocaleString()}` : 'Not saved yet'}</div>
          <button onClick={convertToTickets} disabled={converting || draft.status !== 'verified'} className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-40">{converting ? 'Converting…' : 'Convert to tickets'}</button>
        </div>
      </div>
    );
  }
}
