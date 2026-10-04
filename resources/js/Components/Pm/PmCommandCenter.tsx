import { useEffect, useState } from 'react';
import { pmApi } from '../../lib/pmApi';
import { setUrlParams } from '../../lib/urlState';
import type { CommandCenterData } from '../../types/pm';

const tone = {
  red: 'bg-red-100 text-red-700',
  amber: 'bg-amber-100 text-amber-700',
  green: 'bg-green-100 text-green-700',
  slate: 'bg-slate-100 text-slate-600',
};

function ago(iso: string | null): string {
  if (!iso) return 'unknown';
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function PmCommandCenter() {
  const [data, setData] = useState<CommandCenterData | null>(null);
  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState<Array<{ employeeId: string; name: string; week_hours?: number; capacity?: number }>>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [followUp, setFollowUp] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await pmApi.commandCenter();
      setData(r.data);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); pmApi.employees().then((r) => setEmployees(r.data.employees)).catch(() => setEmployees([])); }, []);

  if (loading) return <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-500">Loading command center…</div>;
  if (!data) return null;

  const critical = data.actions.filter((a) => a.priority === 0).length;
  const risk = data.projects.filter((p) => p.health !== 'green').length;
  const waiting = data.waiting.length;
  const available = data.free.reduce((n, w) => n + w.room, 0);

  const openProject = (id: string | null) => {
    if (!id) return;
    setUrlParams({ tab: 'projects', project: id, ptab: null, task: null, sub: null });
  };
  const openTask = (projectId: string | null, taskId: string | null) => {
    if (projectId && taskId) setUrlParams({ tab: 'projects', project: projectId, ptab: 'tasks', task: taskId, sub: null });
  };
  const reassign = async (cardId: number) => {
    const card = data?.actions.find((a) => a.card_id === cardId);
    const choices = employees.filter((e) => (e.capacity ?? 40) - (e.week_hours ?? 0) > 0);
    if (!choices.length) return;
    const pick = choices[0];
    setBusy(`reassign-${cardId}`);
    try { await pmApi.commandCenterReassign(cardId, pick.employeeId); await load(); } finally { setBusy(null); }
  };
  const resolveBlocker = async (cardId: number) => {
    setBusy(`blocker-${cardId}`);
    try { await pmApi.commandCenterResolveBlocker(cardId); await load(); } finally { setBusy(null); }
  };
  const followWaiting = async (id: number) => {
    setBusy(`waiting-${id}`);
    try { const r = await pmApi.commandCenterFollowUp(id); setFollowUp(r.data.message); } finally { setBusy(null); }
  };

  const openToday = (filter?: string) => {
    setUrlParams({ tab: 'today', project: null, ptab: null, task: null, sub: null, filter: filter || null });
  };

  return (
    <section className="mb-5 space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">PM Command Center</h1>
          <p className="text-sm text-slate-500">Decide what needs action now. Today remains the detailed task workspace.</p>
        </div>
        <button onClick={load} className="rounded-md border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50">Refresh</button>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <button onClick={() => openToday('critical')} className="rounded-xl border border-red-200 bg-red-50 p-3 text-left hover:border-red-300">
          <div className="text-xs text-red-600">Needs attention</div><div className="mt-1 text-2xl font-bold text-red-700">{critical}</div><div className="text-[11px] text-red-600">Open detailed tasks →</div>
        </button>
        <button onClick={() => setUrlParams({ tab: 'projects', project: null, ptab: null, task: null, sub: null })} className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-left hover:border-amber-300">
          <div className="text-xs text-amber-700">Projects at risk</div><div className="mt-1 text-2xl font-bold text-amber-800">{risk}</div><div className="text-[11px] text-amber-700">Review projects →</div>
        </button>
        <button onClick={() => setUrlParams({ tab: 'automation', project: null, ptab: null, task: null, sub: null })} className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-left hover:border-blue-300">
          <div className="text-xs text-blue-700">Waiting on clients</div><div className="mt-1 text-2xl font-bold text-blue-800">{waiting}</div><div className="text-[11px] text-blue-700">Open follow-up tools →</div>
        </button>
        <button onClick={() => openToday()} className="rounded-xl border border-green-200 bg-green-50 p-3 text-left hover:border-green-300">
          <div className="text-xs text-green-700">Available capacity</div><div className="mt-1 text-2xl font-bold text-green-800">{available}h</div><div className="text-[11px] text-green-700">See Team workload →</div>
        </button>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1.45fr_.85fr]">
        <section className="rounded-2xl border border-slate-200 bg-white">
          <div className="border-b border-slate-100 px-4 py-3">
            <h2 className="font-semibold text-slate-900">Needs attention</h2>
            <p className="text-xs text-slate-500">Each row has a PM decision, not just a count.</p>
          </div>
          <div className="divide-y divide-slate-100">
            {data.actions.length ? data.actions.map((a, i) => (
              <div key={`${a.kind}-${a.card_id ?? i}`} className="flex items-center gap-3 px-4 py-3">
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${a.priority === 0 ? tone.red : tone.amber}`}>{a.priority === 0 ? 'HIGH' : 'REVIEW'}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-slate-900">{a.title}</div>
                  <div className="truncate text-xs text-slate-500">{a.reason}</div>
                </div>
                {a.kind === 'task' && a.card_id && a.action === 'Assign owner' ? (
                  <button disabled={busy === `reassign-${a.card_id}`} onClick={() => reassign(a.card_id!)} className="shrink-0 rounded-md bg-slate-900 px-2.5 py-1.5 text-xs text-white">{busy === `reassign-${a.card_id}` ? 'Assigning…' : 'Assign owner'}</button>
                ) : a.kind === 'task' && a.card_id && a.action === 'Resolve blocker' ? (
                  <button disabled={busy === `blocker-${a.card_id}`} onClick={() => resolveBlocker(a.card_id!)} className="shrink-0 rounded-md bg-slate-900 px-2.5 py-1.5 text-xs text-white">{busy === `blocker-${a.card_id}` ? 'Updating…' : 'Resolve blocker'}</button>
                ) : a.kind === 'task' && a.project_id && a.task_id ? (
                  <button onClick={() => openTask(a.project_id, a.task_id)} className="shrink-0 rounded-md bg-slate-900 px-2.5 py-1.5 text-xs text-white">Review task</button>
                ) : a.kind === 'capacity' ? (
                  <button onClick={() => openToday()} className="shrink-0 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs text-slate-700">Rebalance</button>
                ) : null}
              </div>
            )) : <div className="px-4 py-6 text-sm text-slate-500">No urgent PM decisions right now.</div>}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="font-semibold text-slate-900">Capacity decision</h2>
          {data.overloaded.length ? (
            <div className="mt-3 space-y-2">
              {data.overloaded.map((w) => <div key={w.name} className="rounded-lg border border-red-100 bg-red-50/50 p-3">
                <div className="flex justify-between text-sm font-medium"><span>{w.name}</span><span className="text-red-700">{w.excess}h over</span></div>
                <div className="mt-1 text-xs text-slate-500">{w.week_hours}h / {w.capacity}h · {w.overdue} overdue · {w.open} open</div>
                <button onClick={() => openToday()} className="mt-2 text-xs font-medium text-red-700 underline">Open workload →</button>
              </div>)}
            </div>
          ) : <div className="mt-3 rounded-lg bg-green-50 p-3 text-sm text-green-700">No one is over capacity.</div>}
          {data.free.slice(0, 3).map((w) => <div key={w.name} className="mt-2 flex justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs"><span>{w.name}</span><span className="font-medium text-green-700">{w.room}h room</span></div>)}
        </section>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1.2fr_.8fr]">
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between"><div><h2 className="font-semibold text-slate-900">Project risk radar</h2><p className="text-xs text-slate-500">Deterministic score from delivery, tasks, schedule, team and client signals.</p></div><button onClick={() => setUrlParams({ tab: 'projects' })} className="text-xs underline">All projects →</button></div>
          <div className="mt-3 space-y-2">
            {data.projects.map((p) => (
              <button key={p.project_id} onClick={() => openProject(p.project_id)} className="w-full rounded-lg border border-slate-100 p-3 text-left hover:border-slate-300">
                <div className="flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 rounded-full ${p.health === 'red' ? 'bg-red-500' : p.health === 'amber' ? 'bg-amber-400' : 'bg-green-500'}`} />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{p.project_name}</span>
                  <b className="text-sm">{p.score}</b>
                </div>
                <div className="mt-2 grid grid-cols-5 gap-1 text-[10px] text-slate-500">
                  <span>Delivery <b>{p.delivery}</b></span><span>Tasks <b>{p.tasks}</b></span><span>Schedule <b>{p.schedule}</b></span><span>Team <b>{p.team}</b></span><span>Client <b>{p.client}</b></span>
                </div>
                <div className="mt-2 text-xs text-slate-600">{p.why.length ? `Why: ${p.why.join(' · ')}` : 'No current risk reason.'}</div>
              </button>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between"><div><h2 className="font-semibold text-slate-900">Waiting for</h2><p className="text-xs text-slate-500">Client/internal follow-up queue.</p></div><button onClick={() => setUrlParams({ tab: 'automation' })} className="text-xs underline">Manage →</button></div>
          <div className="mt-3 space-y-2">
            {data.waiting.map((w) => <div key={w.id} className="rounded-lg border border-slate-100 p-3">
              <div className="flex items-center gap-2"><span className={`rounded px-1.5 py-0.5 text-[10px] ${tone[w.severity]}`}>{w.days}d</span><span className="truncate text-sm font-medium">{w.title}</span></div>
              <div className="mt-2 flex gap-2"><button disabled={busy === `waiting-${w.id}`} onClick={() => followWaiting(w.id)} className="rounded-md bg-slate-900 px-2.5 py-1.5 text-xs text-white">{busy === `waiting-${w.id}` ? 'Drafting…' : 'Draft follow-up'}</button>{w.project_id && <button onClick={() => openProject(w.project_id)} className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs">Project</button>}</div>
            </div>)}
            {!data.waiting.length && <div className="text-sm text-slate-500">Nothing waiting on a client.</div>}
          </div>
        </section>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between"><div><h2 className="font-semibold text-slate-900">What changed</h2><p className="text-xs text-slate-500">Last 24 hours from PM sync activity.</p></div><button onClick={() => setUrlParams({ tab: 'reports' })} className="text-xs underline">Open reports →</button></div>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {data.recent.map((r, i) => <div key={`${r.type}-${i}`} className="rounded-lg bg-slate-50 px-3 py-2 text-xs">
            <div className="font-medium text-slate-800">{r.type.replace('_', ' ')} · {r.title || 'item'}</div>
            <div className="mt-0.5 text-slate-500">{r.project || 'Standalone'} · {ago(r.occurred_at)}{r.from || r.to ? ` · ${r.from || 'new'} → ${r.to || 'new'}` : ''}</div>
          </div>)}
          {!data.recent.length && <div className="text-sm text-slate-500">No changes recorded yet.</div>}
        </div>
      </section>
    </section>
  );
}
