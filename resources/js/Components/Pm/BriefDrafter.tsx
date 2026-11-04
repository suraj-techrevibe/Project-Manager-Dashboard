import { useEffect, useMemo, useState } from 'react';
import { pmApi } from '../../lib/pmApi';
import { MAX_TICKETS, autoAssign, blankTicket, findExisting, keywordQuestions, questionsEmail, sameTitle, type EditableTicket } from '../../lib/briefHeuristics';
import { localISO, parseMeetingNotes } from '../../lib/meetingNotes';
import { TASK_PRIORITIES } from '../../types/pm';
import type { BriefContext, PmIntake, Project, PushTicket } from '../../types/pm';
import MeetingPicker, { buildTicketsFromMeeting } from './MeetingPicker';
import IntakePicker, { buildTicketFromIntake } from './IntakePicker';
import { visitPm } from '../../lib/pmNav';
import { EmptyState, PageHeader, Section, btnPrimary, btnSecondary } from './ui/kit';

const inputCls = 'rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500';

function errorText(e: any, fallback: string) {
  const d = e?.response?.data;
  if (d?.error) return d.error;
  if (d?.errors) { const first = Object.values(d.errors)[0] as string[] | undefined; if (first?.[0]) return first[0]; }
  return d?.message || fallback;
}

