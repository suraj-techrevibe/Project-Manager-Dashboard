import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import type { Employee, Project, TaskPriority } from '../../types/pm';
import { TASK_PRIORITIES } from '../../types/pm';

type Ticket = {
  uid: string; title: string; description: string; level: string; estimate_hours: number | '';
  priority: TaskPriority; assigneeId: string; dueDate: string; state: 'draft' | 'pushed' | 'failed'; error?: string | null;
};
type Summary = { id: number; title: string; status: string; total: number; pushed: number; project_id: string | null; updated_at: string | null };
type Draft = Summary & { brief: string; tickets: Ticket[] };
const input = 'rounded-md border border-slate-200 px-2 py-1.5 text-sm focus:border-slate-400 focus:outline-none';
const makeUid = () => `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const blank = (title = '', description = ''): Ticket => ({ uid: makeUid(), title, description, level: 'intern', estimate_hours: '', priority: 'Medium', assigneeId: '', dueDate: '', state: 'draft', error: null });
const errText = (e: any, fallback: string) => e?.response?.data?.message || e?.response?.data?.error || fallback;

export default function PmDraftsPanelV2() {
  const [drafts, setDrafts] = useState<Summary[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [newProject, setNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [converting, setConverting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [d, p, e] = await Promise.all([
        axios.get<{ drafts: Summary[] }>('/pm/drafts'),
        axios.get<{ projects: Project[] }>('/pm/projects'),
        axios.get<{ employees: Employee[] }>('/pm/employees'),
      ]);
      setDrafts(d.data.drafts); setProjects(p.data.projects); setEmployees(e.data.employees);
    } catch (e) { setError(errText(e, "Couldn't load saved briefs.")); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const currentProject = useMemo(() => projects.find((p) => p._id === draft?.project_id), [projects, draft?.project_id]);

  async function openDraft(id: number) {
    if (openId === id) { setOpenId(null); setDraft(null); return; }
    try {
      const { data } = await axios.get<{ draft: Draft }>(`/pm/drafts/${id}`);
      // Full draft is always loaded from the server, including the latest pushed/failed ticket states.
      setDraft({ ...data.draft, tickets: data.draft.tickets || [] }); setOpenId(id); setNewProject(false); setError(null); setMessage(null);
    } catch (e) { setError(errText(e, "Couldn't open that brief.")); }
  }

  function newDraft() {
    setDraft({ id: 0, title: '', brief: '', status: 'draft', total: 0, pushed: 0, project_id: null, updated_at: null, tickets: [] });
    setOpenId(0); setNewProject(false); setError(null); setMessage(null);
  }

  async function saveDraft() {
    if (!draft) return;
    if (!draft.title.trim() && !draft.brief.trim()) return setError('Write something in Requirements first.');
    setSaving(true); setError(null);
    try {
      const payload = { title: draft.title.trim(), brief: draft.brief, project_id: draft.project_id, tickets: draft.tickets };
      const res = draft.id ? await axios.patch<{ draft: Summary }>(`/pm/drafts/${draft.id}`, payload) : await axios.post<{ draft: Summary }>('/pm/drafts', payload);
      const saved = res.data.draft;
      setDraft((d) => d ? { ...d, ...saved } : d); setOpenId(saved.id);
      setDrafts((xs) => [saved, ...xs.filter((x) => x.id !== saved.id)]);
      setMessage('Draft saved. Requirements and ticket edits are stored.');
    } catch (e) { setError(errText(e, "Couldn't save the draft.")); }
    finally { setSaving(false); }
  }

  async function verify() {
    if (!draft) return;
    if (!draft.id) { await saveDraft(); return; }
    try {
      // Save first so verification always reflects the current edited requirements and ticket list.
      const payload = { title: draft.title.trim(), brief: draft.brief, project_id: draft.project_id, tickets: draft.tickets };
      await axios.patch(`/pm/drafts/${draft.id}`, payload);
      const { data } = await axios.post<{ draft: Draft }>(`/pm/drafts/${draft.id}/verify`);
      setDraft({ ...data.draft, tickets: data.draft.tickets || [] });
      setDrafts((xs) => xs.map((x) => x.id === data.draft.id ? { ...x, ...data.draft } : x));
      setMessage(data.draft.status === 'verified' ? 'Brief verified.' : 'Verification removed.'); setError(null);
    } catch (e) { setError(errText(e, "Couldn't verify the brief.")); }
  }

  function buildTickets() {
    if (!draft?.brief.trim()) return setError('Add some requirements first.');
    const lines = draft.brief.split(/\r?\n/).map((x) => x.trim().replace(/^[-*•\d.)]+\s*/, '')).filter(Boolean);
    if (!lines.length) return setError('No requirement lines found.');
    const existingPushed = draft.tickets.filter((t) => t.state === 'pushed');
    const fresh = lines.slice(0, 30 - existingPushed.length).map((line) => blank(line));
    setDraft({ ...draft, tickets: [...existingPushed, ...fresh], status: 'draft' });
    setMessage(`Built ${fresh.length} editable ticket${fresh.length === 1 ? '' : 's'} from the current requirements. Review them before converting.`);
    setError(null);
  }

  const updateTicket = (uid: string, patch: Partial<Ticket>) => setDraft((d) => d ? { ...d, tickets: d.tickets.map((t) => t.uid === uid ? { ...t, ...patch } : t), status: d.status === 'verified' ? 'draft' : d.status } : d);
  const addTicket = () => setDraft((d) => d ? { ...d, tickets: [...d.tickets, blank()], status: d.status === 'verified' ? 'draft' : d.status } : d);
  const removeTicket = (uid: string) => setDraft((d) => d ? { ...d, tickets: d.tickets.filter((t) => t.uid !== uid), status: d.status === 'verified' ? 'draft' : d.status } : d);

  async function selectOrCreateProject() {
    if (!draft) return null;
    if (!newProject) return draft.project_id || null;
    if (!newProjectName.trim()) { setError('Enter a new project name.'); return null; }
    try {
      const { data } = await axios.post<{ project: Project }>('/pm/projects', { name: newProjectName.trim(), description: draft.brief.slice(0, 4000), status: 'Planning' });
      setProjects((xs) => [data.project, ...xs]); setDraft((d) => d ? { ...d, project_id: data.project._id } : d);
      setNewProject(false); setNewProjectName(''); return data.project._id;
    } catch (e) { setError(errText(e, "Couldn't create the project.")); return null; }
  }

  async function convert() {
    if (!draft) return;
    if (draft.status !== 'verified') return setError('Verify the brief before converting it to tickets.');
    if (!draft.tickets.length) return setError('Build or add at least one ticket first.');
    if (draft.tickets.some((t) => !t.title.trim() || !t.assigneeId)) return setError('Every ticket needs a title and assignee.');
    setConverting(true); setError(null);
    try {
      const projectId = await selectOrCreateProject(); if (!projectId) return;
      const { data } = await axios.post<{ results: Array<{ index: number; ok: boolean; error?: string }>; created: number; failed: number }>('/pm/brief/push', {
        project_id: projectId,
        tickets: draft.tickets.filter((t) => t.state !== 'pushed').map((t) => ({ title: t.title.trim(), description: t.description.trim(), level: t.level, estimate_hours: t.estimate_hours === '' ? null : Number(t.estimate_hours), priority: t.priority, assignee_employee_id: t.assigneeId, due_date: t.dueDate || null })),
      });
      const pending = draft.tickets.filter((t) => t.state !== 'pushed');
      const resultByPendingIndex = new Map(data.results.map((r) => [r.index, r]));
      let pendingIndex = 0;
      const next = draft.tickets.map((t) => {
        if (t.state === 'pushed') return t;
        const r = resultByPendingIndex.get(pendingIndex++);
        return r?.ok ? { ...t, state: 'pushed' as const, error: null } : { ...t, state: 'failed' as const, error: r?.error || 'Failed' };
      });
      const nextDraft = { ...draft, project_id: projectId, tickets: next, status: data.failed ? 'partial' : 'pushed' };
      setDraft(nextDraft);
      if (draft.id) {
        await axios.patch(`/pm/drafts/${draft.id}`, { title: draft.title, brief: draft.brief, project_id: projectId, tickets: next });
        const refreshed = await axios.get<{ draft: Draft }>(`/pm/drafts/${draft.id}`);
        setDraft({ ...refreshed.data.draft, tickets: refreshed.data.draft.tickets || [] });
      }
      await load();
      setMessage(`${data.created} ticket${data.created === 1 ? '' : 's'} created. ${data.failed ? `${data.failed} failed — fix and retry.` : 'Created-ticket state is saved.'}`);
    } catch (e) { setError(errText(e, "Couldn't convert the brief to tickets.")); }
    finally { setConverting(false); }
  }

  async function removeDraft(id: number) {
    if (!window.confirm('Delete this saved brief?')) return;
    try { await axios.delete(`/pm/drafts/${id}`); setDrafts((xs) => xs.filter((x) => x.id !== id)); if (openId === id) { setOpenId(null); setDraft(null); } } catch (e) { setError(errText(e, "Couldn't delete the brief.")); }
  }

  return <section className="mb-5 rounded-lg border border-slate-200 bg-white">
    <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
      <div><div className="text-sm font-semibold text-slate-800">Saved briefs</div><div className="text-xs text-slate-500">Save rough requirements now. Review later, then create tickets.</div></div>
      <button onClick={newDraft} className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white">+ New draft</button>
    </div>
    {message && <div className="border-b border-emerald-100 bg-emerald-50 px-4 py-2 text-xs text-emerald-700">{message}</div>}
    {error && <div className="border-b border-rose-100 bg-rose-50 px-4 py-2 text-xs text-rose-700">{error}</div>}
    <div className="divide-y divide-slate-100">
      {loading && <div className="px-4 py-4 text-sm text-slate-500">Loading drafts…</div>}
      {!loading && !drafts.length && <div className="px-4 py-4 text-sm text-slate-400">No saved briefs yet.</div>}
      {drafts.map((d) => <div key={d.id}>
        <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50">
          <button onClick={() => openDraft(d.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left"><span className="text-slate-400">{openId === d.id ? '▾' : '▸'}</span><span className="truncate text-sm font-medium text-slate-700">{d.title || 'Untitled draft'}</span><span className="shrink-0 text-[11px] text-slate-400">{d.total} ticket{d.total === 1 ? '' : 's'} · {d.status}</span></button>
          <button onClick={() => removeDraft(d.id)} className="text-xs text-rose-600 hover:underline">Delete</button>
        </div>
        {openId === d.id && draft && <Editor />}
      </div>)}
      {openId === 0 && draft && <Editor />}
    </div>
  </section>;

  function Editor() {
    if (!draft) return null;
    return <div className="border-t border-slate-200 bg-slate-50 px-4 py-4">
      <div className="rounded-md border border-slate-200 bg-white p-3">
        <div className="mb-2 text-xs font-semibold text-slate-700">Project</div>
        {!newProject ? <div className="flex flex-col gap-2 md:flex-row">
          <select className={`${input} flex-1`} value={draft.project_id || ''} onChange={(e) => setDraft({ ...draft, project_id: e.target.value || null })}>
            <option value="">Select existing project…</option>{projects.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}
          </select>
          <button onClick={() => setNewProject(true)} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium">+ New project</button>
        </div> : <div className="flex flex-col gap-2 md:flex-row">
          <input className={`${input} flex-1`} value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)} placeholder="New project name" />
          <button onClick={selectOrCreateProject} className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white">Create project</button>
          <button onClick={() => { setNewProject(false); setNewProjectName(''); }} className="text-xs text-slate-500">Cancel</button>
        </div>}
        {currentProject && <div className="mt-1 text-[11px] text-slate-400">Ticket destination: <span className="font-medium text-slate-600">{currentProject.name}</span></div>}
      </div>

      <div className="mt-3 rounded-md border border-slate-200 bg-white p-3">
        <label className="mb-1 block text-xs font-semibold text-slate-700">Heading</label>
        <input className={`${input} w-full`} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value, status: draft.status === 'verified' ? 'draft' : draft.status })} placeholder="Brief heading" />
        <label className="mb-1 mt-3 block text-xs font-semibold text-slate-700">Requirements</label>
        <textarea className={`${input} min-h-40 w-full`} value={draft.brief} onChange={(e) => setDraft({ ...draft, brief: e.target.value, status: draft.status === 'verified' ? 'draft' : draft.status })} placeholder="Write anything here. Edit it freely before verification." />
        <div className="mt-2 text-[11px] text-slate-400">Save draft stores exactly what you see here. It does not create Taskmandu tickets.</div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button onClick={saveDraft} disabled={saving} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium">{saving ? 'Saving…' : 'Save draft'}</button>
        <button onClick={verify} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium">{draft.status === 'verified' ? 'Unverify' : 'Verify brief'}</button>
        <span className="text-xs text-slate-500">Status: {draft.status}</span>
      </div>

      <div className="mt-5 rounded-md border border-slate-200 bg-white p-3">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><div className="text-xs font-semibold text-slate-700">Tickets to create</div><div className="text-[11px] text-slate-400">Edit these before conversion. No AI is used.</div></div><div className="flex gap-2"><button onClick={buildTickets} className="text-xs font-medium text-slate-700 hover:underline">Build from requirements</button><button onClick={addTicket} className="text-xs font-medium text-slate-700 hover:underline">+ Add ticket</button></div></div>
        {!draft.tickets.length && <div className="rounded border border-dashed border-slate-200 px-3 py-5 text-center text-xs text-slate-400">No tickets yet. Build them from the requirements or add one manually.</div>}
        <div className="space-y-3">
          {draft.tickets.map((t, i) => <div key={t.uid} className="rounded-md border border-slate-200 p-3">
            <div className="mb-2 flex items-center justify-between"><span className="text-xs font-semibold text-slate-600">Ticket {i + 1}{t.state === 'pushed' ? ' · Created' : t.state === 'failed' ? ' · Failed' : ''}</span><button onClick={() => removeTicket(t.uid)} className="text-xs text-rose-600 hover:underline">Delete</button></div>
            <div className="grid gap-2 md:grid-cols-2">
              <input className={input} value={t.title} onChange={(e) => updateTicket(t.uid, { title: e.target.value, state: 'draft' })} placeholder="Ticket title" />
              <select className={input} value={t.priority} onChange={(e) => updateTicket(t.uid, { priority: e.target.value as TaskPriority, state: 'draft' })}>{TASK_PRIORITIES.map((p) => <option key={p}>{p}</option>)}</select>
              <textarea className={`${input} min-h-20 md:col-span-2`} value={t.description} onChange={(e) => updateTicket(t.uid, { description: e.target.value, state: 'draft' })} placeholder="Description / acceptance notes" />
              <select className={input} value={t.assigneeId} onChange={(e) => updateTicket(t.uid, { assigneeId: e.target.value, state: 'draft' })}><option value="">Select assignee…</option>{employees.map((e) => <option key={e.employeeId} value={e.employeeId}>{e.name}</option>)}</select>
              <input className={input} type="number" min="0" step="0.5" value={t.estimate_hours} onChange={(e) => updateTicket(t.uid, { estimate_hours: e.target.value === '' ? '' : Number(e.target.value), state: 'draft' })} placeholder="Estimate hours" />
              <input className={input} type="date" value={t.dueDate} onChange={(e) => updateTicket(t.uid, { dueDate: e.target.value, state: 'draft' })} />
              {t.error && <div className="text-xs text-rose-600 md:col-span-2">{t.error}</div>}
            </div>
          </div>)}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3"><button onClick={convert} disabled={converting} className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">{converting ? 'Converting…' : 'Convert to tickets'}</button><span className="text-[11px] text-slate-400">Only tickets not already marked Created are sent.</span></div>
      </div>
    </div>;
  }
}
