import { useEffect, useState } from 'react';
import { pmApi } from '../../lib/pmApi';
import type { CommandCenterData } from '../../types/pm';

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

  useEffect(() => {
    pmApi.commandCenter().then(({ data }) => setData(data)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-500">Loading PM command center…</div>;
  if (!data) return null;

  const critical = data.actions.filter((a) => a.priority === 0).length;
  const risk = data.projects.filter((p) => p.health !== 'green').length;

  return (
    <section className="mb-5 space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-slate-900">PM Command Center</h1>
          <p className="text-sm text-slate-500">What needs your attention, who needs help, and which projects are drifting.</p>
        </div>
        <div className="flex gap-2 text-xs">
          <span className={`rounded-full px-2.5 py-1 ${critical ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>{critical} critical</span>
          <span className={`rounded-full px-2.5 py-1 ${risk ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>{risk} projects at risk</span>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600">{data.waiting.length} waiting</span>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1.35fr_.8fr_.8fr]">
        <div className="rounded-2xl border border-slate-200 bg-white">
          <div className="border-b border-slate-100 px-4 py-3">
            <h2 className="font-semibold text-slate-900">My action queue</h2>
            <p className="text-xs text-slate-500">Prioritised from the current Taskmandu snapshot.</p>
          </div>
          <div className="divide-y divide-slate-100">
            {data.actions.length ? data.actions.map((a) => (
              <div key={`${a.card_id}-${a.kind}`} className="flex items-start gap-3 px-4 py-3">
                <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${a.priority === 0 ? 'bg-red-500' : a.priority === 1 ? 'bg-amber-400' : 'bg-slate-300'}`} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-slate-900">{a.title}</div>
                  <div className="text-xs text-slate-500">{a.project_name || 'Standalone'} · {a.assignee || 'Unassigned'} · {a.reason}</div>
                </div>
                <span className="shrink-0 text-xs font-medium text-slate-600">{a.action}</span>
              </div>
            )) : <div className="px-4 py-6 text-sm text-slate-500">Nothing urgent. Good position.</div>}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="font-semibold text-slate-900">Capacity</h2>
          <div className="mt-3 space-y-3">
            {data.overloaded.length ? data.overloaded.map((w) => (
              <div key={w.name}>
                <div className="flex justify-between text-xs"><span>{w.name}</span><b className="text-red-600">{w.excess}h over</b></div>
                <div className="mt-1 h-2 rounded bg-slate-100"><div className="h-2 rounded bg-red-500" style={{ width: `${Math.min(100, (w.week_hours / w.capacity) * 100)}%` }} /></div>
                <div className="mt-1 text-[11px] text-slate-400">{w.week_hours}h / {w.capacity}h</div>
              </div>
            )) : <div className="text-sm text-slate-500">Nobody is over capacity.</div>}
            {data.free.slice(0, 3).map((w) => <div key={w.name} className="flex justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs"><span>{w.name}</span><span className="font-medium text-green-700">{w.room}h room</span></div>)}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="font-semibold text-slate-900">Waiting on</h2>
          <div className="mt-3 space-y-2">
            {data.waiting.length ? data.waiting.slice(0, 5).map((w) => (
              <div key={w.id} className="rounded-lg border border-slate-100 px-3 py-2">
                <div className="text-sm font-medium text-slate-800">{w.title}</div>
                <div className="text-xs text-slate-500">{w.days}d waiting</div>
              </div>
            )) : <div className="text-sm text-slate-500">No client waiting items.</div>}
          </div>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="font-semibold text-slate-900">Project risk radar</h2>
          <div className="mt-3 space-y-2">
            {data.projects.length ? data.projects.map((p) => (
              <div key={p.project_id} className="flex items-center gap-3 rounded-lg border border-slate-100 px-3 py-2">
                <span className={`h-2.5 w-2.5 rounded-full ${p.health === 'red' ? 'bg-red-500' : p.health === 'amber' ? 'bg-amber-400' : 'bg-green-500'}`} />
                <span className="min-w-0 flex-1 truncate text-sm">{p.project_name}</span>
                <span className="text-xs text-slate-500">{p.overdue} overdue · {p.blocked} blocked · {p.idle_days}d idle</span>
                <b className="text-sm">{p.score}</b>
              </div>
            )) : <div className="text-sm text-slate-500">No active project risk data yet.</div>}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="font-semibold text-slate-900">Recent changes</h2>
          <div className="mt-3 space-y-2">
            {data.recent.length ? data.recent.map((r, i) => (
              <div key={`${r.type}-${i}`} className="flex justify-between gap-3 text-xs">
                <span className="truncate text-slate-700"><b>{r.type.replace('_', ' ')}</b> · {r.title || 'item'}{r.project ? ` · ${r.project}` : ''}</span>
                <span className="shrink-0 text-slate-400">{ago(r.occurred_at)}</span>
              </div>
            )) : <div className="text-sm text-slate-500">No recent PM activity yet.</div>}
          </div>
        </div>
      </div>
    </section>
  );
}
