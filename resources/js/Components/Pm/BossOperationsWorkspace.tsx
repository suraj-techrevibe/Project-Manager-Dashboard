import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { pmApi } from '../../lib/pmApi';
import { visitPm } from '../../lib/pmNav';
import RequestsIdeasPanel from './RequestsIdeasPanel';
import type { PmBusiness, PmOperationGoal, PmOperationGoalInput, PmOperationPlan, PmOperationPlanInput, PmOperationTask } from '../../types/pm';

type Tab = 'overview' | 'goals' | 'plans' | 'records';
type GoalForm = PmOperationGoalInput;
type PlanForm = PmOperationPlanInput;
const tabs: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' }, { id: 'goals', label: 'Goals & Dates' },
  { id: 'plans', label: 'Plans' }, { id: 'records', label: 'Records' },
];
const goalTypes = ['business_goal', 'event', 'launch', 'marketing', 'deadline', 'decision', 'opportunity', 'other'];
const goalTypeLabel = (v: string) => ({ business_goal: 'Business goal', event: 'Event', launch: 'Launch', marketing: 'Marketing', deadline: 'Deadline', decision: 'Decision', opportunity: 'Opportunity', other: 'Other' }[v] || v);
const goalStatuses = ['active', 'completed', 'cancelled'];
const planStatuses = ['draft', 'submitted_for_approval', 'changes_requested', 'approved', 'rejected', 'in_progress', 'completed', 'archived'];
const statusLabel = (v: string) => v.replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const priorityLabel = (v: string) => v === 'auto' ? 'Auto' : statusLabel(v);
const field = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100';
const label = 'mb-1 block text-xs font-semibold text-slate-600';
const primary = 'rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50';
const secondary = 'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50';
const blankGoal = (): GoalForm => ({ title: '', description: '', business_id: null, goal_type: 'business_goal', target_date: null, start_date: null, priority: 'auto', status: 'active', source_notes: '' });
const blankPlan = (goal?: PmOperationGoal | null): PlanForm => ({
  title: goal?.title ? `Plan: ${goal.title}` : '', business_id: goal?.business_id ?? null, goal_id: goal?.id ?? null, priority: 'auto',
  objective: '', background: '', proposed_approach: '', proposed_tasks: [], timeline: [],
  resource_requirements: '', expected_outcomes: '', risks: '', boss_comments: '', approval_notes: '', additional_notes: '',
});
const emptyTask = (): PmOperationTask => ({ title: '', description: '', responsible: '', due_date: null, dependencies: '', priority: 'auto', notes: '' });

function Pill({ value }: { value: string }) {
  const tone = ['urgent', 'rejected', 'cancelled'].includes(value) ? 'bg-rose-50 text-rose-700'
    : ['high', 'changes_requested', 'submitted_for_approval'].includes(value) ? 'bg-amber-50 text-amber-800'
    : ['approved', 'completed', 'in_progress'].includes(value) ? 'bg-emerald-50 text-emerald-700'
    : 'bg-slate-100 text-slate-600';
  return <span className={`inline-flex rounded-full px-2 py-1 text-[11px] font-semibold ${tone}`}>{statusLabel(value)}</span>;
}

