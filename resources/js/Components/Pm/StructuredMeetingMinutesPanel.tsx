import { useEffect, useMemo, useState } from 'react';
import TaskmanduActivityMinutes from './TaskmanduActivityMinutes';
import { pmApi } from '../../lib/pmApi';
import { localISO } from '../../lib/meetingNotes';
import { splitProjectNames, workItemHasContent, workItemTitle, workItemWarnings, workItemsToText } from '../../lib/minutesFormat';
import { type OwnerResult, parseMeetingText } from '../../lib/parseMeetingText';
import type { MeetingMinutesFull, MeetingMinutesSummary, MeetingWorkItem, MeetingWorkItemAction, MinutesStatus, Project } from '../../types/pm';
import { ErrorNote, Field, err, ghostBtn, inputCls, primaryBtn, dangerBtn, formatTimestamp, useEmployees } from './Projects/ui';

type Target = { minute: MeetingMinutesFull | null; copy: boolean; paste?: boolean };

/** Same name = same project: ignore case and extra spaces, nothing fuzzier (so "new project" never lands on "New Project Alpha"). */
const normName = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
const matchProject = (name: string, list: Project[]): Project | null => {
  const k = normName(name);
  return k ? list.find((p) => normName(p.name) === k) ?? null : null;
};
const STEPS = ['Basics', 'Work Items', 'Review'] as const;
const blankAction = (): MeetingWorkItemAction => ({ task: '', due_date: null });
const blankWork = (): MeetingWorkItem => ({ owner: '', project: '', project_id: null, requirement: '', discussion: '', action_items: [blankAction()], due_date: null });
const normalizeWork = (w: MeetingWorkItem): MeetingWorkItem => ({ owner: w.owner ?? '', project: w.project ?? '', project_id: w.project_id ?? null, requirement: w.requirement ?? '', discussion: w.discussion ?? '', due_date: w.due_date ?? null, action_items: (w.action_items ?? []).map(a => ({ task: a.task ?? '', due_date: a.due_date ?? null })) });

