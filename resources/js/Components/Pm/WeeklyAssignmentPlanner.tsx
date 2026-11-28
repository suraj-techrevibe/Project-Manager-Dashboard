import { useEffect, useMemo, useState } from 'react';
import { pmApi } from '../../lib/pmApi';
import { TASK_PRIORITIES } from '../../types/pm';
import type { BriefContext, Project, WeeklyPlan, WeeklyPlanInput, WeeklyPlanTicket, WeeklyPlanTicketInput } from '../../types/pm';
import { EmptyState, PageHeader, Section, btnPrimary, btnSecondary } from './ui/kit';

const inputCls = 'w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500';

function dateValue(date: Date): string {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 10);
}

function defaultWeek(): { start: string; end: string } {
  const start = new Date();
  start.setHours(12, 0, 0, 0);
  const daysUntilSunday = (7 - start.getDay()) % 7;
  start.setDate(start.getDate() + daysUntilSunday);
  const end = new Date(start);
  end.setDate(end.getDate() + 5);
  return { start: dateValue(start), end: dateValue(end) };
}

function blankTicket(dueDate: string): WeeklyPlanTicketInput {
  return {
    uid: `weekly-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: '',
    description: '',
    project_id: null,
    project_name: null,
    project_confirmed: false,
    assignee_employee_id: '',
    priority: 'Low',
    estimate_hours: null,
    due_date: dueDate,
    release_now: true,
  };
}

function editableTickets(tickets: WeeklyPlanTicket[]): WeeklyPlanTicketInput[] {
  return tickets.map((ticket) => ({
    uid: ticket.uid,
    title: ticket.title,
    description: ticket.description ?? '',
    project_id: ticket.project_id,
    project_name: ticket.project_name,
    project_confirmed: ticket.project_confirmed,
    assignee_employee_id: ticket.assignee_employee_id,
    priority: ticket.priority,
    estimate_hours: ticket.estimate_hours,
    due_date: ticket.due_date,
    release_now: ticket.release_now,
  }));
}

function statusLabel(status: string): string {
  return ({
    draft: 'Draft',
    submitted_for_approval: 'Awaiting approval',
    changes_requested: 'Changes requested',
    approved: 'Approved',
    releasing: 'Releasing',
    partially_released: 'Partially released',
    released: 'Released',
  } as Record<string, string>)[status] ?? status;
}

function errorText(error: any, fallback: string): string {
  const data = error?.response?.data;
  if (data?.error) return data.error;
  if (data?.errors) {
    const first = Object.values(data.errors)[0] as string[] | undefined;
    if (first?.[0]) return first[0];
  }
  return data?.message || fallback;
}

export default function WeeklyAssignmentPlanner() {
  const initialWeek = useMemo(() => defaultWeek(), []);
  const [plans, setPlans] = useState<WeeklyPlan[]>([]);
  const [selected, setSelected] = useState<WeeklyPlan | null>(null);
  const [ctx, setCtx] = useState<BriefContext | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [title, setTitle] = useState('');
  const [weekStart, setWeekStart] = useState(initialWeek.start);
  const [weekEnd, setWeekEnd] = useState(initialWeek.end);
  const [notes, setNotes] = useState('');
  const [tickets, setTickets] = useState<WeeklyPlanTicketInput[]>([blankTicket(initialWeek.end)]);
  const [approvalNotes, setApprovalNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const employees = ctx?.employees ?? [];
  const editable = !selected || ['draft', 'changes_requested'].includes(selected.status);
  const teamCapacity = employees.reduce((sum, employee) => sum + (employee.capacity ?? 0), 0);
  const plannedHours = tickets.reduce((sum, ticket) => sum + (Number(ticket.estimate_hours) || 0), 0);

  async function loadPlans(selectId?: number) {
    const { data } = await pmApi.weeklyPlans();
    setPlans(data.plans);
    const id = selectId ?? selected?.id;
    if (id) {
      const { data: detail } = await pmApi.weeklyPlan(id);
      applyPlan(detail.plan);
    }
  }

  function applyPlan(plan: WeeklyPlan) {
    setSelected(plan);
    setTitle(plan.title);
    setWeekStart(plan.week_start);
    setWeekEnd(plan.week_end);
    setNotes(plan.notes ?? '');
    setTickets(editableTickets(plan.tickets));
    setApprovalNotes(plan.approval_notes ?? '');
  }

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([pmApi.weeklyPlans(), pmApi.briefContext(), pmApi.projects()])
      .then(([planResponse, contextResponse, projectResponse]) => {
        if (!alive) return;
        setPlans(planResponse.data.plans);
        setCtx(contextResponse.data);
        setProjects(projectResponse.data.projects);
        const current = planResponse.data.plans.find((plan) => plan.week_start === initialWeek.start);
        if (current) {
          pmApi.weeklyPlan(current.id).then(({ data }) => { if (alive) applyPlan(data.plan); }).catch((e) => { if (alive) setError(errorText(e, 'Could not load the weekly plan.')); });
        } else {
          setSelected(null);
          setTitle(`Weekly assignments · ${initialWeek.start}`);
          setWeekStart(initialWeek.start);
          setWeekEnd(initialWeek.end);
          setTickets([blankTicket(initialWeek.end)]);
        }
      })
      .catch((e) => { if (alive) setError(errorText(e, 'Could not load weekly planning data. Check Taskmandu access and try again.')); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // The page is re-mounted when opened, so this initial load is intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function startNewPlan() {
    const week = defaultWeek();
    setSelected(null);
    setTitle(`Weekly assignments · ${week.start}`);
    setWeekStart(week.start);
    setWeekEnd(week.end);
    setNotes('');
    setTickets([blankTicket(week.end)]);
    setApprovalNotes('');
    setError(null);
    setNotice(null);
  }

  function updateTicket(index: number, patch: Partial<WeeklyPlanTicketInput>) {
    setTickets((current) => current.map((ticket, i) => i === index ? { ...ticket, ...patch } : ticket));
  }

  function changeProject(index: number, projectId: string) {
    const project = projects.find((item) => item._id === projectId);
    updateTicket(index, {
      project_id: projectId || null,
      project_name: project?.name ?? null,
      project_confirmed: Boolean(project),
    });
  }

  function addTicket() {
    setTickets((current) => [...current, blankTicket(weekEnd)]);
  }

  function removeTicket(index: number) {
    setTickets((current) => current.filter((_, i) => i !== index));
  }

  function payload(): WeeklyPlanInput {
    return {
      title: title.trim() || `Weekly assignments · ${weekStart}`,
      week_start: weekStart,
      week_end: weekEnd,
      notes,
      tickets: tickets.map((ticket) => ({
        ...ticket,
        title: ticket.title.trim(),
        description: ticket.description.trim(),
        project_name: ticket.project_name || null,
        project_id: ticket.project_id || null,
        project_confirmed: Boolean(ticket.project_id && ticket.project_confirmed),
        estimate_hours: ticket.estimate_hours === null || ticket.estimate_hours === ('' as any) ? null : Number(ticket.estimate_hours),
      })),
    };
  }

  function validateDraft(): string | null {
    if (!weekStart || !weekEnd || weekEnd < weekStart) return 'Choose a valid Sunday–Friday planning range.';
    if (tickets.length === 0) return 'Add at least one assignment.';
    if (tickets.some((ticket) => !ticket.title.trim())) return 'Every assignment needs a clear task title.';
    if (tickets.some((ticket) => !ticket.assignee_employee_id)) return 'Choose an assignee for every assignment.';
    if (tickets.some((ticket) => !ticket.due_date)) return 'Choose a due date for every assignment.';
    if (tickets.some((ticket) => ticket.project_id && !ticket.project_confirmed)) return 'Confirm each selected Taskmandu project.';
    return null;
  }

  async function persist(): Promise<WeeklyPlan | null> {
    const validation = validateDraft();
    if (validation) { setError(validation); return null; }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const data = payload();
      const response = selected
        ? await pmApi.updateWeeklyPlan(selected.id, data)
        : await pmApi.createWeeklyPlan(data);
      applyPlan(response.data.plan);
      await loadPlans(response.data.plan.id);
      setNotice('Weekly assignment draft saved.');
      return response.data.plan;
    } catch (e) {
      setError(errorText(e, 'Could not save the weekly plan.'));
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function submitForApproval() {
    const plan = await persist();
    if (!plan) return;
    setActing(true);
    setError(null);
    try {
      const { data } = await pmApi.submitWeeklyPlan(plan.id);
      applyPlan(data.plan);
      await loadPlans(plan.id);
      setNotice('Weekly batch submitted for approval. No Taskmandu tickets have been created yet.');
    } catch (e) {
      setError(errorText(e, 'Could not submit the weekly plan.'));
    } finally {
      setActing(false);
    }
  }

  async function approveAndRelease() {
    if (!selected) return;
    setActing(true);
    setError(null);
    setNotice(null);
    try {
      const { data } = await pmApi.approveReleaseWeeklyPlan(selected.id, approvalNotes.trim() || undefined);
      applyPlan(data.plan);
      await loadPlans(selected.id);
      setNotice(`Approval recorded. ${data.release.released} Taskmandu ticket(s) released, ${data.release.queued} kept in the next-task queue, ${data.release.failed} failed.`);
    } catch (e) {
      setError(errorText(e, 'Approval or automatic Taskmandu release failed.'));
    } finally {
      setActing(false);
    }
  }

  async function releaseQueued() {
    if (!selected) return;
    setActing(true); setError(null); setNotice(null);
    try {
      const { data } = await pmApi.releaseQueuedWeeklyPlan(selected.id);
      applyPlan(data.plan); await loadPlans(selected.id);
      setNotice(`${data.release.released} queued Taskmandu ticket(s) released; ${data.release.failed} failed.`);
    } catch (e) { setError(errorText(e, 'Could not release queued assignments.')); }
    finally { setActing(false); }
  }

  async function retryFailed() {
    if (!selected) return;
    setActing(true); setError(null); setNotice(null);
    try {
      const { data } = await pmApi.retryFailedWeeklyPlan(selected.id);
      applyPlan(data.plan); await loadPlans(selected.id);
      setNotice(`${data.release.released} failed assignment(s) successfully released; ${data.release.failed} still failed.`);
    } catch (e) { setError(errorText(e, 'Could not retry failed assignments.')); }
    finally { setActing(false); }
  }

  async function requestChanges() {
    if (!selected || !approvalNotes.trim()) { setError('Enter the boss feedback or changes required first.'); return; }
    setActing(true); setError(null); setNotice(null);
    try {
      const { data } = await pmApi.requestWeeklyPlanChanges(selected.id, approvalNotes.trim());
      applyPlan(data.plan); await loadPlans(selected.id);
      setNotice('The plan was returned for changes. Edit the assignments and submit it again.');
    } catch (e) { setError(errorText(e, 'Could not return the plan for changes.')); }
    finally { setActing(false); }
  }

  async function deleteDraft() {
    if (!selected) return;
    if (!window.confirm('Delete this unreleased weekly draft?')) return;
    setActing(true); setError(null);
    try {
      await pmApi.deleteWeeklyPlan(selected.id);
      setPlans((current) => current.filter((plan) => plan.id !== selected.id));
      startNewPlan();
      setNotice('Weekly draft deleted.');
    } catch (e) { setError(errorText(e, 'Could not delete the weekly draft.')); }
    finally { setActing(false); }
  }

  const selectedStatus = selected?.status ?? 'draft';
  const hasReady = selected?.tickets.some((ticket) => ticket.push_state === 'ready') ?? false;
  const hasQueue = selected?.tickets.some((ticket) => ticket.push_state === 'queued') ?? false;
  const hasFailed = selected?.tickets.some((ticket) => ticket.push_state === 'failed') ?? false;
  const hasRelease = selected?.tickets.some((ticket) => ticket.push_state === 'released') ?? false;

  return <div className="flex flex-col gap-4">
    <PageHeader
      icon="calendar-check"
      title="Weekly Assignment Plan"
      description="Prepare the team's Sunday–Friday workload, get approval and automatically release approved tickets to Taskmandu."
      status={selected ? statusLabel(selected.status) : 'New weekly batch'}
    />

    <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-3 text-sm text-indigo-950">
      <div className="font-semibold">Team schedule · Nepal time</div>
      <div className="mt-1">Sunday–Friday, 12:00 pm–6:00 pm NPT · Saturday off · 36 scheduled hours per week before breaks.</div>
      <div className="mt-1 text-indigo-800">Your Sydney availability: 7:00 am–10:00 pm. Live overlap is normally 5:15 pm–10:00 pm Sydney time during Sydney daylight saving. Use asynchronous Taskmandu handovers after your availability ends.</div>
    </div>

    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="space-y-4">
        <Section title="1 · Weekly batch" subtitle="One plan per Sunday start date. Keep daily Meeting Minutes separate." >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-slate-900">Saved weekly plans</div>
              <div className="text-xs text-slate-500">Select a week to view its assignments and release history.</div>
            </div>
            <button type="button" className={btnSecondary} onClick={startNewPlan}>+ New week</button>
          </div>
          {plans.length > 0 ? <div className="mt-3 flex flex-wrap gap-2">
            {plans.map((plan) => <button key={plan.id} type="button" onClick={() => pmApi.weeklyPlan(plan.id).then(({ data }) => applyPlan(data.plan)).catch((e) => setError(errorText(e, 'Could not open this plan.')))}
              className={`rounded-lg border px-3 py-2 text-left text-xs transition ${selected?.id === plan.id ? 'border-indigo-400 bg-indigo-50 text-indigo-900' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'}`}>
              <span className="block font-semibold">{plan.week_start} – {plan.week_end}</span>
              <span className="mt-0.5 block">{statusLabel(plan.status)} · {plan.counts.total} tasks</span>
            </button>)}
          </div> : <p className="mt-3 text-sm text-slate-500">No weekly plans saved yet.</p>}
          {loading && <p className="mt-3 text-xs text-slate-500">Loading employees, projects and weekly plans…</p>}
        </Section>

        <Section title="2 · Prepare assignments" subtitle="Choose the correct existing Taskmandu project, owner, hours, priority and due date. Each row becomes one Taskmandu ticket after approval.">
          <div className="grid gap-3 md:grid-cols-3">
            <label className="text-xs font-medium text-slate-600">Plan title
              <input className={inputCls} value={title} disabled={!editable} onChange={(e) => setTitle(e.target.value)} placeholder="Weekly assignments" />
            </label>
            <label className="text-xs font-medium text-slate-600">Week starts · Sunday
              <input type="date" className={inputCls} value={weekStart} disabled={!editable} onChange={(e) => setWeekStart(e.target.value)} />
            </label>
            <label className="text-xs font-medium text-slate-600">Week ends · Friday
              <input type="date" className={inputCls} value={weekEnd} disabled={!editable} onChange={(e) => setWeekEnd(e.target.value)} />
            </label>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-semibold text-slate-900">Assignments ({tickets.length})</div>
            {editable && <button type="button" className={btnSecondary} onClick={addTicket}>+ Add assignment</button>}
          </div>

          <div className="mt-3 space-y-3">
            {tickets.map((ticket, index) => {
              const saved = selected?.tickets[index];
              const state = saved?.push_state;
              return <article key={ticket.uid} className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Assignment {index + 1}</span>
                  {state && <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${state === 'released' ? 'bg-green-100 text-green-800' : state === 'failed' ? 'bg-red-100 text-red-800' : state === 'queued' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-700'}`}>{state === 'released' ? 'Taskmandu ticket created' : state}</span>}
                  {editable && <button type="button" className="text-xs text-red-600 hover:underline" onClick={() => removeTicket(index)}>Remove</button>}
                </div>
                <label className="block text-xs font-medium text-slate-600">Task title
                  <input className={inputCls} value={ticket.title} disabled={!editable} onChange={(e) => updateTicket(index, { title: e.target.value })} placeholder="[QA] AdEvents – Full pre-event website QA" />
                </label>
                <label className="mt-2 block text-xs font-medium text-slate-600">Objective, scope and acceptance criteria
                  <textarea className={inputCls} rows={3} value={ticket.description} disabled={!editable} onChange={(e) => updateTicket(index, { description: e.target.value })} placeholder="Explain what to do, expected deliverable and how completion will be checked…" />
                </label>
                <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  <label className="text-xs font-medium text-slate-600">Assignee
                    <select className={inputCls} value={ticket.assignee_employee_id} disabled={!editable} onChange={(e) => updateTicket(index, { assignee_employee_id: e.target.value })}>
                      <option value="">Choose team member…</option>
                      {employees.map((employee) => <option key={employee.employeeId} value={employee.employeeId}>{employee.name}{employee.designation ? ` · ${employee.designation}` : ''}</option>)}
                    </select>
                  </label>
                  <label className="text-xs font-medium text-slate-600">Taskmandu project / business
                    <select className={inputCls} value={ticket.project_id ?? ''} disabled={!editable} onChange={(e) => changeProject(index, e.target.value)}>
                      <option value="">Standalone task</option>
                      {projects.map((project) => <option key={project._id} value={project._id}>{project.name}</option>)}
                    </select>
                  </label>
                  <label className="text-xs font-medium text-slate-600">Priority
                    <select className={inputCls} value={ticket.priority} disabled={!editable} onChange={(e) => updateTicket(index, { priority: e.target.value as WeeklyPlanTicketInput['priority'] })}>
                      {TASK_PRIORITIES.map((priority) => <option key={priority} value={priority}>{priority}</option>)}
                    </select>
                  </label>
                  <label className="text-xs font-medium text-slate-600">Estimated hours
                    <input type="number" min="0" max="1000" step="0.5" className={inputCls} value={ticket.estimate_hours ?? ''} disabled={!editable} onChange={(e) => updateTicket(index, { estimate_hours: e.target.value === '' ? null : Number(e.target.value) })} placeholder="e.g. 6" />
                  </label>
                  <label className="text-xs font-medium text-slate-600">Due date (Nepal time)
                    <input type="date" className={inputCls} value={ticket.due_date} min={weekStart} max={weekEnd} disabled={!editable} onChange={(e) => updateTicket(index, { due_date: e.target.value })} />
                  </label>
                  <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700">
                    <input type="checkbox" checked={ticket.release_now} disabled={!editable} onChange={(e) => updateTicket(index, { release_now: e.target.checked })} />
                    Release with this batch
                  </label>
                </div>
                {saved?.push_error && <p className="mt-2 text-xs text-red-700">{saved.push_error}</p>}
                {saved?.task_id && <p className="mt-2 text-xs text-green-700">Taskmandu ID: {saved.task_id}{saved.task_url ? <> · <a className="underline" href={saved.task_url} target="_blank" rel="noreferrer">Open project/task</a></> : ''}</p>}
              </article>;
            })}
          </div>

          <label className="mt-3 block text-xs font-medium text-slate-600">Planning notes / dependencies
            <textarea className={inputCls} rows={2} value={notes} disabled={!editable} onChange={(e) => setNotes(e.target.value)} placeholder="Key priorities, dependencies, boss decisions or risks for this week…" />
          </label>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {editable && <button type="button" className={btnPrimary} disabled={saving || acting || loading} onClick={() => void persist()}>{saving ? 'Saving…' : 'Save draft'}</button>}
            {editable && <button type="button" className={btnSecondary} disabled={saving || acting || loading} onClick={() => void submitForApproval()}>{acting ? 'Submitting…' : 'Save & submit for approval'}</button>}
            {selected && editable && <button type="button" className="rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50" disabled={acting || saving} onClick={() => void deleteDraft()}>Delete draft</button>}
          </div>
        </Section>

        {selected && <Section title="3 · Approval and automatic release" subtitle="Approval is the trigger. Once approved, the server creates each selected Taskmandu ticket and stores its returned ID.">
          <div className="flex flex-wrap gap-2 text-xs text-slate-600">
            <span className="rounded-md bg-slate-100 px-2 py-1">Status: {statusLabel(selected.status)}</span>
            <span className="rounded-md bg-slate-100 px-2 py-1">Released: {selected.counts.released}</span>
            <span className="rounded-md bg-slate-100 px-2 py-1">Queued: {selected.counts.queued}</span>
            <span className="rounded-md bg-slate-100 px-2 py-1">Failed: {selected.counts.failed}</span>
          </div>
          {selected.status === 'submitted_for_approval' && <>
            <label className="mt-3 block text-xs font-medium text-slate-600">Approval notes (optional)
              <textarea className={inputCls} rows={2} value={approvalNotes} onChange={(e) => setApprovalNotes(e.target.value)} placeholder="Boss approval notes or conditions…" />
            </label>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className={btnPrimary} disabled={acting} onClick={() => void approveAndRelease()}>{acting ? 'Approving and releasing…' : 'Approve & automatically release batch'}</button>
              <button type="button" className={btnSecondary} disabled={acting} onClick={() => void requestChanges()}>Return for changes</button>
            </div>
          </>}
          {['approved', 'partially_released'].includes(selected.status) && <div className="mt-3 flex flex-wrap gap-2">
            {hasQueue && <button type="button" className={btnPrimary} disabled={acting} onClick={() => void releaseQueued()}>{acting ? 'Releasing…' : 'Release queued assignments'}</button>}
            {hasFailed && <button type="button" className={btnSecondary} disabled={acting} onClick={() => void retryFailed()}>{acting ? 'Retrying…' : 'Retry failed tickets only'}</button>}
          </div>}
          {selected.approved_by && <p className="mt-3 text-xs text-slate-500">Approved by {selected.approved_by}{selected.approved_at ? ` · ${new Date(selected.approved_at).toLocaleString()}` : ''}. {selected.approval_notes || ''}</p>}
          {selected.status === 'released' && <p className="mt-3 text-sm font-medium text-green-700">All assignments in this batch have been released to Taskmandu.</p>}
          {selected.status === 'changes_requested' && <p className="mt-3 text-sm text-amber-700">Changes requested: {selected.approval_notes}</p>}
        </Section>}
      </div>

      <aside className="space-y-4">
        <Section title="Team capacity" subtitle="Employee names and current capacity are loaded from Taskmandu." >
          {employees.length ? <div className="space-y-2">
            {employees.map((employee) => <div key={employee.employeeId} className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2 text-sm last:border-0">
              <span className="min-w-0 truncate font-medium text-slate-800">{employee.name}</span>
              <span className="shrink-0 text-xs text-slate-500">{employee.open ?? 0} open · {employee.week_hours ?? employee.hours ?? 0}h this week</span>
            </div>)}
            {teamCapacity > 0 && <p className="text-xs text-slate-500">Reported weekly team capacity: {teamCapacity}h. Compare with estimates before approval.</p>}
          </div> : <p className="text-sm text-slate-500">{loading ? 'Loading team…' : 'No Taskmandu employees returned. Check the PM service account permissions.'}</p>}
        </Section>
        <Section title="Batch summary" subtitle="Based on the assignments currently shown.">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg bg-slate-50 p-3"><div className="text-xs text-slate-500">Assignments</div><div className="text-xl font-semibold">{tickets.length}</div></div>
            <div className="rounded-lg bg-slate-50 p-3"><div className="text-xs text-slate-500">Estimated hours</div><div className="text-xl font-semibold">{plannedHours}h</div></div>
            <div className="rounded-lg bg-slate-50 p-3"><div className="text-xs text-slate-500">Release now</div><div className="text-xl font-semibold">{tickets.filter((ticket) => ticket.release_now).length}</div></div>
            <div className="rounded-lg bg-slate-50 p-3"><div className="text-xs text-slate-500">Next-task queue</div><div className="text-xl font-semibold">{tickets.filter((ticket) => !ticket.release_now).length}</div></div>
          </div>
          {selected && <div className="mt-3 text-xs text-slate-500">Remote release: {selected.counts.released} created · {selected.counts.failed} failed · {selected.counts.queued} queued.</div>}
        </Section>
      </aside>
    </div>

    {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
    {notice && <div role="status" className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">{notice}</div>}
    {!loading && !ctx && <EmptyState title="Taskmandu team data unavailable">The weekly planner needs the same employee list used by Brief to tickets. Check Taskmandu connectivity, then reload this page.</EmptyState>}
  </div>;
}
