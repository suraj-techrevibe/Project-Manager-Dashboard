import { useEffect, useMemo, useState } from 'react';
import { pmApi } from '../../lib/pmApi';
import { localISO } from '../../lib/meetingNotes';
import { workItemWarnings, workItemsToText } from '../../lib/minutesFormat';
import type { MeetingMinutesFull, MeetingMinutesSummary, MeetingWorkItem, MeetingWorkItemAction, MinutesStatus, Project } from '../../types/pm';
import { ErrorNote, Field, err, ghostBtn, inputCls, primaryBtn, dangerBtn, formatTimestamp, useEmployees } from './Projects/ui';

type Target = { minute: MeetingMinutesFull | null; copy: boolean };
const STEPS = ['Basics', 'Work Items', 'Review'] as const;
const blankAction = (): MeetingWorkItemAction => ({ task: '', due_date: null });
const blankWork = (): MeetingWorkItem => ({ owner: '', project: '', requirement: '', discussion: '', action_items: [blankAction()], due_date: null });
const normalizeWork = (w: MeetingWorkItem): MeetingWorkItem => ({ owner: w.owner ?? '', project: w.project ?? '', requirement: w.requirement ?? '', discussion: w.discussion ?? '', due_date: w.due_date ?? null, action_items: (w.action_items ?? []).map(a => ({ task: a.task ?? '', due_date: a.due_date ?? null })) });

