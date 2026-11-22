import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import axios from 'axios';

type Item = {
  id: number; kind: 'Action' | 'Rough note'; title: string; notes: string | null;
  business: string | null; project_name: string | null; source: string;
  priority: 'High' | 'Medium' | 'Low'; status: 'Open' | 'Waiting' | 'Done' | 'Archived';
  due_date: string | null; created_at: string;
};

const api = axios.create({ baseURL: '/pm/api' });

export default function MyActionListPanel() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('Open');
  const [kind, setKind] = useState<'Action' | 'Rough note'>('Action');
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [business, setBusiness] = useState('');
  const [project, setProject] = useState('');
  const [priority, setPriority] = useState<'High' | 'Medium' | 'Low'>('Medium');
  const [dueDate, setDueDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try { const { data } = await api.get('/action-items'); setItems(data.items ?? []); setError(''); }
    catch { setError('Could not load your action list. Please retry.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    void load();
    const refresh = () => { void load(); };
    window.addEventListener('pm:action-items-changed', refresh);
    return () => window.removeEventListener('pm:action-items-changed', refresh);
  }, [load]);

  const visible = useMemo(() => items.filter((item) => filter === 'All' || item.status === filter), [items, filter]);
  const openCount = items.filter((i) => i.status === 'Open').length;
  const waitingCount = items.filter((i) => i.status === 'Waiting').length;

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true); setError('');
    try {
      await api.post('/action-items', {
        kind, title: title.trim(), notes: notes.trim() || null,
        business: business.trim() || null, project_name: project.trim() || null,
        source: 'My Action List', priority, due_date: dueDate || null,
      });
      setTitle(''); setNotes(''); setBusiness(''); setProject(''); setDueDate('');
      await load();
    } catch { setError('Could not save this item. Check the fields and try again.'); }
    finally { setSaving(false); }
  };

  const updateStatus = async (item: Item, status: Item['status']) => {
    try {
      const { data } = await api.patch(`/action-items/${item.id}`, { status });
      setItems((old) => old.map((row) => row.id === item.id ? data.item : row));
    } catch { setError('Could not update this item.'); }
  };
  const remove = async (item: Item) => {
    if (!window.confirm('Delete this item permanently?')) return;
    try { await api.delete(`/action-items/${item.id}`); setItems((old) => old.filter((row) => row.id !== item.id)); }
    catch { setError('Could not delete this item.'); }
  };

  return <div className="space-y-5">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><p className="text-sm text-slate-500">Capture anything that needs your attention while working through the other sections. It stays here until you resolve or archive it.</p>
        <div className="mt-3 flex gap-2 text-xs"><span className="rounded-full bg-amber-50 px-3 py-1 font-semibold text-amber-800">{openCount} open</span><span className="rounded-full bg-blue-50 px-3 py-1 font-semibold text-blue-800">{waitingCount} waiting</span></div>
      </div>
      <button onClick={() => void load()} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Refresh</button>
    </div>

    <form onSubmit={add} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold text-slate-900">Capture something</h2><div className="inline-flex rounded-lg bg-slate-100 p-1">
        {(['Action', 'Rough note'] as const).map((value) => <button key={value} type="button" onClick={() => setKind(value)} className={`rounded-md px-3 py-1.5 text-xs font-semibold ${kind === value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>{value}</button>)}
      </div></div>
      <label className="mb-1 block text-xs font-semibold text-slate-600">{kind === 'Action' ? 'What do you need to do?' : 'What did you notice or want to remember?'}</label>
      <input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} placeholder={kind === 'Action' ? 'e.g. Follow up with Senior Dev about booking issue' : 'e.g. Broker commission rules may need clarification'} className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" />
      <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Rough details, questions, what is unclear, who you are waiting for, or evidence to check later…" className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" />
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <input value={business} onChange={(e) => setBusiness(e.target.value)} placeholder="Business (optional)" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
        <input value={project} onChange={(e) => setProject(e.target.value)} placeholder="Project / website (optional)" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
        <select value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm"><option>High</option><option>Medium</option><option>Low</option></select>
        <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
      </div>
      <div className="mt-3 flex justify-end"><button disabled={saving || !title.trim()} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Saving…' : kind === 'Action' ? 'Add to action list' : 'Save rough note'}</button></div>
    </form>

    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4"><div><h2 className="font-semibold text-slate-900">Your captured items</h2><p className="text-xs text-slate-500">Work through open items one by one. Waiting items remain visible for later follow-up.</p></div>
        <select value={filter} onChange={(e) => setFilter(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm"><option>Open</option><option>Waiting</option><option>Done</option><option>Archived</option><option>All</option></select>
      </div>
      {error && <p role="alert" className="m-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
      {loading ? <p className="p-6 text-sm text-slate-500">Loading your items…</p> : visible.length === 0 ? <div className="p-8 text-center"><p className="font-medium text-slate-700">Nothing in this view.</p><p className="mt-1 text-sm text-slate-500">Capture an action or rough note above whenever something needs attention.</p></div> :
        <div className="divide-y divide-slate-100">{visible.map((item) => <article key={item.id} className="p-4">
          <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 flex-1">
            <div className="mb-1 flex flex-wrap items-center gap-2"><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${item.kind === 'Action' ? 'bg-indigo-50 text-indigo-700' : 'bg-violet-50 text-violet-700'}`}>{item.kind}</span><span className={`text-xs font-semibold ${item.priority === 'High' ? 'text-rose-600' : item.priority === 'Medium' ? 'text-amber-600' : 'text-slate-500'}`}>{item.priority} priority</span></div>
            <h3 className={`font-semibold ${item.status === 'Done' ? 'text-slate-400 line-through' : 'text-slate-900'}`}>{item.title}</h3>
            {item.notes && <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">{item.notes}</p>}
            <p className="mt-2 text-xs text-slate-400">{[item.business, item.project_name, item.source, item.due_date ? `Due ${item.due_date}` : null].filter(Boolean).join(' · ')}</p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2"><select aria-label={`Status for ${item.title}`} value={item.status} onChange={(e) => void updateStatus(item, e.target.value as Item['status'])} className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs"><option>Open</option><option>Waiting</option><option>Done</option><option>Archived</option></select><button onClick={() => void remove(item)} className="rounded-lg px-2 py-1.5 text-xs text-slate-400 hover:bg-rose-50 hover:text-rose-600">Delete</button></div>
          </div>
        </article>)}</div>}
    </section>
  </div>;
}
