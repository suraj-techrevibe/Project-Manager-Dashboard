// @ts-nocheck
import { useEffect, useState } from 'react';
import { pmApi } from '@/lib/pmApi';

export default function AutomationPanel() {
  const [batch, setBatch] = useState<any>(null);
  const [health, setHealth] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const load = async () => {
    const [b, h] = await Promise.all([pmApi.automationNudgeBatch(), pmApi.projectHealth()]);
    setBatch(b.data.batch);
    setHealth(h.data.health);
  };
  useEffect(() => { load(); }, []);

  const generate = async () => {
    setBusy(true);
    try {
      const r = await pmApi.generateNudgeBatch();
      setBatch(r.data.batch);
      setMessage('Review batch ready.');
    } finally { setBusy(false); }
  };

  const send = async () => {
    if (!batch) return;
    setBusy(true);
    try {
      const r = await pmApi.sendNudgeBatch(batch.id);
      setMessage(r.data.sent + ' nudges sent' + (r.data.errors?.length ? '; ' + r.data.errors.length + ' skipped' : '') + '.');
      await load();
    } finally { setBusy(false); }
  };

  const updateItem = (index: number, patch: any) => {
    const items = batch.items.map((x: any, i: number) => i === index ? { ...x, ...patch } : x);
    setBatch({ ...batch, items });
    pmApi.updateNudgeBatch(batch.id, items);
  };

  return <div className="space-y-4">
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="font-medium text-slate-900">Auto-nudge</h3>
          <p className="text-xs text-slate-500">Overdue or idle tasks are drafted with a fixed template. Nothing sends until you click Send.</p>
        </div>
        <button onClick={generate} disabled={busy} className="rounded-md bg-slate-900 px-3 py-2 text-sm text-white">{busy ? 'Working…' : 'Generate batch'}</button>
      </div>
      {message && <p className="mt-3 text-sm text-slate-600">{message}</p>}
      {batch?.items?.length ? <div className="mt-4 space-y-2">
        {batch.items.map((x: any, i: number) => <label key={i} className="flex gap-3 rounded-lg border border-slate-100 p-3">
          <input type="checkbox" checked={x.selected !== false} onChange={e => updateItem(i, { selected: e.target.checked })} />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">{x.title}</div>
            <div className="text-xs text-slate-500">{x.assignee} · {x.reason}</div>
            <textarea value={x.message} onChange={e => updateItem(i, { message: e.target.value })} className="mt-2 w-full rounded border border-slate-200 p-2 text-sm" />
          </div>
        </label>)}
        <button onClick={send} disabled={busy || batch.status === 'sent'} className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white">Send selected</button>
      </div> : <p className="mt-4 text-sm text-slate-500">No review batch yet.</p>}
    </section>

    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="font-medium text-slate-900">Project health</h3>
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        {health.map(h => <div key={h.project_id} className="flex items-center justify-between rounded-lg border border-slate-100 p-3">
          <div><div className="text-sm font-medium">{h.project_name}</div><div className="text-xs text-slate-500">{h.overdue_count} overdue · {h.idle_days} idle days</div></div>
          <span className={"rounded-full px-2 py-1 text-xs font-medium " + (h.health === 'red' ? 'bg-red-100 text-red-700' : h.health === 'amber' ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700')}>{h.score} · {h.health}</span>
        </div>)}
      </div>
    </section>
  </div>;
}