export default function StructuredMeetingMinutesPanel() {
  const [minutes, setMinutes] = useState<MeetingMinutesSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Target | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<MeetingMinutesFull | null>(null);
  const [query, setQuery] = useState('');

  async function load() {
    setLoading(true); setError(null);
    try { const { data } = await pmApi.minutesList(); setMinutes(data.minutes); }
    catch (e) { setError(err(e, "Couldn't load meeting minutes.")); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function open(id: number) {
    if (openId === id) { setOpenId(null); setExpanded(null); return; }
    setOpenId(id); setExpanded(null);
    try { const { data } = await pmApi.minutesShow(id); setExpanded(data.minute); }
    catch (e) { setError(err(e, "Couldn't load that meeting.")); }
  }
  async function remove(id: number) {
    if (!confirm("Delete these minutes? This can't be undone.")) return;
    try { await pmApi.minutesDelete(id); setMinutes(m => m.filter(x => x.id !== id)); if (openId === id) setOpenId(null); }
    catch (e) { setError(err(e, "Couldn't delete that meeting.")); }
  }
  function saved(m: MeetingMinutesFull) {
    setEditing(null); setExpanded(m); setOpenId(m.id);
    setMinutes(ms => {
      const summary: MeetingMinutesSummary = { id: m.id, title: m.title, status: m.status, meeting_date: m.meeting_date, attendees: m.attendees, action_items: m.action_items ?? [], work_items: m.work_items ?? [] };
      return ms.some(x => x.id === m.id) ? ms.map(x => x.id === m.id ? summary : x) : [summary, ...ms];
    });
  }
  const visible = useMemo(() => { const q = query.trim().toLowerCase(); return minutes.filter(m => !q || m.title.toLowerCase().includes(q) || m.attendees.some(a => a.toLowerCase().includes(q))); }, [minutes, query]);

  if (editing) return <WorkItemWizard initial={editing.minute} copy={editing.copy} onCancel={() => setEditing(null)} onSaved={saved} />;

  return <div className="flex flex-col gap-4">
    <div className="flex items-center justify-between gap-3"><div><h3 className="text-sm font-medium text-slate-700">Meeting minutes</h3><p className="text-xs text-slate-400">Use Work Items for anything that should become a Taskmandu task.</p></div><button onClick={() => setEditing({ minute: null, copy: false })} className={primaryBtn}>New meeting</button></div>
    <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search meetings…" className={inputCls} />
    <ErrorNote message={error} />
    {loading && <p className="text-sm text-slate-500">Loading…</p>}
    {!loading && visible.length === 0 && <p className="text-sm text-slate-500">No meeting minutes yet.</p>}
    {visible.map(m => <div key={m.id} className="rounded-xl border border-slate-200 bg-white">
      <button onClick={() => open(m.id)} className="flex w-full items-center justify-between gap-3 p-4 text-left"><div><div className="font-medium text-slate-900">{m.title}</div><div className="mt-1 text-xs text-slate-500">{m.meeting_date} · {m.attendees.length} attendees · {m.work_items?.length ?? 0} work items</div></div><span className="text-slate-400">{openId === m.id ? '▲' : '▼'}</span></button>
      {openId === m.id && expanded && <div className="border-t border-slate-100 p-4"><MinuteDetail minute={expanded} onEdit={() => setEditing({ minute: expanded, copy: false })} onDuplicate={() => setEditing({ minute: expanded, copy: true })} onDelete={() => remove(m.id)} /></div>}
    </div>)}
  </div>;
}

function MinuteDetail({ minute, onEdit, onDuplicate, onDelete }: { minute: MeetingMinutesFull; onEdit: () => void; onDuplicate: () => void; onDelete: () => void }) {
  return <div className="flex flex-col gap-4">
    {minute.attendees.length > 0 && <div><div className="mb-1 text-xs font-medium text-slate-500">Attendees</div><p className="text-sm text-slate-700">{minute.attendees.join(', ')}</p></div>}
    <div><div className="mb-2 text-sm font-semibold text-slate-800">WORK ITEMS</div><div className="flex flex-col gap-3">{(minute.work_items ?? []).map((w, i) => <div key={i} className="rounded-lg border border-slate-200 p-3"><div className="font-medium text-slate-900">{i + 1}. {w.owner || 'Unassigned'}</div><div className="text-sm text-slate-600">{w.project || 'Project not specified'}</div><div className="mt-2 text-sm"><b>Requirement:</b> {w.requirement}</div>{w.discussion && <div className="mt-1 whitespace-pre-wrap text-sm text-slate-600"><b>Discussion:</b> {w.discussion}</div>}{w.action_items?.length > 0 && <div className="mt-2"><div className="text-xs font-medium text-slate-500">ACTION ITEMS</div><ul className="list-disc pl-5 text-sm text-slate-700">{w.action_items.map((a, j) => <li key={j}>{a.task}{a.due_date ? ` — due ${a.due_date}` : ''}</li>)}</ul></div>}<div className="mt-2 text-xs text-slate-500">Due date: {w.due_date || 'Not set'}</div></div>)}</div></div>
    <p className="text-xs text-slate-400">Created {formatTimestamp(minute.created_at)}{minute.created_by ? ` by ${minute.created_by}` : ''}</p>
    <div className="flex flex-wrap gap-2"><button onClick={onEdit} className={ghostBtn}>Edit</button><button onClick={onDuplicate} className={ghostBtn}>Duplicate</button><button onClick={onDelete} className={dangerBtn}>Delete</button></div>
  </div>;
}

function WorkItemWizard({ initial, copy, onCancel, onSaved }: { initial: MeetingMinutesFull | null; copy: boolean; onCancel: () => void; onSaved: (m: MeetingMinutesFull) => void }) {
  const isEdit = !!initial && !copy; const { employees } = useEmployees(); const [projects, setProjects] = useState<Project[]>([]);
  const [title, setTitle] = useState(copy ? '' : initial?.title ?? ''); const [date, setDate] = useState(copy || !initial ? localISO(new Date()) : initial.meeting_date); const [attendees, setAttendees] = useState<string[]>(copy ? [] : initial?.attendees ?? []);
  const [workItems, setWorkItems] = useState<MeetingWorkItem[]>(initial && !copy && initial.work_items?.length ? initial.work_items.map(normalizeWork) : [blankWork()]);
  const [status, setStatus] = useState<MinutesStatus>(copy ? 'draft' : initial?.status ?? 'draft'); const [error, setError] = useState<string | null>(null); const [saving, setSaving] = useState(false); const [attendeeSearch, setAttendeeSearch] = useState('');
  useEffect(() => { pmApi.projects().then(({ data }) => setProjects(data.projects)).catch(() => {}); }, []);
  const [step, setStep] = useState(0); const [copied, setCopied] = useState(false);
  const text = useMemo(() => workItemsToText({ title, meeting_date: date, attendees, work_items: workItems }), [title, date, attendees, workItems]);
  const warnings = useMemo(() => workItemWarnings(workItems, attendees), [workItems, attendees]);
  async function copyText() { try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ } }
  const shown = employees.filter(e => e.name.toLowerCase().includes(attendeeSearch.toLowerCase().trim()));
  const toggleAttendee = (n: string) => setAttendees(a => a.includes(n) ? a.filter(x => x !== n) : [...a, n]);
  const updateWork = (i: number, patch: Partial<MeetingWorkItem>) => setWorkItems(ws => ws.map((w,j) => j === i ? { ...w, ...patch } : w));
  const updateAction = (wi: number, ai: number, patch: Partial<MeetingWorkItemAction>) => setWorkItems(ws => ws.map((w,j) => j === wi ? { ...w, action_items: w.action_items.map((a,k) => k === ai ? { ...a, ...patch } : a) } : w));
  async function save(nextStatus: MinutesStatus) {
    const valid = workItems.filter(w => w.requirement.trim());
    if (!title.trim() || !date) { setStep(0); setError('Add a meeting title and date.'); return; }
    if (!valid.length) { setStep(1); setError('Add at least one Work Item with a Requirement.'); return; }
    setSaving(true); setError(null);
    try {
      const payload = { title: title.trim(), status: nextStatus, meeting_date: date, attendees, work_items: valid.map(w => ({ ...w, owner: w.owner.trim(), project: w.project.trim(), requirement: w.requirement.trim(), discussion: w.discussion.trim(), action_items: w.action_items.filter(a => a.task.trim()).map(a => ({ task: a.task.trim(), due_date: a.due_date || null })) })) };
      const { data } = isEdit ? await pmApi.minutesUpdate(initial!.id, payload) : await pmApi.minutesCreate(payload);
      onSaved(data.minute);
    } catch (e) { setError(err(e, "Couldn't save these minutes.")); }
    finally { setSaving(false); }
  }
  return <div className="flex flex-col gap-4">
    <button onClick={onCancel} className="self-start text-sm text-slate-500 hover:text-slate-700">← Back to list</button>
    <div><h3 className="text-base font-semibold text-slate-800">Meeting Minutes</h3><p className="text-xs text-slate-500">Agenda and general discussion are not ticket sources. Only Work Items are used for Taskmandu conversion.</p></div>
    <div className="flex flex-wrap gap-1.5">{STEPS.map((label, i) => <button key={label} onClick={() => setStep(i)} className={`rounded-full px-3 py-1 text-xs ${i === step ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{i + 1}. {label}</button>)}</div>
    {step === 0 && <div className="rounded-xl border border-slate-200 bg-white p-4"><div className="grid gap-3 md:grid-cols-2"><Field label="Meeting"><input value={title} onChange={e => setTitle(e.target.value)} placeholder="Daily standup — DevOps" className={inputCls} /></Field><Field label="Date"><input type="date" value={date} onChange={e => setDate(e.target.value)} className={inputCls} /></Field></div>
      <Field label="Attendees"><div className="flex flex-col gap-2"><input value={attendeeSearch} onChange={e => setAttendeeSearch(e.target.value)} placeholder="Search team…" className={inputCls} /><div className="grid max-h-40 grid-cols-2 gap-1 overflow-y-auto rounded-md border border-slate-200 p-2">{shown.map(e => <label key={e.employeeId} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={attendees.includes(e.name)} onChange={() => toggleAttendee(e.name)} /><span>{e.name}</span></label>)}</div><div className="text-xs text-slate-400">{attendees.join(', ') || 'No attendees selected'}</div></div></Field>
    </div>}
    {step === 1 && <div className="flex flex-col gap-4"><div className="flex items-center justify-between"><div><h4 className="text-sm font-semibold text-slate-800">WORK ITEMS</h4><p className="text-xs text-slate-500">One Work Item = one Task. Action Items = Subtasks.</p></div><button onClick={() => setWorkItems(ws => [...ws, blankWork()])} className={ghostBtn}>+ Add Work Item</button></div>
      {workItems.map((w,i) => <div key={i} className="rounded-xl border border-slate-200 bg-white p-4"><div className="mb-3 flex items-center justify-between"><span className="text-sm font-semibold text-slate-700">Work Item {i + 1}</span>{workItems.length > 1 && <button onClick={() => setWorkItems(ws => ws.filter((_,j) => j !== i))} className="text-xs text-red-500">Remove</button>}</div>
        <div className="grid gap-3 md:grid-cols-2"><Field label="Person / Owner"><select value={w.owner} onChange={e => updateWork(i,{owner:e.target.value})} className={inputCls}><option value="">Select owner…</option>{employees.map(e => <option key={e.employeeId} value={e.name}>{e.name}</option>)}</select></Field><Field label="Business / Project"><input list={`mm-projects-${i}`} value={w.project} onChange={e => updateWork(i,{project:e.target.value})} placeholder="Ad Consult" className={inputCls} /><datalist id={`mm-projects-${i}`}>{projects.map(p => <option key={p._id} value={p.name} />)}</datalist><p className="mt-1 text-[11px] text-slate-400">Existing project is suggested; a new name can be confirmed/created during ticket generation.</p></Field></div>
        <Field label="Requirement (becomes Task title)"><input value={w.requirement} onChange={e => updateWork(i,{requirement:e.target.value})} placeholder="Make home page responsive" className={inputCls} /></Field>
        <Field label="Discussion (becomes Task description)"><textarea value={w.discussion} onChange={e => updateWork(i,{discussion:e.target.value})} rows={3} placeholder="Homepage needs to work correctly on mobile and tablet." className={inputCls} /></Field>
        <Field label="ACTION ITEMS (become Subtasks)"><div className="flex flex-col gap-2">{w.action_items.map((a,j) => <div key={j} className="flex flex-wrap gap-2"><input value={a.task} onChange={e => updateAction(i,j,{task:e.target.value})} placeholder="Update responsive layout" className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1 text-sm" /><input type="date" value={a.due_date ?? ''} onChange={e => updateAction(i,j,{due_date:e.target.value || null})} className="rounded-md border border-slate-300 px-2 py-1 text-sm" /><button onClick={() => updateWork(i,{action_items:w.action_items.filter((_,k)=>k!==j)})} className="text-slate-400 hover:text-red-600">✕</button></div>)}<button onClick={() => updateWork(i,{action_items:[...w.action_items,blankAction()]})} className="self-start text-xs text-slate-500 hover:text-slate-700">+ Add action item</button></div></Field>
        <Field label="Due date"><input type="date" value={w.due_date ?? ''} onChange={e => updateWork(i,{due_date:e.target.value || null})} className={inputCls} /></Field>
      </div>)}
    </div>}
    {step === 2 && <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between"><div className="text-xs font-medium text-slate-500">Everything in this meeting, in one place</div><button onClick={copyText} className={ghostBtn}>{copied ? 'Copied ✓' : 'Copy as text'}</button></div>
      <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-sm text-slate-800">{text}</pre>
      {warnings.length > 0 && <ul className="list-inside list-disc text-xs text-amber-700">{warnings.map((x) => <li key={x}>{x}</li>)}</ul>}
    </div>}
    <ErrorNote message={error} />
    <div className="flex flex-wrap items-center justify-between gap-2"><button onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0} className={`${ghostBtn} disabled:opacity-40`}>Back</button><div className="flex gap-2"><button onClick={() => save('draft')} disabled={saving} className={ghostBtn}>{saving ? 'Saving…' : 'Save draft'}</button>{step === STEPS.length - 1 ? <button onClick={() => save('final')} disabled={saving} className={primaryBtn}>Save as final</button> : <button onClick={() => setStep((s) => s + 1)} className={primaryBtn}>Next</button>}</div></div>
  </div>;
}