export default function BossOperationsWorkspace() {
  const [tab, setTab] = useState<Tab>('overview');
  const [businesses, setBusinesses] = useState<PmBusiness[]>([]);
  const [goals, setGoals] = useState<PmOperationGoal[]>([]);
  const [plans, setPlans] = useState<PmOperationPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [goalForm, setGoalForm] = useState<GoalForm>(blankGoal());
  const [goalEditId, setGoalEditId] = useState<number | null>(null);
  const [goalOpen, setGoalOpen] = useState(false);
  const [planForm, setPlanForm] = useState<PlanForm>(blankPlan());
  const [planEditId, setPlanEditId] = useState<number | null>(null);
  const [planOpen, setPlanOpen] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [businessFilter, setBusinessFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [goalFrom, setGoalFrom] = useState('');
  const [goalSort, setGoalSort] = useState('deadline');
  const [recordsSearch, setRecordsSearch] = useState('');
  const [goalTo, setGoalTo] = useState('');
  const [unscheduledOnly, setUnscheduledOnly] = useState(false);
  const [planBusinessFilter, setPlanBusinessFilter] = useState('all');
  const [planStatusFilter, setPlanStatusFilter] = useState('all');
  const [planPriorityFilter, setPlanPriorityFilter] = useState('all');
  const [planFrom, setPlanFrom] = useState('');
  const [planTo, setPlanTo] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [b, g, p] = await Promise.all([pmApi.businesses(), pmApi.operationGoals(), pmApi.operationPlans()]);
      setBusinesses(b.data.businesses); setGoals(g.data.goals); setPlans(p.data.plans);
    } catch (e) {
      setError((e as any)?.response?.data?.message || 'Could not load the operations workspace.');
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const selected = plans.find((p) => p.id === selectedPlan) ?? null;
  const filteredGoals = useMemo(() => goals.filter((g) => {
    const q = search.trim().toLowerCase();
    return (!q || [g.title, g.description, g.source_notes, g.business?.name].join(' ').toLowerCase().includes(q))
      && (businessFilter === 'all' || String(g.business_id ?? '') === businessFilter)
      && (typeFilter === 'all' || g.goal_type === typeFilter)
      && (priorityFilter === 'all' || g.effective_priority === priorityFilter || g.priority === priorityFilter)
      && (statusFilter === 'all' || g.status === statusFilter)
      && (!unscheduledOnly || !g.target_date)
      && (!goalFrom || Boolean(g.target_date && g.target_date >= goalFrom))
      && (!goalTo || Boolean(g.target_date && g.target_date <= goalTo));
  }), [goals, search, businessFilter, typeFilter, priorityFilter, statusFilter, unscheduledOnly, goalFrom, goalTo]);
  const orderedGoals = [...filteredGoals].sort((a, b) => {
    if (goalSort === 'created') return (b.created_at || '').localeCompare(a.created_at || '');
    if (goalSort === 'priority') {
      const rank: Record<string, number> = { urgent: 6, high: 5, medium: 4, normal: 3, low: 2, unscheduled: 1 };
      return (rank[b.effective_priority] || 0) - (rank[a.effective_priority] || 0);
    }
    return (a.target_date || '9999-12-31').localeCompare(b.target_date || '9999-12-31');
  });
  const historicalGoals = goals.filter((g) => (g.status !== 'active' || g.goal_type === 'decision') && (!recordsSearch || [g.title, g.description, g.source_notes, g.business?.name].join(' ').toLowerCase().includes(recordsSearch.toLowerCase())));
  const historicalPlans = plans.filter((p) => ['approved', 'in_progress', 'completed', 'rejected', 'archived'].includes(p.status) && (!recordsSearch || [p.title, p.objective, p.business?.name].join(' ').toLowerCase().includes(recordsSearch.toLowerCase())));
  const upcoming = goals.filter((g) => g.status === 'active' && g.target_date).sort((a, b) => (a.target_date || '').localeCompare(b.target_date || '')).slice(0, 6);
  const urgent = goals.filter((g) => g.status === 'active' && g.effective_priority === 'urgent');
  const highPriority = goals.filter((g) => g.status === 'active' && g.effective_priority === 'high');
  const decisions = goals.filter((g) => g.goal_type === 'decision').sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || '')).slice(0, 5);
  const noDate = goals.filter((g) => g.status === 'active' && !g.target_date);
  const awaiting = plans.filter((p) => p.status === 'submitted_for_approval');
  const changes = plans.filter((p) => p.status === 'changes_requested');
  const recentPlans = [...plans].sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || '')).slice(0, 5);
  const filteredPlans = plans.filter((p) =>
    (!search || [p.title, p.business?.name, p.objective].join(' ').toLowerCase().includes(search.toLowerCase()))
    && (planBusinessFilter === 'all' || String(p.business_id ?? '') === planBusinessFilter)
    && (planStatusFilter === 'all' || p.status === planStatusFilter)
    && (planPriorityFilter === 'all' || p.priority === planPriorityFilter || p.effective_priority === planPriorityFilter)
    && (!planFrom || Boolean(p.updated_at && p.updated_at.slice(0, 10) >= planFrom))
    && (!planTo || Boolean(p.updated_at && p.updated_at.slice(0, 10) <= planTo)));

  function openNewGoal() { setGoalEditId(null); setGoalForm(blankGoal()); setGoalOpen(true); setError(''); }
  function openEditGoal(g: PmOperationGoal) {
    setGoalEditId(g.id); setGoalForm({ title: g.title, description: g.description ?? '', business_id: g.business_id, goal_type: g.goal_type, target_date: g.target_date, start_date: g.start_date, priority: g.priority, status: g.status, source_notes: g.source_notes ?? '' }); setGoalOpen(true);
  }
  async function saveGoal(e: FormEvent) {
    e.preventDefault(); setSaving(true); setError('');
    try {
      const payload = { ...goalForm, title: goalForm.title.trim(), description: goalForm.description || null, source_notes: goalForm.source_notes || null };
      const { data } = goalEditId ? await pmApi.updateOperationGoal(goalEditId, payload) : await pmApi.createOperationGoal(payload);
      setGoals((items) => goalEditId ? items.map((x) => x.id === goalEditId ? data.goal : x) : [data.goal, ...items]);
      setGoalOpen(false); setNotice('Goal saved.');
    } catch (e) { setError((e as any)?.response?.data?.message || 'Could not save this goal. Check the required fields.'); }
    finally { setSaving(false); }
  }
  async function deleteGoal(g: PmOperationGoal) {
    if (!window.confirm(`Delete “${g.title}”? This cannot be undone.`)) return;
    try { await pmApi.deleteOperationGoal(g.id); setGoals((items) => items.filter((x) => x.id !== g.id)); setNotice('Goal deleted.'); }
    catch (e) { setError((e as any)?.response?.data?.message || 'Could not delete this goal.'); }
  }

  function openNewPlan(goal?: PmOperationGoal | null) {
    setPlanEditId(null); setSelectedPlan(null); setPlanForm(blankPlan(goal)); setPlanOpen(true); setTab('plans'); setError('');
  }
  function openEditPlan(p: PmOperationPlan) {
    setPlanEditId(p.id); setSelectedPlan(p.id);
    setPlanForm({ title: p.title, business_id: p.business_id, goal_id: p.goal_id, priority: p.priority, objective: p.objective ?? '', background: p.background ?? '', proposed_approach: p.proposed_approach ?? '', proposed_tasks: p.proposed_tasks ?? [], timeline: p.timeline ?? [], resource_requirements: p.resource_requirements ?? '', expected_outcomes: p.expected_outcomes ?? '', risks: p.risks ?? '', boss_comments: p.boss_comments ?? '', approval_notes: p.approval_notes ?? '', additional_notes: p.additional_notes ?? '' });
    setPlanOpen(true); setError('');
  }
  async function savePlan(e: FormEvent) {
    e.preventDefault(); setSaving(true); setError('');
    try {
      const { data } = planEditId ? await pmApi.updateOperationPlan(planEditId, planForm) : await pmApi.createOperationPlan(planForm);
      setPlans((items) => planEditId ? items.map((x) => x.id === planEditId ? data.plan : x) : [data.plan, ...items]);
      setSelectedPlan(data.plan.id); setPlanEditId(data.plan.id); setPlanOpen(false); setNotice('Plan saved as a draft.');
    } catch (e) { setError((e as any)?.response?.data?.message || 'Could not save this plan.'); }
    finally { setSaving(false); }
  }
  async function transition(p: PmOperationPlan, status: string) {
    let boss_feedback: string | undefined;
    let approval_notes: string | undefined;
    if (status === 'changes_requested') {
      boss_feedback = window.prompt('Record the boss’s requested changes:') || '';
      if (!boss_feedback.trim()) return;
    }
    if (status === 'approved') approval_notes = window.prompt('Approval notes (optional):') || '';
    try {
      const { data } = await pmApi.transitionOperationPlan(p.id, { status, boss_feedback, approval_notes });
      setPlans((items) => items.map((x) => x.id === p.id ? data.plan : x));
      setNotice(`Plan marked ${statusLabel(status).toLowerCase()}.`);
    } catch (e) { setError((e as any)?.response?.data?.message || 'Could not update the plan workflow.'); }
  }
  async function duplicatePlan(p: PmOperationPlan) {
    try { const { data } = await pmApi.duplicateOperationPlan(p.id); setPlans((items) => [data.plan, ...items]); openEditPlan(data.plan); setNotice('Plan duplicated as a new draft.'); }
    catch (e) { setError((e as any)?.response?.data?.message || 'Could not duplicate the plan.'); }
  }
  async function deletePlan(p: PmOperationPlan) {
    if (!window.confirm(`Delete “${p.title}”? This cannot be undone.`)) return;
    try { await pmApi.deleteOperationPlan(p.id); setPlans((items) => items.filter((x) => x.id !== p.id)); if (selectedPlan === p.id) setSelectedPlan(null); setNotice('Plan deleted.'); }
    catch (e) { setError((e as any)?.response?.data?.message || 'Could not delete the plan.'); }
  }
  const setPlanField = <K extends keyof PlanForm>(key: K, value: PlanForm[K]) => setPlanForm((current) => ({ ...current, [key]: value }));
  const updateTask = (index: number, patch: Partial<PmOperationTask>) => setPlanForm((f) => ({ ...f, proposed_tasks: (f.proposed_tasks ?? []).map((t, i) => i === index ? { ...t, ...patch } : t) }));

  const buttonTab = (id: Tab) => `whitespace-nowrap border-b-2 px-3 py-3 text-sm font-medium ${tab === id ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`;
  const sectionTitle = (title: string, description?: string) => <div><h3 className="text-base font-semibold text-slate-900">{title}</h3>{description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}</div>;

  return <div className="flex flex-col gap-4">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><div className="text-xs font-semibold uppercase tracking-wider text-indigo-600">Private management workspace</div><h2 className="mt-1 text-2xl font-semibold text-slate-900">Boss & Business Operations</h2><p className="mt-1 max-w-2xl text-sm text-slate-500">Capture what matters, turn selected goals into proposed plans, and record the boss’s decisions before coordinating delivery.</p></div>
      <div className="flex gap-2"><button type="button" onClick={() => void load()} className={secondary}>Refresh</button><button type="button" onClick={openNewGoal} className={primary}>+ Record goal</button></div>
    </header>
    {error && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
    {notice && <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}<button className="ml-2 underline" onClick={() => setNotice('')}>Dismiss</button></div>}
    <nav className="flex gap-1 overflow-x-auto border-b border-slate-200">{tabs.map((t) => <button key={t.id} type="button" onClick={() => { setTab(t.id); setNotice(''); }} className={buttonTab(t.id)}>{t.label}{t.id === 'plans' && awaiting.length > 0 ? <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px]">{awaiting.length}</span> : null}</button>)}</nav>
    {loading ? <p className="py-8 text-center text-sm text-slate-500">Loading operations workspace…</p> : <>
    {tab === 'overview' && <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-7">
        {[
          ['Upcoming deadlines', upcoming.length, 'goals'], ['Urgent', urgent.length, 'urgent'], ['High priority', highPriority.length, 'high'], ['Goals without dates', noDate.length, 'nodate'],
          ['Awaiting approval', awaiting.length, 'awaiting'], ['Changes requested', changes.length, 'changes'], ['Active goals', goals.filter((g) => g.status === 'active').length, 'active'],
        ].map(([name, count, key]) => <button key={String(key)} onClick={() => { setTab(key === 'awaiting' || key === 'changes' ? 'plans' : 'goals'); if (key === 'urgent') setPriorityFilter('urgent'); if (key === 'high') setPriorityFilter('high'); if (key === 'nodate') { setStatusFilter('active'); setUnscheduledOnly(true); } }} className="rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm hover:border-indigo-300"><div className="text-xs text-slate-500">{name}</div><div className="mt-1 text-2xl font-semibold text-slate-900">{count}</div></button>)}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-4">{sectionTitle('Upcoming commitments', 'Closest target dates first')}
          <div className="mt-3 divide-y divide-slate-100">{upcoming.length ? upcoming.map((g) => <button key={g.id} onClick={() => { setTab('goals'); openEditGoal(g); }} className="flex w-full items-center justify-between gap-3 py-3 text-left"><span className="min-w-0"><span className="block truncate text-sm font-medium text-slate-800">{g.title}</span><span className="text-xs text-slate-500">{g.business?.name ?? 'No business'} · {goalTypeLabel(g.goal_type)}</span></span><span className="shrink-0 text-xs font-semibold text-slate-600">{g.target_date}</span></button>) : <p className="py-5 text-sm text-slate-500">No upcoming dated commitments.</p>}</div>
        </section>
        <section className="rounded-xl border border-slate-200 bg-white p-4">{sectionTitle('Plans needing attention', 'Boss review and requested revisions')}
          <div className="mt-3 divide-y divide-slate-100">{[...awaiting, ...changes].length ? [...awaiting, ...changes].map((p) => <button key={p.id} onClick={() => { setTab('plans'); setSelectedPlan(p.id); }} className="flex w-full items-center justify-between gap-3 py-3 text-left"><span className="min-w-0"><span className="block truncate text-sm font-medium text-slate-800">{p.title}</span><span className="text-xs text-slate-500">{p.business?.name ?? 'No business'}</span></span><Pill value={p.status}/></button>) : <p className="py-5 text-sm text-slate-500">No plans waiting for review.</p>}</div>
        </section>
      </div>
      <section className="rounded-xl border border-slate-200 bg-white p-4">{sectionTitle('Recently recorded decisions', 'Boss decisions captured as records')}
        <div className="mt-3 divide-y divide-slate-100">{decisions.length ? decisions.map((g) => <button key={g.id} onClick={() => { setTab('goals'); openEditGoal(g); }} className="flex w-full items-center justify-between gap-3 py-2 text-left"><span className="truncate text-sm font-medium text-slate-800">{g.title}</span><span className="shrink-0 text-xs text-slate-500">{g.updated_at?.slice(0, 10)}</span></button>) : <p className="py-4 text-sm text-slate-500">No decisions recorded yet.</p>}</div>
      </section>
      <section className="rounded-xl border border-slate-200 bg-white p-4">{sectionTitle('Recently updated plans')}
        <div className="mt-3 divide-y divide-slate-100">{recentPlans.length ? recentPlans.map((p) => <button key={p.id} onClick={() => { setTab('plans'); setSelectedPlan(p.id); }} className="flex w-full items-center justify-between gap-3 py-2.5 text-left"><span className="truncate text-sm font-medium text-slate-800">{p.title}</span><Pill value={p.status}/></button>) : <p className="py-4 text-sm text-slate-500">No plans created yet.</p>}</div>
      </section>
    </div>}
    {tab === 'goals' && <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">{sectionTitle('Goals & Dates', 'Business goals, events, launches, decisions and commitments')}<button onClick={openNewGoal} className={primary}>+ New goal / date</button></div>
      <div className="grid gap-2 rounded-xl border border-slate-200 bg-white p-3 md:grid-cols-5">
        <input className={field} placeholder="Search goals…" value={search} onChange={(e) => setSearch(e.target.value)}/>
        <select className={field} value={businessFilter} onChange={(e) => setBusinessFilter(e.target.value)}><option value="all">All businesses</option>{businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
        <select className={field} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}><option value="all">All types</option>{goalTypes.map((v) => <option key={v} value={v}>{goalTypeLabel(v)}</option>)}</select>
        <select className={field} value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)}><option value="all">All priorities</option>{['urgent','high','medium','normal','low','unscheduled'].map((v) => <option key={v} value={v}>{statusLabel(v)}</option>)}</select>
        <select className={field} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}><option value="all">All statuses</option>{goalStatuses.map((v) => <option key={v} value={v}>{statusLabel(v)}</option>)}</select>
        <select className={field} value={goalSort} onChange={(e) => setGoalSort(e.target.value)}><option value="deadline">Sort: closest deadline</option><option value="priority">Sort: priority</option><option value="created">Sort: recently created</option></select>
        <input type="date" aria-label="Target date from" className={field} value={goalFrom} onChange={(e) => setGoalFrom(e.target.value)} />
        <input type="date" aria-label="Target date to" className={field} value={goalTo} onChange={(e) => setGoalTo(e.target.value)} />
        <label className="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={unscheduledOnly} onChange={(e) => setUnscheduledOnly(e.target.checked)} /> No target date</label>
      </div>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">{orderedGoals.length ? orderedGoals.map((g) => <div key={g.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-3 last:border-0"><button className="min-w-0 flex-1 text-left" onClick={() => openEditGoal(g)}><span className="block truncate text-sm font-semibold text-slate-900">{g.title}</span><span className="mt-1 block text-xs text-slate-500">{g.business?.name ?? 'No business'} · {goalTypeLabel(g.goal_type)} · {g.target_date || 'No target date'}</span><span className="mt-1 flex flex-wrap gap-1.5"><Pill value={g.status}/><Pill value={g.effective_priority}/></span></button><div className="flex gap-2"><button className={secondary} onClick={() => openNewPlan(g)}>Create plan</button><button className={secondary} onClick={() => openEditGoal(g)}>Edit</button><button className="px-2 text-sm text-rose-600" onClick={() => void deleteGoal(g)}>Delete</button></div></div>) : <p className="p-8 text-center text-sm text-slate-500">No goals match these filters. Record a boss discussion, goal or commitment to get started.</p>}</div>
    </div>}
    {tab === 'plans' && <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">{sectionTitle('Planning documents', 'Prepare a proposal, submit it for review, and record the decision')}<button onClick={() => openNewPlan()} className={primary}>+ Create plan</button></div>
      {!planOpen && <div className="flex flex-col gap-3">
        <div className="grid gap-2 rounded-xl border border-slate-200 bg-white p-3 md:grid-cols-5">
          <input className={field} placeholder="Search plans…" value={search} onChange={(e) => setSearch(e.target.value)}/>
          <select className={field} value={planBusinessFilter} onChange={(e) => setPlanBusinessFilter(e.target.value)}><option value="all">All businesses</option>{businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
          <select className={field} value={planStatusFilter} onChange={(e) => setPlanStatusFilter(e.target.value)}><option value="all">All statuses</option>{planStatuses.map((v) => <option key={v} value={v}>{statusLabel(v)}</option>)}</select>
          <select className={field} value={planPriorityFilter} onChange={(e) => setPlanPriorityFilter(e.target.value)}><option value="all">All priorities</option>{['urgent', 'high', 'medium', 'normal', 'low', 'unscheduled'].map((v) => <option key={v} value={v}>{statusLabel(v)}</option>)}</select>
          <div className="flex gap-1"><input type="date" aria-label="Updated from" className={field} value={planFrom} onChange={(e) => setPlanFrom(e.target.value)} /><input type="date" aria-label="Updated to" className={field} value={planTo} onChange={(e) => setPlanTo(e.target.value)} /></div>
        </div>
        <div className="grid gap-3 lg:grid-cols-[minmax(260px,0.8fr)_minmax(0,1.5fr)]">
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="max-h-[720px] overflow-y-auto">{filteredPlans.map((p) => <button key={p.id} onClick={() => setSelectedPlan(p.id)} className={`block w-full border-b border-slate-100 p-3 text-left hover:bg-slate-50 ${selectedPlan === p.id ? 'bg-indigo-50' : ''}`}><span className="block text-sm font-semibold text-slate-800">{p.title}</span><span className="mt-1 block text-xs text-slate-500">{p.business?.name ?? 'No business'} · {p.updated_at?.slice(0,10)}</span><span className="mt-1 inline-flex"><Pill value={p.status}/></span></button>)}{plans.length === 0 && <p className="p-6 text-sm text-slate-500">No plans yet. Create a draft or start from a goal.</p>}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          {selected ? <><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-lg font-semibold text-slate-900">{selected.title}</h3><p className="mt-1 text-sm text-slate-500">{selected.business?.name ?? 'No business'}{selected.goal ? ` · ${selected.goal.title}` : ''}</p><div className="mt-2 flex gap-2"><Pill value={selected.status}/><Pill value={selected.effective_priority}/></div></div><div className="flex flex-wrap gap-2"><button className={secondary} onClick={() => openEditPlan(selected)}>Edit document</button><button className={secondary} onClick={() => void duplicatePlan(selected)}>Duplicate</button></div></div>
            <div className="mt-2 text-xs text-slate-500">Submitted: {selected.submitted_at?.slice(0, 16).replace('T', ' ') || 'Not submitted'} · Last reviewed: {selected.reviewed_at?.slice(0, 16).replace('T', ' ') || 'Not reviewed'}</div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">{[['Objective',selected.objective],['Background',selected.background],['Proposed approach',selected.proposed_approach],['Resources',selected.resource_requirements],['Expected outcomes',selected.expected_outcomes],['Risks',selected.risks],['Boss feedback',selected.boss_comments],['Approval notes',selected.approval_notes]].map(([k,v]) => <div key={k}><div className="text-xs font-semibold text-slate-500">{k}</div><p className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{v || '—'}</p></div>)}</div>
            <div className="mt-4 border-t border-slate-100 pt-3"><h4 className="text-sm font-semibold">Proposed tasks ({selected.proposed_tasks.length})</h4>{selected.proposed_tasks.map((t,i) => <div key={i} className="mt-2 rounded-lg bg-slate-50 p-3"><div className="text-sm font-medium">{t.title}</div><div className="text-xs text-slate-500">{t.responsible || 'Unassigned role'} · {t.due_date || 'No proposed date'} · {priorityLabel(t.priority || 'auto')}</div></div>)}</div>
            <div className="mt-4 border-t border-slate-100 pt-3"><h4 className="text-sm font-semibold">Review history ({selected.revisions.length})</h4>{selected.revisions.map((r) => <div key={r.id} className="mt-2 text-xs text-slate-600">Revision {r.revision_number} · {statusLabel(r.event)} · {r.created_at?.slice(0,16).replace('T',' ')}{r.change_reason ? ` — ${r.change_reason}` : ''}</div>)}</div>
            <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
              {selected.status === 'draft' || selected.status === 'changes_requested' ? <button className={primary} onClick={() => void transition(selected,'submitted_for_approval')}>Submit for boss review</button> : null}
              {selected.status === 'submitted_for_approval' ? <><button className={primary} onClick={() => void transition(selected,'approved')}>Record approval</button><button className={secondary} onClick={() => void transition(selected,'changes_requested')}>Request changes</button><button className={secondary} onClick={() => void transition(selected,'rejected')}>Record rejection</button></> : null}
              {['approved', 'in_progress'].includes(selected.status) && selected.proposed_tasks.length > 0 ? <button className={secondary} onClick={async () => { const text = selected.proposed_tasks.map((t) => 'Task: ' + t.title + '\nDescription: ' + (t.description || '') + '\nResponsible: ' + (t.responsible || '') + '\nDue: ' + (t.due_date || '') + '\nPriority: ' + (t.priority || 'auto') + '\nDependencies: ' + (t.dependencies || '')).join('\n\n'); try { await navigator.clipboard.writeText(text); visitPm('brief'); setNotice('Approved task proposals copied. Paste them into Brief to tickets to prepare the existing Taskmandu workflow.'); } catch { setError('Could not copy the task proposals.'); } }}>Copy tasks to Brief workflow</button> : null}
              {selected.status === 'approved' ? <button className={primary} onClick={() => void transition(selected,'in_progress')}>Start execution</button> : null}
              {selected.status === 'in_progress' ? <button className={primary} onClick={() => void transition(selected,'completed')}>Mark completed</button> : null}
              {selected.status !== 'archived' && <button className={secondary} onClick={() => void transition(selected,'archived')}>Archive</button>}
              <button className="px-2 text-sm text-rose-600" onClick={() => void deletePlan(selected)}>Delete</button>
            </div>
          </> : <p className="py-12 text-center text-sm text-slate-500">Select a plan to view the document and approval history.</p>}
        </div>
        </div>
      </div>}
      {planOpen && <form onSubmit={savePlan} className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between"><h3 className="text-lg font-semibold">{planEditId ? 'Edit planning document' : 'New planning document'}</h3><button type="button" onClick={() => setPlanOpen(false)} className="text-sm text-slate-500">Close</button></div>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div className="md:col-span-2"><label className={label}>Plan title *</label><input required className={field} value={planForm.title} onChange={(e) => setPlanField('title',e.target.value)}/></div>
          <div><label className={label}>Priority</label><select className={field} value={planForm.priority} onChange={(e) => setPlanField('priority',e.target.value as PlanForm['priority'])}>{['auto','urgent','high','medium','low'].map((v) => <option key={v} value={v}>{priorityLabel(v)}</option>)}</select></div>
          <div><label className={label}>Business</label><select className={field} value={planForm.business_id ?? ''} onChange={(e) => setPlanField('business_id',e.target.value ? Number(e.target.value) : null)}><option value="">Select business</option>{businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
          <div><label className={label}>Linked goal</label><select className={field} value={planForm.goal_id ?? ''} onChange={(e) => { const g=goals.find((x)=>x.id===Number(e.target.value)); setPlanForm((f)=>({...f,goal_id:g?.id??null,business_id:g?.business_id??f.business_id})); }}><option value="">Independent plan</option>{goals.map((g)=><option key={g.id} value={g.id}>{g.title}</option>)}</select></div>
        </div>
        {([['objective','Objective — what we want to achieve'],['background','Background — why this plan is necessary'],['proposed_approach','Proposed approach — strategy and actions'],['resource_requirements','Resource requirements — people, budget, technology'],['expected_outcomes','Expected outcomes — measurable results'],['risks','Risks and considerations'],['boss_comments','Boss comments and feedback'],['approval_notes','Approval decision / notes'],['additional_notes','Additional notes']] as [keyof PlanForm,string][]).map(([key,title])=><div key={key} className="mt-4"><label className={label}>{title}</label><textarea rows={key==='proposed_approach'||key==='background'?4:2} className={field} value={String(planForm[key] ?? '')} onChange={(e)=>setPlanField(key,e.target.value as never)}/></div>)}
        <div className="mt-5 border-t border-slate-100 pt-4"><div className="flex items-center justify-between"><h4 className="font-semibold text-slate-900">Proposed tasks</h4><button type="button" className={secondary} onClick={()=>setPlanField('proposed_tasks',[...(planForm.proposed_tasks??[]),emptyTask()])}>+ Add proposed task</button></div>
          {(planForm.proposed_tasks??[]).map((t,i)=><div key={i} className="mt-3 rounded-xl border border-slate-200 p-3"><div className="flex items-center justify-between"><span className="text-xs font-semibold text-slate-500">Task proposal {i+1}</span><button type="button" className="text-xs text-rose-600" onClick={()=>setPlanField('proposed_tasks',(planForm.proposed_tasks??[]).filter((_,j)=>j!==i))}>Remove</button></div><div className="mt-2 grid gap-2 md:grid-cols-2"><input required className={field} placeholder="Task title" value={t.title} onChange={(e)=>updateTask(i,{title:e.target.value})}/><input className={field} placeholder="Responsible team / role" value={t.responsible??''} onChange={(e)=>updateTask(i,{responsible:e.target.value})}/><textarea className={field} placeholder="Description" value={t.description??''} onChange={(e)=>updateTask(i,{description:e.target.value})}/><textarea className={field} placeholder="Dependencies" value={t.dependencies??''} onChange={(e)=>updateTask(i,{dependencies:e.target.value})}/><input type="date" className={field} value={t.due_date??''} onChange={(e)=>updateTask(i,{due_date:e.target.value||null})}/><select className={field} value={t.priority??'auto'} onChange={(e)=>updateTask(i,{priority:e.target.value as PmOperationTask['priority']})}>{['auto','urgent','high','medium','low'].map((v)=><option key={v} value={v}>{priorityLabel(v)}</option>)}</select><input className={field+' md:col-span-2'} placeholder="Notes" value={t.notes??''} onChange={(e)=>updateTask(i,{notes:e.target.value})}/></div></div>)}
          {(planForm.proposed_tasks??[]).length===0 && <p className="mt-2 text-sm text-slate-500">No proposed tasks yet. Add task breakdowns here; nothing is sent to Taskmandu until you explicitly use the existing task workflow after approval.</p>}
        </div>
        <div className="mt-5 border-t border-slate-100 pt-4"><div className="flex items-center justify-between"><h4 className="font-semibold text-slate-900">Timeline milestones</h4><button type="button" className={secondary} onClick={()=>setPlanField('timeline',[...(planForm.timeline??[]),{milestone:'',date:null,notes:''}])}>+ Add milestone</button></div>
          {(planForm.timeline??[]).map((m,i)=><div key={i} className="mt-2 grid gap-2 rounded-lg bg-slate-50 p-2 md:grid-cols-[1fr_180px_1fr_auto]"><input className={field} placeholder="Milestone" value={m.milestone} onChange={(e)=>setPlanField('timeline',(planForm.timeline??[]).map((x,j)=>j===i?{...x,milestone:e.target.value}:x))}/><input type="date" className={field} value={m.date??''} onChange={(e)=>setPlanField('timeline',(planForm.timeline??[]).map((x,j)=>j===i?{...x,date:e.target.value||null}:x))}/><input className={field} placeholder="Notes" value={m.notes??''} onChange={(e)=>setPlanField('timeline',(planForm.timeline??[]).map((x,j)=>j===i?{...x,notes:e.target.value}:x))}/><button type="button" className="text-xs text-rose-600" onClick={()=>setPlanField('timeline',(planForm.timeline??[]).filter((_,j)=>j!==i))}>Remove</button></div>)}
        </div>
        <div className="mt-5 flex justify-end gap-2 border-t border-slate-100 pt-4"><button type="button" className={secondary} onClick={()=>setPlanOpen(false)}>Cancel</button><button disabled={saving} className={primary}>{saving?'Saving…':'Save draft'}</button></div>
      </form>}
    </div>}
    {tab === 'records' && <div className="flex flex-col gap-5">
      <section className="rounded-xl border border-slate-200 bg-white p-4">{sectionTitle('Historical records', 'Completed commitments, decisions and past planning documents')}
        <input className={field + ' mt-3'} placeholder="Search historical records…" value={recordsSearch} onChange={(e) => setRecordsSearch(e.target.value)} />
        <div className="mt-3 divide-y divide-slate-100">{historicalGoals.map((g)=><div key={g.id} className="flex items-center justify-between gap-3 py-2"><span className="text-sm">{g.title}<span className="ml-2 text-xs text-slate-500">{g.business?.name??'No business'}</span></span><Pill value={g.status}/></div>)}
          {historicalPlans.map((p)=><button key={p.id} onClick={()=>{setTab('plans');setSelectedPlan(p.id);}} className="flex w-full items-center justify-between gap-3 py-2 text-left"><span className="text-sm">{p.title}<span className="ml-2 text-xs text-slate-500">{p.business?.name??'No business'}</span></span><Pill value={p.status}/></button>)}
          {historicalGoals.length === 0 && historicalPlans.length === 0 && <p className="py-4 text-sm text-slate-500">Historical records will appear here as goals and plans are completed, cancelled, rejected or archived.</p>}
        </div>
      </section>
      <section className="rounded-xl border border-slate-200 bg-white p-4"><h3 className="mb-3 text-base font-semibold">Existing boss requests & ideas</h3><RequestsIdeasPanel/></section>
    </div>}
    </>}
    {goalOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-3" role="dialog" aria-modal="true" aria-label="Goal editor"><form onSubmit={saveGoal} className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl"><div className="flex items-center justify-between"><h3 className="text-lg font-semibold">{goalEditId?'Edit goal or commitment':'Record boss discussion / goal'}</h3><button type="button" onClick={()=>setGoalOpen(false)} className="text-sm text-slate-500">Close</button></div><div className="mt-4 grid gap-3 sm:grid-cols-2"><div className="sm:col-span-2"><label className={label}>Title *</label><input required maxLength={200} className={field} value={goalForm.title} onChange={(e)=>setGoalForm((f)=>({...f,title:e.target.value}))}/></div><div><label className={label}>Business</label><select className={field} value={goalForm.business_id??''} onChange={(e)=>setGoalForm((f)=>({...f,business_id:e.target.value?Number(e.target.value):null}))}><option value="">No business selected</option>{businesses.map((b)=><option key={b.id} value={b.id}>{b.name}</option>)}</select></div><div><label className={label}>Type</label><select className={field} value={goalForm.goal_type} onChange={(e)=>setGoalForm((f)=>({...f,goal_type:e.target.value as GoalForm['goal_type']}))}>{goalTypes.map((v)=><option key={v} value={v}>{goalTypeLabel(v)}</option>)}</select></div><div><label className={label}>Start date</label><input type="date" className={field} value={goalForm.start_date??''} onChange={(e)=>setGoalForm((f)=>({...f,start_date:e.target.value||null}))}/></div><div><label className={label}>Target date</label><input type="date" className={field} value={goalForm.target_date??''} onChange={(e)=>setGoalForm((f)=>({...f,target_date:e.target.value||null}))}/></div><div><label className={label}>Priority</label><select className={field} value={goalForm.priority} onChange={(e)=>setGoalForm((f)=>({...f,priority:e.target.value as GoalForm['priority']}))}>{['auto','urgent','high','medium','low'].map((v)=><option key={v} value={v}>{priorityLabel(v)}</option>)}</select></div><div><label className={label}>Status</label><select className={field} value={goalForm.status} onChange={(e)=>setGoalForm((f)=>({...f,status:e.target.value as GoalForm['status']}))}>{goalStatuses.map((v)=><option key={v} value={v}>{statusLabel(v)}</option>)}</select></div><div className="sm:col-span-2"><label className={label}>Description / rough notes</label><textarea rows={3} className={field} value={goalForm.description??''} onChange={(e)=>setGoalForm((f)=>({...f,description:e.target.value}))}/></div><div className="sm:col-span-2"><label className={label}>What the boss said / source context</label><textarea rows={3} className={field} value={goalForm.source_notes??''} onChange={(e)=>setGoalForm((f)=>({...f,source_notes:e.target.value}))}/></div></div><div className="mt-5 flex justify-end gap-2"><button type="button" className={secondary} onClick={()=>setGoalOpen(false)}>Cancel</button><button disabled={saving} className={primary}>{saving?'Saving…':'Save record'}</button></div></form></div>}
  </div>;
}