export default function StructuredMeetingMinutesPanel() {
  const [minutes, setMinutes] = useState<MeetingMinutesSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Target | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<MeetingMinutesFull | null>(null);
  const [query, setQuery] = useState('');
  const [activityBuilderOpen, setActivityBuilderOpen] = useState(false);

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

  if (activityBuilderOpen) return <TaskmanduActivityMinutes onCancel={() => setActivityBuilderOpen(false)} onSaved={(m) => { setActivityBuilderOpen(false); saved(m); void load(); }} lastMeetingDate={[...minutes.map(m => m.meeting_date)].sort().pop() ?? null} />;
  if (editing) return <WorkItemWizard initial={editing.minute} copy={editing.copy} startPaste={!!editing.paste} onCancel={() => setEditing(null)} onSaved={saved} />;

  return <div className="flex flex-col gap-4">
    <div className="flex items-center justify-between gap-3"><div><h3 className="text-sm font-medium text-slate-700">Meeting minutes</h3><p className="text-xs text-slate-400">Use Work Items for anything that should become a Taskmandu task.</p></div><div className="flex flex-wrap gap-2"><button onClick={() => setActivityBuilderOpen(true)} className={ghostBtn}>Build from Taskmandu activity</button><button onClick={() => setEditing({ minute: null, copy: false, paste: true })} className={ghostBtn} title="Paste your meeting notes and fill the work items automatically">Paste notes</button><button onClick={() => setEditing({ minute: null, copy: false })} className={primaryBtn}>New meeting</button></div></div>
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

function WorkItemWizard({ initial, copy, startPaste = false, onCancel, onSaved }: { initial: MeetingMinutesFull | null; copy: boolean; startPaste?: boolean; onCancel: () => void; onSaved: (m: MeetingMinutesFull) => void }) {
  const isEdit = !!initial && !copy; const { employees } = useEmployees(); const [projects, setProjects] = useState<Project[]>([]);
  const [title, setTitle] = useState(copy ? '' : initial?.title ?? ''); const [date, setDate] = useState(copy || !initial ? localISO(new Date()) : initial.meeting_date); const [attendees, setAttendees] = useState<string[]>(copy ? [] : initial?.attendees ?? []);
  const [workItems, setWorkItems] = useState<MeetingWorkItem[]>(initial && !copy && initial.work_items?.length ? initial.work_items.map(normalizeWork) : [blankWork()]);
  const [status, setStatus] = useState<MinutesStatus>(copy ? 'draft' : initial?.status ?? 'draft'); const [error, setError] = useState<string | null>(null); const [saving, setSaving] = useState(false); const [attendeeSearch, setAttendeeSearch] = useState('');
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  useEffect(() => { pmApi.projects().then(({ data }) => { setProjects(data.projects); setProjectsLoaded(true); }).catch(() => {}); }, []);
  const [step, setStep] = useState(0); const [copied, setCopied] = useState(false);
  // Paste-notes mode: one big box instead of the step-by-step form.
  const [pasting, setPasting] = useState(startPaste && !initial);
  const [pasteText, setPasteText] = useState('');
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [pasteNotes, setPasteNotes] = useState<string[]>([]);
  const [ownerHints, setOwnerHints] = useState<Record<number, OwnerResult>>({});
  // After a paste, empty fields get a red box. It's a warning only — nothing here blocks saving or pushing.
  const [showWarn, setShowWarn] = useState(false);
  const bad = (empty: boolean) => (showWarn && empty ? '!border-red-400 !bg-red-50 focus:!border-red-500' : '');
  const emptyFields = useMemo(() => workItems.reduce((n, w) => n + [!w.owner.trim(), !w.project.trim(), !w.requirement.trim(), !w.discussion.trim(), !w.action_items.some(a => a.task.trim()), !w.due_date].filter(Boolean).length, 0), [workItems]);

  function parsePaste() {
    const result = parseMeetingText(pasteText, employees);
    if (!result.workItems.length) { setPasteError(result.notes[0] ?? 'Nothing to import.'); return; }
    const hasWork = title.trim() || workItems.some(workItemHasContent);
    if (hasWork && !confirm('Replace what is already in this form with the pasted notes?')) return;
    setTitle(result.title || title);
    if (result.date) setDate(result.date);
    setAttendees(result.attendees);
    setWorkItems(result.workItems);
    setOwnerHints(Object.fromEntries(result.owners.map((o, i) => [i, o]).filter(([, o]) => (o as OwnerResult).hint)));
    setPasteNotes([...result.notes, ...(employees.length ? [] : ['The team list had not loaded, so owners were left blank — pick them below.'])]);
    setShowWarn(true); setPasteError(null); setPasting(false); setStep(1); setError(null);
  }
  const removeWork = (i: number) => {
    setWorkItems(ws => ws.filter((_, j) => j !== i));
    setOwnerHints(h => Object.fromEntries(Object.entries(h).filter(([k]) => +k !== i).map(([k, v]) => [+k > i ? +k - 1 : +k, v])));
  };
  /** Typed naturally during the meeting as "Techmandu, Remit, Adxpress" — split into one Work Item per
   *  business now, each a full copy (same owner/requirement/discussion/due date), so each can push its own ticket. */
  const splitWork = (i: number) => {
    const names = splitProjectNames(workItems[i].project);
    if (names.length < 2) return;
    setWorkItems(ws => {
      const clones = names.map((name) => ({ ...ws[i], project: name, project_id: null, action_items: ws[i].action_items.map((a) => ({ ...a })) }));
      return [...ws.slice(0, i), ...clones, ...ws.slice(i + 1)];
    });
    setOwnerHints(h => {
      const shift = names.length - 1;
      const out: Record<number, OwnerResult> = {};
      for (const [kStr, v] of Object.entries(h)) {
        const k = +kStr;
        if (k < i) out[k] = v;
        else if (k === i) names.forEach((_, j) => { out[i + j] = v; });
        else out[k + shift] = v;
      }
      return out;
    });
  };
  const [carryBusy, setCarryBusy] = useState(false);
  const [carryMsg, setCarryMsg] = useState<string | null>(null);
  /** Start from where the last meeting left off: its unfinished Work Items plus overdue / blocked / stuck board tasks. */
  async function carryOver() {
    setCarryBusy(true); setCarryMsg(null);
    try {
      const { data } = await pmApi.minutesCarryOver();
      const have = new Set(workItems.map(w => `${normName(w.requirement)}|${normName(w.project)}`));
      // Deduplicate both against the form and within the carry-over response itself.
      const fresh = data.work_items.map(w => ({ ...normalizeWork(w), note: w.note })).filter(w => {
        const key = `${normName(w.requirement)}|${normName(w.project)}`;
        if (have.has(key)) return false;
        have.add(key);
        return true;
      });
      if (!fresh.length) { setCarryMsg(data.work_items.length ? 'Those items are already in this meeting.' : 'Nothing to carry over: the last meeting is finished and nothing on the board is overdue, blocked or stuck.'); return; }
      const base = workItems.length === 1 && !workItemHasContent(workItems[0]) ? [] : workItems; // replace the blank starter item
      setWorkItems([...base, ...fresh]);
      const added = fresh.length;
      setCarryMsg(`Added ${added} Work Item${added === 1 ? '' : 's'}${data.from ? ` (${data.from_meeting} unfinished from “${data.from.title}”, ${data.from_board} from the board)` : ` from the board`}. Check owners and due dates, remove what you don't need.`);
    } catch (e) { setCarryMsg(err(e, "Couldn't load carry-over items.")); }
    finally { setCarryBusy(false); }
  }
  const text = useMemo(() => workItemsToText({ title, meeting_date: date, attendees, work_items: workItems }), [title, date, attendees, workItems]);
  const warnings = useMemo(() => workItemWarnings(workItems, attendees), [workItems, attendees]);
  async function copyText() { try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ } }
  const shown = employees.filter(e => e.name.toLowerCase().includes(attendeeSearch.toLowerCase().trim()));
  const toggleAttendee = (n: string) => setAttendees(a => a.includes(n) ? a.filter(x => x !== n) : [...a, n]);
  const updateWork = (i: number, patch: Partial<MeetingWorkItem>) => setWorkItems(ws => ws.map((w,j) => j === i ? { ...w, ...patch } : w));
  const updateAction = (wi: number, ai: number, patch: Partial<MeetingWorkItemAction>) => setWorkItems(ws => ws.map((w,j) => j === wi ? { ...w, action_items: w.action_items.map((a,k) => k === ai ? { ...a, ...patch } : a) } : w));
  async function resolveProjects(items: MeetingWorkItem[], createMissing: boolean): Promise<MeetingWorkItem[]> {
    // Always check Taskmandu's current list, so a project made a minute ago in another meeting isn't created twice.
    let list = projects;
    try { list = (await pmApi.projects()).data.projects; setProjects(list); setProjectsLoaded(true); }
    catch { if (createMissing) throw new Error("Couldn't load the project list from Taskmandu, so no project was created and nothing was saved. Try again, or use Save draft."); }

    const made = new Map<string, Project>();
    const out: MeetingWorkItem[] = [];
    for (const w of items) {
      const name = w.project.trim();
      if (!name) { out.push({ ...w, project: '', project_id: null }); continue; }
      const key = normName(name);
      if (!createMissing) {
        // Draft: leave the text as typed; keep a stored id only if it still points at the same-named project.
        const linked = w.project_id ? list.find((p) => p._id === w.project_id) : null;
        out.push({ ...w, project: name, project_id: linked && normName(linked.name) === key ? linked._id : null });
        continue;
      }
      const hit = matchProject(name, list) ?? made.get(key) ?? null;
      if (hit) { out.push({ ...w, project: hit.name, project_id: hit._id }); continue; }
      try {
        const { data } = await pmApi.createProject({ name, status: 'Active' });
        made.set(key, data.project);
        out.push({ ...w, project: data.project.name, project_id: data.project._id });
      } catch (e) {
        throw new Error(`Couldn't create the project “${name}”: ${err(e, 'Taskmandu refused it.')} Nothing was saved — fix it or use Save draft.`);
      }
    }
    return out;
  }

  async function save(nextStatus: MinutesStatus) {
    const valid = workItems.filter(workItemHasContent);
    if (!title.trim() || !date) { setStep(0); setError('Add a meeting title and date.'); return; }
    if (!valid.length) { setStep(1); setError('Add at least one Work Item.'); return; }
    setSaving(true); setError(null);
    try {
      // Draft: keep the typed names untouched. Final: match each name to an existing project, or create it (once per distinct name).
      const items = await resolveProjects(valid, nextStatus === 'final');
      const payload = { title: title.trim(), status: nextStatus, meeting_date: date, attendees, work_items: items.map(w => ({ ...w, note: undefined, owner: w.owner.trim(), project: w.project.trim(), requirement: w.requirement.trim(), discussion: w.discussion.trim(), action_items: w.action_items.filter(a => a.task.trim()).map(a => ({ task: a.task.trim(), due_date: a.due_date || null })) })) };
      const { data } = isEdit ? await pmApi.minutesUpdate(initial!.id, payload) : await pmApi.minutesCreate(payload);
      onSaved(data.minute);
    } catch (e) { setError(e instanceof Error && !(e as { response?: unknown }).response ? e.message : err(e, "Couldn't save these minutes.")); }
    finally { setSaving(false); }
  }
  return <div className="flex flex-col gap-4">
    <button onClick={onCancel} className="self-start text-sm text-slate-500 hover:text-slate-700">← Back to list</button>
    <div><h3 className="text-base font-semibold text-slate-800">Meeting Minutes</h3><p className="text-xs text-slate-500">Agenda and general discussion are not ticket sources. Only Work Items are used for Taskmandu conversion.</p></div>
    {pasting && <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4">
      <div><h4 className="text-sm font-semibold text-slate-800">Paste meeting notes</h4><p className="text-xs text-slate-500">Paste notes laid out as MEETING / Title / Date / Attendees, then WORK ITEM 1, 2 … with Owner, Project, Requirement, Discussion, Action Items and Due Date. Labels can be in any order and case; text under no label becomes the Discussion. Nothing is saved until you review it.</p></div>
      <textarea value={pasteText} onChange={e => { setPasteText(e.target.value); setPasteError(null); }} rows={16} placeholder={'MEETING\n\nTitle:\ndaily meeting\n\nDate:\n6 Oct 2026\n\nAttendees:\nSuraj Shrestha\n\nWORK ITEM 1\nOwner: Ashim\nProject: adxps\nRequirement: …\nDiscussion: …\nAction Items:\n- … (due 14 Oct 2026)\nDue Date: 22 Oct 2026'} className={`${inputCls} font-mono text-xs`} />
      {employees.length === 0 && <p className="text-xs text-amber-700">The team list is still loading — owners can only be matched once it is.</p>}
      <ErrorNote message={pasteError} />
      <div className="flex flex-wrap justify-end gap-2"><button onClick={() => setPasting(false)} className={ghostBtn}>Start from blank instead</button><button onClick={parsePaste} disabled={!pasteText.trim()} className={`${primaryBtn} disabled:opacity-50`}>Parse and fill the form</button></div>
    </div>}
    {!pasting && !isEdit && <button onClick={() => setPasting(true)} className="self-start text-xs font-medium text-indigo-600 hover:text-indigo-800">Paste notes to fill this form →</button>}
    {!pasting && <div className="flex flex-wrap gap-1.5">{STEPS.map((label, i) => <button key={label} onClick={() => setStep(i)} className={`rounded-full px-3 py-1 text-xs ${i === step ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{i + 1}. {label}</button>)}</div>}
    {!pasting && step === 0 && <div className="rounded-xl border border-slate-200 bg-white p-4"><div className="grid gap-3 md:grid-cols-2"><Field label="Meeting"><input value={title} onChange={e => setTitle(e.target.value)} placeholder="Daily standup — DevOps" className={inputCls} /></Field><Field label="Date"><input type="date" value={date} onChange={e => setDate(e.target.value)} className={inputCls} /></Field></div>
      <Field label="Attendees"><div className="flex flex-col gap-2"><input value={attendeeSearch} onChange={e => setAttendeeSearch(e.target.value)} placeholder="Search team…" className={inputCls} /><div className="grid max-h-40 grid-cols-2 gap-1 overflow-y-auto rounded-md border border-slate-200 p-2">{shown.map(e => <label key={e.employeeId} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={attendees.includes(e.name)} onChange={() => toggleAttendee(e.name)} /><span>{e.name}</span></label>)}</div><div className="text-xs text-slate-400">{attendees.join(', ') || 'No attendees selected'}</div></div></Field>
    </div>}
    {!pasting && step === 1 && <div className="flex flex-col gap-4"><div className="flex items-center justify-between"><div><h4 className="text-sm font-semibold text-slate-800">WORK ITEMS</h4><p className="text-xs text-slate-500">One Work Item = one Task. Action Items = Subtasks.</p></div><div className="flex flex-wrap gap-2"><button onClick={carryOver} disabled={carryBusy} title="Unfinished items from the last meeting, plus overdue, blocked and stuck tasks from the board" className={ghostBtn}>{carryBusy ? 'Loading…' : '↩ Carry over from last meeting'}</button><button onClick={() => setWorkItems(ws => [...ws, blankWork()])} className={ghostBtn}>+ Add Work Item</button></div></div>{carryMsg && <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-800">{carryMsg}</div>}
      {showWarn && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{emptyFields > 0 ? <><b>{emptyFields} empty field{emptyFields === 1 ? '' : 's'}</b> marked in red.</> : <>No empty fields.</>} This is only a warning — you can still save, and push, with blanks.{pasteNotes.map(n => <div key={n} className="mt-1 text-amber-700">• {n}</div>)}</div>}
      {workItems.map((w,i) => <div key={i} className="rounded-xl border border-slate-200 bg-white p-4"><div className="mb-3 flex items-center justify-between"><span className="text-sm font-semibold text-slate-700">Work Item {i + 1}</span>{workItems.length > 1 && <button onClick={() => removeWork(i)} className="text-xs text-red-500">Remove</button>}</div>
        {w.note && <div className="mb-3 rounded-md bg-indigo-50 px-2 py-1 text-xs text-indigo-700">↩ {w.note}</div>}
        <div className="grid gap-3 md:grid-cols-2"><Field label="Person / Owner"><select value={w.owner} onChange={e => { updateWork(i,{owner:e.target.value}); setOwnerHints(h => { const n = { ...h }; delete n[i]; return n; }); }} className={`${inputCls} ${bad(!w.owner.trim())}`}><option value="">Select owner…</option>{employees.map(e => <option key={e.employeeId} value={e.name}>{e.name}</option>)}</select>{ownerHints[i]?.hint && !(ownerHints[i].tone === 'warn' && w.owner.trim() && ownerHints[i].owner !== w.owner) && <p className={`mt-1 text-[11px] ${ownerHints[i].tone === 'warn' ? 'text-red-600' : 'text-slate-500'}`}>{ownerHints[i].hint}</p>}</Field><Field label="Business / Project"><input list={`mm-projects-${i}`} value={w.project} onChange={e => updateWork(i,{project:e.target.value})} placeholder="Ad Consult" className={`${inputCls} ${bad(!w.project.trim())}`} /><datalist id={`mm-projects-${i}`}>{projects.map(p => <option key={p._id} value={p.name} />)}</datalist>
          {splitProjectNames(w.project).length > 1
            ? <button onClick={() => splitWork(i)} className="mt-1 text-[11px] font-medium text-amber-700 underline hover:text-amber-800">Split into {splitProjectNames(w.project).length} Work Items (one per business)</button>
            : <ProjectHint name={w.project} projects={projects} loaded={projectsLoaded} />}
        </Field></div>
        <Field label="Requirement (becomes Task title)"><input value={w.requirement} onChange={e => updateWork(i,{requirement:e.target.value})} placeholder="Make home page responsive" className={`${inputCls} ${bad(!w.requirement.trim())}`} /></Field>
        <Field label="Discussion (becomes Task description)"><textarea value={w.discussion} onChange={e => updateWork(i,{discussion:e.target.value})} rows={3} placeholder="Homepage needs to work correctly on mobile and tablet." className={`${inputCls} ${bad(!w.discussion.trim())}`} /></Field>
        <Field label="ACTION ITEMS (become Subtasks)"><div className={`flex flex-col gap-2 ${showWarn && !w.action_items.some(a => a.task.trim()) ? 'rounded-md border border-red-400 bg-red-50 p-2' : ''}`}>{w.action_items.map((a,j) => <div key={j} className="flex flex-wrap gap-2"><input value={a.task} onChange={e => updateAction(i,j,{task:e.target.value})} placeholder="Update responsive layout" className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1 text-sm" /><input type="date" value={a.due_date ?? ''} onChange={e => updateAction(i,j,{due_date:e.target.value || null})} className="rounded-md border border-slate-300 px-2 py-1 text-sm" /><button onClick={() => updateWork(i,{action_items:w.action_items.filter((_,k)=>k!==j)})} className="text-slate-400 hover:text-red-600">✕</button></div>)}<button onClick={() => updateWork(i,{action_items:[...w.action_items,blankAction()]})} className="self-start text-xs text-slate-500 hover:text-slate-700">+ Add action item</button></div></Field>
        <Field label="Due date"><input type="date" value={w.due_date ?? ''} onChange={e => updateWork(i,{due_date:e.target.value || null})} className={`${inputCls} ${bad(!w.due_date)}`} /></Field>
      </div>)}
    </div>}
    {!pasting && step === 2 && <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between"><div className="text-xs font-medium text-slate-500">Everything in this meeting, in one place</div><button onClick={copyText} className={ghostBtn}>{copied ? 'Copied ✓' : 'Copy as text'}</button></div>
      <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-sm text-slate-800">{text}</pre>
      {warnings.length > 0 && <ul className="list-inside list-disc text-xs text-amber-700">{warnings.map((x) => <li key={x}>{x}</li>)}</ul>}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-lg border border-slate-200 bg-white p-3"><div className="text-[11px] text-slate-500">Work items to review</div><div className="text-lg font-semibold text-slate-800">{workItems.filter(workItemHasContent).length}</div></div>
        <div className="rounded-lg border border-slate-200 bg-white p-3"><div className="text-[11px] text-slate-500">Missing owner</div><div className={`text-lg font-semibold ${workItems.filter(workItemHasContent).filter(w => !w.owner.trim()).length ? 'text-amber-700' : 'text-slate-800'}`}>{workItems.filter(workItemHasContent).filter(w => !w.owner.trim()).length}</div></div>
        <div className="rounded-lg border border-slate-200 bg-white p-3"><div className="text-[11px] text-slate-500">Missing due date</div><div className={`text-lg font-semibold ${workItems.filter(workItemHasContent).filter(w => !w.due_date).length ? 'text-amber-700' : 'text-slate-800'}`}>{workItems.filter(workItemHasContent).filter(w => !w.due_date).length}</div></div>
        <div className="rounded-lg border border-slate-200 bg-white p-3"><div className="text-[11px] text-slate-500">Subtasks to create</div><div className="text-lg font-semibold text-slate-800">{workItems.filter(workItemHasContent).reduce((n, w) => n + w.action_items.filter(a => a.task.trim()).length, 0)}</div></div>
      </div>
      <TaskmanduPreview items={workItems} projects={projects} loaded={projectsLoaded} employeeNames={employees.map((e) => e.name)} />
    </div>}
    <ErrorNote message={error} />
    <div className={`${pasting ? 'hidden' : 'flex'} flex-wrap items-center justify-between gap-2`}><button onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0} className={`${ghostBtn} disabled:opacity-40`}>Back</button><div className="flex gap-2"><button onClick={() => save('draft')} disabled={saving} className={ghostBtn}>{saving ? 'Saving…' : 'Save draft'}</button>{step === STEPS.length - 1 ? <button onClick={() => save('final')} disabled={saving} className={primaryBtn}>Save as final</button> : <button onClick={() => setStep((s) => s + 1)} className={primaryBtn}>Next</button>}</div></div>
  </div>;
}

/** Live answer to "what will happen to this project name?" */
function ProjectHint({ name, projects, loaded }: { name: string; projects: Project[]; loaded: boolean }) {
  if (!name.trim()) return <p className="mt-1 text-[11px] text-slate-400">Pick an existing project, or type a new name.</p>;
  if (!loaded) return <p className="mt-1 text-[11px] text-slate-400">Couldn’t load your projects, so I can’t tell if this one is new.</p>;
  const hit = matchProject(name, projects);
  return hit
    ? <p className="mt-1 text-[11px] text-emerald-700">✓ Existing project “{hit.name}” — its tasks go on that board.</p>
    : <p className="mt-1 text-[11px] text-amber-700">New project — it is created when you <b>Save as final</b>. Save draft only keeps the name.</p>;
}

/** Review step: where each part of a work item ends up in Taskmandu. */
function TaskmanduPreview({ items, projects, loaded, employeeNames }: { items: MeetingWorkItem[]; projects: Project[]; loaded: boolean; employeeNames: string[] }) {
  const valid = items.filter(workItemHasContent);
  if (!valid.length) return null;
  const known = new Set(employeeNames.map(normName));
  return <div className="flex flex-col gap-2 rounded-md border border-slate-200 p-3">
    <div className="text-xs font-medium text-slate-500">How Save as final + Brief to tickets will use this</div>
    {valid.map((w, i) => {
      const hit = matchProject(w.project, projects);
      const proj = !w.project.trim() ? <span className="text-slate-400">none — standalone task</span>
        : !loaded ? <span className="text-slate-500">{w.project}</span>
        : hit ? <span className="text-emerald-700">{hit.name} (existing)</span>
        : <span className="text-amber-700">{w.project} (new — created on final)</span>;
      const subs = w.action_items.filter((a) => a.task.trim()).length;
      return <dl key={i} className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-0.5 text-xs">
        <dt className="font-medium text-slate-700">Work Item {i + 1}</dt><dd />
        <dt className="text-slate-400">Task title</dt><dd className="text-slate-800">{w.requirement.trim() || <span className="text-amber-700">{workItemTitle(w)} (Requirement is empty)</span>}</dd>
        <dt className="text-slate-400">Assigned to</dt><dd>{w.owner.trim() ? (known.has(normName(w.owner)) ? w.owner : <span className="text-amber-700">{w.owner} (not in your team list)</span>) : <span className="text-amber-700">nobody — Taskmandu needs an assignee</span>}</dd>
        <dt className="text-slate-400">Project</dt><dd>{proj}</dd>
        <dt className="text-slate-400">Description</dt><dd className="text-slate-600">{w.discussion.trim() ? (w.discussion.length > 90 ? `${w.discussion.slice(0, 90)}…` : w.discussion) : '—'}</dd>
        <dt className="text-slate-400">Subtasks</dt><dd>{subs ? `${subs}${w.owner.trim() ? `, each assigned to ${w.owner}` : ''}` : 'none'}</dd>
        <dt className="text-slate-400">Task due</dt><dd>{w.due_date ?? 'not set (Brief uses +1 week)'}</dd>
      </dl>;
    })}
    <p className="text-[11px] text-slate-400">Action-item due dates stay in the minutes, but Taskmandu subtasks have no due-date field, so they are not sent.</p>
  </div>;
}