export default function BriefDrafter() {
  const [brief, setBrief] = useState('');
  const [tickets, setTickets] = useState<EditableTicket[]>([]);
  const [skipped, setSkipped] = useState<Record<string, boolean>>({});
  const [ctx, setCtx] = useState<BriefContext | null>(null);
  const [ctxError, setCtxError] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [pushError, setPushError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pushSummary, setPushSummary] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [meeting, setMeeting] = useState<{ id: number; title: string; meeting_date: string; minutes: string } | null>(null);
  const [activeIntake, setActiveIntake] = useState<PmIntake | null>(null);

  const loadContext = () => pmApi.briefContext().then(({ data }) => { setCtx(data); setCtxError(null); }).catch((e) => setCtxError(errorText(e, "Couldn't load employees — Taskmandu may be unreachable.")));
  useEffect(() => {
    loadContext();
    pmApi.projects().then(({ data }) => setProjects(data.projects)).catch(() => {}).finally(() => setProjectsLoaded(true));
  }, []);

  // Jumped here from a meeting's "Push N tickets to Taskmandu" button (?meeting=<id>) — load that
  // meeting's Work Items once the team/project lists are ready, same as picking it by hand.
  useEffect(() => {
    if (!ctx || !projectsLoaded) return;
    const intakeId = new URLSearchParams(window.location.search).get('intake');
    if (intakeId) {
      visitPm('brief', {}, { replace: true });
      pmApi.intakes().then(({ data }) => {
        const intake = data.intakes.find((item) => String(item.id) === intakeId);
        if (!intake) throw new Error('The source request could not be found.');
        const accepted = intake.kind === 'request' ? intake.status === 'approved' : intake.status === 'accepted';
        if (!accepted && intake.status !== 'planned') throw new Error('Approve this request or accept this idea before planning tasks.');
        if (!intake.linked_project_id) throw new Error('Choose a Taskmandu project for this request before planning tasks.');
        const project = projects.find((item) => item._id === intake.linked_project_id);
        if (!project) throw new Error('The matched Taskmandu project is not available. Refresh Taskmandu projects and select a valid project.');
        setActiveIntake(intake);
        setMeeting(null);
        setBrief([intake.title, intake.description, intake.clarification ? `Clarification: ${intake.clarification}` : null, intake.decision_notes ? `Decision: ${intake.decision_notes}` : null].filter(Boolean).join('\n\n'));
        loadDrafts([buildTicketFromIntake(intake, projects)], intake);
        setNotice(`Planning work for ${intake.title} in Taskmandu project ${project.name}. Every Task in this batch will be created inside that project.`);
      }).catch((e) => setDraftError(errorText(e, 'Could not load the source request.')));
      return;
    }
    const id = new URLSearchParams(window.location.search).get('meeting');
    if (!id) return;
    visitPm('brief', {}, { replace: true }); // consume the param so a refresh doesn't reload it
    pmApi.minutesShow(Number(id)).then(({ data }) => {
      const { tickets, notice, meeting } = buildTicketsFromMeeting(data.minute, ctx.employees, projects);
      loadDrafts(tickets); setMeeting(meeting); setNotice(notice);
    }).catch(() => setDraftError("Couldn't load that meeting."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, projectsLoaded]);

  const employees = ctx?.employees ?? [];
  const pending = tickets.filter((t) => t.state !== 'pushed');
  const today = localISO(new Date());
  const questions = useMemo(() => keywordQuestions(brief + '\n' + tickets.map((t) => t.title + ' ' + t.description).join('\n')), [brief, tickets]);
  const duplicates = useMemo(() => {
    const out: Record<string, string> = {};
    tickets.forEach((t, i) => {
      if (t.state === 'pushed' || !t.title.trim()) return;
      const existing = findExisting(t.title, ctx?.titles ?? []);
      if (existing) out[t.uid] = `Similar task already exists${existing.project_name ? ` in ${existing.project_name}` : ''}: “${existing.title}”`;
      const prior = tickets.findIndex((x, j) => j < i && x.state !== 'pushed' && sameTitle(x.title, t.title));
      if (prior >= 0) out[t.uid] = `Same as ticket #${prior + 1} in this batch`;
    });
    return out;
  }, [tickets, ctx]);

  function loadDrafts(fresh: EditableTicket[], intakeContext: PmIntake | null = activeIntake) {
    const scoped = intakeContext?.linked_project_id
      ? fresh.map((ticket) => ({
          ...ticket,
          projectId: intakeContext.linked_project_id!,
          projectName: intakeContext.linked_project_name ?? projects.find((p) => p._id === intakeContext.linked_project_id)?.name ?? '',
          projectNeedsConfirmation: false,
          projectConfirmed: true,
        }))
      : fresh;
    setTickets((prev) => [...prev.filter((t) => t.state === 'pushed'), ...scoped].slice(0, MAX_TICKETS));
    setAttempted(false); setPushError(null); setPushSummary(null);
  }
    function update(uid: string, patch: Partial<EditableTicket>) { setTickets((prev) => prev.map((t) => t.uid === uid ? { ...t, ...patch, state: t.state === 'failed' ? 'draft' : t.state } : t)); }
  function updateSubtask(uid: string, index: number, patch: Partial<EditableTicket['subtasks'][number]>) { setTickets((prev) => prev.map((t) => t.uid === uid ? { ...t, subtasks: t.subtasks.map((s, i) => i === index ? { ...s, ...patch } : s) } : t)); }
  function addSubtask(uid: string) { setTickets((prev) => prev.map((t) => t.uid === uid ? { ...t, subtasks: [...t.subtasks, { uid: `${uid}-sub-${Date.now()}`, title: '', description: '', assigneeId: t.assigneeId, dueDate: '' }] } : t)); }
  function removeSubtask(uid: string, index: number) { setTickets((prev) => prev.map((t) => t.uid === uid ? { ...t, subtasks: t.subtasks.filter((_, i) => i !== index) } : t)); }

  function fromMeetingNotes() {
    if (!brief.trim()) return setDraftError('Paste meeting notes first');
    const r = parseMeetingNotes(brief, employees);
    if (!r.tickets.length) return setDraftError('No action items found.');
    setActiveIntake(null);
    setMeeting(null);
    loadDrafts(r.tickets, null);
    setNotice('Found ' + r.tickets.length + ' action item' + (r.tickets.length === 1 ? '' : 's') + '.');
  }

    function assignAll(id: string) { if (id) setTickets((p) => p.map((t) => t.state === 'pushed' ? t : { ...t, assigneeId: id, subtasks: t.subtasks.map((s) => ({ ...s, assigneeId: s.assigneeId || id })) })); }
  function runAutoAssign() { const picks = autoAssign(tickets, employees); setTickets((p) => p.map((t) => picks[t.uid] ? { ...t, assigneeId: picks[t.uid], subtasks: t.subtasks.map((s) => ({ ...s, assigneeId: s.assigneeId || picks[t.uid] })) } : t)); }
  function remove(uid: string) { setTickets((p) => p.filter((t) => t.uid !== uid)); }
  function addTicket() { setTickets((p) => p.length >= MAX_TICKETS ? p : [...p, blankTicket()]); }

  async function pushList(list: EditableTicket[]) {
    setAttempted(true); setPushError(null); setPushSummary(null);
    if (list.some((t) => !t.title.trim())) return setPushError('Every ticket needs a title.');
    if (list.some((t) => !t.assigneeId)) return setPushError('Every Task needs an owner. Select an owner before pushing.');
    const unconfirmed = list.filter((t) => t.projectNeedsConfirmation && !t.projectConfirmed);
    if (unconfirmed.length) return setPushError(`Confirm or change the project for: ${unconfirmed.map((t) => t.projectName).join(', ')}.`);
    const payload: PushTicket[] = list.map((t) => ({
      title: t.title.trim(), description: t.description.trim(), level: t.level,
      estimate_hours: t.estimate_hours === '' ? null : Number(t.estimate_hours), priority: t.priority,
      assignee_employee_id: t.assigneeId, due_date: t.dueDate || null,
      project_id: t.projectId || null, project_name: t.projectName || null, project_confirmed: t.projectConfirmed,
      subtasks: t.subtasks.filter((s) => s.title.trim()).map((s) => ({ title: s.title.trim(), description: s.description?.trim() || '', assignee_employee_id: s.assigneeId || t.assigneeId, due_date: s.dueDate || null })),
    }));
    setPushing(true);
    try {
      const { data } = await pmApi.pushTickets(payload, undefined, activeIntake?.id);
      const byUid = new Map(data.results.map((r) => [list[r.index].uid, r]));
      setTickets((prev) => prev.map((t) => { const r = byUid.get(t.uid); if (!r) return t; return r.ok ? { ...t, state: 'pushed', error: undefined } : { ...t, state: 'failed', error: r.error ?? 'Failed' }; }));
      const subCount = data.results.reduce((n, r) => n + (r.subtasks_created ?? 0), 0);
      setPushSummary(`${data.created} Task${data.created === 1 ? '' : 's'} pushed${subCount ? ` with ${subCount} Subtask${subCount === 1 ? '' : 's'}` : ''}${data.failed ? `; ${data.failed} failed.` : '.'}${activeIntake && data.intake_task_links ? ` Linked back to “${activeIntake.title}”.` : ''}`);
      if (activeIntake) {
        const latest = await pmApi.intakes();
        const refreshed = latest.data.intakes.find((item) => item.id === activeIntake.id);
        if (refreshed) setActiveIntake(refreshed);
      }
      loadContext();
    } catch (e) { setPushError(errorText(e, "Couldn't push to Taskmandu. Check Taskmandu before retrying.")); } finally { setPushing(false); }
  }

  async function copyQuestions() { const text = questionsEmail(questions.filter((q) => !skipped[q])); try { await navigator.clipboard.writeText(text); } catch {} setCopied(true); setTimeout(() => setCopied(false), 1500); }

  return <div className="flex flex-col gap-4">
    <PageHeader icon="list" title="Brief to tickets" description="Load saved Meeting Work Items, approved Requests or accepted Ideas as editable Tasks and Subtasks." status={tickets.length ? `${tickets.length} tickets · ${tickets.filter((t) => t.state === 'pushed').length} pushed · ${pending.length} waiting` : undefined} />
    {activeIntake && (
      <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-indigo-700">Source request / idea</div>
        <div className="mt-1 font-semibold text-slate-900">{activeIntake.title}</div>
        <div className="mt-1 text-sm text-slate-600">Business = Taskmandu project: <strong>{activeIntake.linked_project_name}</strong></div>
        <div className="mt-1 text-xs text-slate-500">{activeIntake.task_links?.length ?? 0} Task(s) already linked. New tasks in this planner stay in the same project.</div>
      </div>
    )}
    <Section id="brief-input" title="1 · Brief" subtitle={activeIntake ? 'The selected request or idea has been loaded as a Task for its matched Taskmandu project.' : 'Choose a saved meeting, an approved request or an accepted idea. You can also parse pasted meeting notes.'}>
      <textarea value={brief} onChange={(e) => { setBrief(e.target.value); setDraftError(null); }} className="min-h-40 w-full rounded-lg border border-slate-300 p-3 text-sm" placeholder="Paste brief or meeting minutes…" />
      <div className="mt-2 flex flex-wrap gap-2">
        <button className={btnSecondary} onClick={fromMeetingNotes} disabled={pushing}>Parse meeting notes</button>
        <MeetingPicker employees={employees} projects={projects} disabled={pushing} onLoad={(fresh, msg, source) => { setActiveIntake(null); loadDrafts(fresh, null); setMeeting(source); setNotice(msg); setDraftError(null); }} onError={setDraftError} />
        <IntakePicker projects={projects} disabled={pushing} onLoad={(ticket, intake) => {
          setActiveIntake(intake);
          setMeeting(null);
          setBrief([intake.title, intake.description, intake.clarification ? 'Clarification: ' + intake.clarification : null, intake.decision_notes ? 'Decision: ' + intake.decision_notes : null].filter(Boolean).join('\n\n'));
          loadDrafts([ticket], intake);
          setNotice('Loaded “' + intake.title + '” as one Task in ' + intake.linked_project_name + '. Assign an owner, review it and push to Taskmandu.');
          setDraftError(null);
        }} onError={setDraftError} />
      </div>
      {draftError && <p className="mt-2 text-sm text-red-600">{draftError}</p>}
      {notice && <p className="mt-2 text-sm text-slate-600">{notice}</p>}
      {ctxError && <p className="mt-2 text-sm text-amber-700">{ctxError}</p>}
    </Section>

    {tickets.length ? <Section id="brief-review" title="2 · Review" count={tickets.length} subtitle={activeIntake ? 'One selected request or idea = one parent Task. Add Subtasks for the individual pieces of work.' : 'One Meeting Work Item = one parent Task. Action Items = real Subtasks.'}>
      <div className="mb-3 flex flex-wrap gap-2"><select className={inputCls} defaultValue="" onChange={(e) => assignAll(e.target.value)}><option value="">Assign all…</option>{employees.map((e) => <option key={e.employeeId} value={e.employeeId}>{e.name}</option>)}</select><button className={btnSecondary} onClick={runAutoAssign}>Auto assign</button><button className={btnSecondary} onClick={addTicket}>Add Task</button></div>
      <div className="space-y-3">{tickets.map((t, i) => <article key={t.uid} className="rounded-xl border border-slate-200 p-3">
        <div className="flex gap-2"><span className="pt-2 text-xs text-slate-400">#{i + 1}</span><input className={`${inputCls} flex-1`} value={t.title} onChange={(e) => update(t.uid, { title: e.target.value })} placeholder="Task title / Requirement" /><button className="text-red-600" onClick={() => remove(t.uid)}>Remove</button></div>
        <textarea className={`${inputCls} mt-2 w-full`} value={t.description} onChange={(e) => update(t.uid, { description: e.target.value })} placeholder="Discussion / description" />
        <div className="mt-2 grid gap-2 md:grid-cols-4"><select className={inputCls} value={t.assigneeId} onChange={(e) => update(t.uid, { assigneeId: e.target.value })}><option value="">Owner…</option>{employees.map((e) => <option key={e.employeeId} value={e.employeeId}>{e.name}</option>)}</select><select className={inputCls} value={t.projectId} disabled={Boolean(activeIntake)} onChange={(e) => { const p = projects.find((x) => x._id === e.target.value); update(t.uid, { projectId: e.target.value, projectName: p?.name ?? '', projectConfirmed: Boolean(p), projectNeedsConfirmation: false }); }}><option value="">Standalone</option>{projects.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}</select><select className={inputCls} value={t.priority} onChange={(e) => update(t.uid, { priority: e.target.value as EditableTicket['priority'] })}>{TASK_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}</select><input className={inputCls} type="date" min={today} value={t.dueDate} onChange={(e) => update(t.uid, { dueDate: e.target.value })} /></div>
        {t.projectNeedsConfirmation && !t.projectConfirmed && <p className="mt-2 text-xs text-amber-700">New project “{t.projectName}” requires confirmation before push.</p>}
        {duplicates[t.uid] && <p className="mt-2 text-xs text-amber-700">⚠ {duplicates[t.uid]}</p>}
        <div className="mt-3 rounded-lg bg-slate-50 p-3"><div className="mb-2 flex justify-between"><strong className="text-sm">Subtasks ({t.subtasks.length})</strong><button className="text-sm text-indigo-600" onClick={() => addSubtask(t.uid)}>+ Add Subtask</button></div>{t.subtasks.map((s, si) => <div key={s.uid} className="mb-2 grid gap-2 md:grid-cols-[1fr_180px_140px_auto]"><input className={inputCls} value={s.title} onChange={(e) => updateSubtask(t.uid, si, { title: e.target.value })} placeholder="Action Item" /><select className={inputCls} value={s.assigneeId || t.assigneeId} onChange={(e) => updateSubtask(t.uid, si, { assigneeId: e.target.value })}><option value="">Owner…</option>{employees.map((e) => <option key={e.employeeId} value={e.employeeId}>{e.name}</option>)}</select><input className={inputCls} type="date" min={today} value={s.dueDate} onChange={(e) => updateSubtask(t.uid, si, { dueDate: e.target.value })} /><button className="text-red-600" onClick={() => removeSubtask(t.uid, si)}>Remove</button></div>)}</div>
        {t.state === 'failed' && <div className="mt-2 flex justify-between text-xs text-red-600"><span>{t.error}</span><button onClick={() => pushList([t])} disabled={pushing}>Retry</button></div>}
      </article>)}</div>
    </Section> : <EmptyState title="No tickets yet">Choose a saved meeting, approved request or accepted idea above.</EmptyState>}

    {tickets.length > 0 && <Section id="brief-push" title="3 · Push to Taskmandu" subtitle={activeIntake ? `Source: ${activeIntake.title} · Project: ${activeIntake.linked_project_name}` : meeting ? `Source meeting: ${meeting.title} · ${meeting.meeting_date}` : 'Review every owner and project before pushing.'}>
      {pushError && <p className="mb-2 text-sm text-red-600">{pushError}</p>}{pushSummary && <p className="mb-2 text-sm text-green-700">{pushSummary}</p>}
      {activeIntake && activeIntake.task_links?.length > 0 && <p className="mb-2 text-xs text-slate-500">This request now has {activeIntake.task_links.length} linked Taskmandu Tasks. Their live status is tracked in the Taskmandu project.</p>}
      <button className={btnPrimary} disabled={pushing || pending.length === 0} onClick={() => pushList(pending)}>{pushing ? 'Pushing…' : `Push ${pending.length} to Taskmandu`}</button>
      {attempted && !pending.length && <p className="mt-2 text-xs text-slate-500">All Tasks in this batch have been pushed.</p>}
    </Section>}

    {questions.length > 0 && <Section id="brief-questions" title="Client questions" subtitle="Questions raised by the brief."><button className={btnSecondary} onClick={copyQuestions}>{copied ? 'Copied' : 'Copy questions'}</button><ul className="mt-2 space-y-1 text-sm">{questions.map((q) => <li key={q}><label><input type="checkbox" checked={!skipped[q]} onChange={() => setSkipped((s) => ({ ...s, [q]: !s[q] }))} /> {q}</label></li>)}</ul></Section>}
  </div>;
}
