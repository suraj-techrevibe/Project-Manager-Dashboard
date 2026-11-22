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
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editBusiness, setEditBusiness] = useState('');
  const [editProject, setEditProject] = useState('');
  const [editPriority, setEditPriority] = useState<Item['priority']>('Medium');
  const [editDueDate, setEditDueDate] = useState('');

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
  const beginEdit = (item: Item) => {
    setEditingId(item.id); setEditTitle(item.title); setEditNotes(item.notes ?? '');
    setEditBusiness(item.business ?? ''); setEditProject(item.project_name ?? '');
    setEditPriority(item.priority); setEditDueDate(item.due_date?.slice(0, 10) ?? '');
  };

  const saveEdit = async (e: FormEvent) => {
    e.preventDefault();
    if (editingId === null || !editTitle.trim()) return;
    setSaving(true); setError('');
    try {
      const { data } = await api.patch(`/action-items/${editingId}`, {
        title: editTitle.trim(), notes: editNotes.trim() || null,
        business: editBusiness.trim() || null, project_name: editProject.trim() || null,
        priority: editPriority, due_date: editDueDate || null,
      });
      setItems((old) => old.map((row) => row.id === editingId ? data.item : row));
      setEditingId(null);
    } catch { setError('Could not save your changes. Please try again.'); }
    finally { setSaving(false); }
  };

  const convertToAction = async (item: Item) => {
    if (item.kind !== 'Rough note') return;
    try {
      const { data } = await api.patch(`/action-items/${item.id}`, { kind: 'Action' });
      setItems((old) => old.map((row) => row.id === item.id ? data.item : row));
    } catch { setError('Could not convert this note to an action.'); }
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
      <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="font-semibold text-slate-900">Your captured items</h2>
          <p className="text-xs text-slate-500">Work through open items one by one. Waiting items remain visible for later follow-up.</p>
        </div>
        <select value={filter} onChange={(e) => setFilter(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm sm:w-auto"><option>Open</option><option>Waiting</option><option>Done</option><option>Archived</option><option>All</option></select>
      </div>
      {error && <p role="alert" className="m-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
      {loading ? <p className="p-6 text-sm text-slate-500">Loading your items…</p> : visible.length === 0 ? <div className="p-8 text-center"><p className="font-medium text-slate-700">Nothing in this view.</p><p className="mt-1 text-sm text-slate-500">Capture an action or rough note above whenever something needs attention.</p></div> :
        <div className="grid grid-cols-1 gap-3 p-3 sm:grid-cols-2 sm:p-4 xl:grid-cols-3">{visible.map((item) => <article key={item.id} className={`flex min-w-0 flex-col rounded-xl border border-slate-200 border-l-4 bg-white p-4 shadow-sm ${item.priority === 'High' ? 'border-l-rose-500' : item.priority === 'Medium' ? 'border-l-amber-400' : 'border-l-slate-300'} ${editingId === item.id ? 'sm:col-span-2 xl:col-span-3' : ''}`}>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${item.kind === 'Action' ? 'bg-indigo-50 text-indigo-700' : 'bg-violet-50 text-violet-700'}`}>{item.kind}</span>
            <span className={`text-xs font-semibold ${item.priority === 'High' ? 'text-rose-600' : item.priority === 'Medium' ? 'text-amber-600' : 'text-slate-500'}`}>{item.priority} priority</span>
            {item.due_date && <span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">Due {item.due_date.slice(0, 10)}</span>}
          </div>
          <h3 className={`break-words font-semibold ${item.status === 'Done' ? 'text-slate-400 line-through' : 'text-slate-900'}`}>{item.title}</h3>
          {item.notes && <p className="mt-2 line-clamp-4 whitespace-pre-wrap break-words text-sm text-slate-600">{item.notes}</p>}
          <p className="mt-2 break-words text-xs text-slate-400">{[item.business, item.project_name, item.source].filter(Boolean).join(' · ')}</p>
          <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
            <select aria-label={`Status for ${item.title}`} value={item.status} onChange={(e) => void updateStatus(item, e.target.value as Item['status'])} className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2 py-2 text-xs sm:flex-none"><option>Open</option><option>Waiting</option><option>Done</option><option>Archived</option></select>
            <button onClick={() => beginEdit(item)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50">Edit</button>
            {item.kind === 'Rough note' && <button onClick={() => void convertToAction(item)} className="rounded-lg border border-indigo-200 px-3 py-2 text-xs font-medium text-indigo-700 hover:bg-indigo-50">Make action</button>}
            <button onClick={() => void remove(item)} className="ml-auto rounded-lg px-2 py-2 text-xs text-slate-400 hover:bg-rose-50 hover:text-rose-600">Delete</button>
          </div>
          {editingId === item.id && <form onSubmit={saveEdit} className="mt-4 rounded-xl border border-indigo-100 bg-indigo-50/40 p-3">
            <div className="mb-2 flex items-center justify-between"><h4 className="text-sm font-semibold text-slate-800">Edit captured item</h4><button type="button" onClick={() => setEditingId(null)} className="text-xs text-slate-500">Cancel</button></div>
            <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} required maxLength={200} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" aria-label="Item title" />
            <textarea value={editNotes} onChange={(e) => setEditNotes(e.target.value)} rows={3} placeholder="Notes" className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" />
            <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <input value={editBusiness} onChange={(e) => setEditBusiness(e.target.value)} placeholder="Business" className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" />
              <input value={editProject} onChange={(e) => setEditProject(e.target.value)} placeholder="Project / website" className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" />
              <select value={editPriority} onChange={(e) => setEditPriority(e.target.value as Item['priority'])} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"><option>High</option><option>Medium</option><option>Low</option></select>
              <input type="date" value={editDueDate} onChange={(e) => setEditDueDate(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" />
            </div>
            <div className="mt-3 flex justify-end"><button disabled={saving || !editTitle.trim()} className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{saving ? 'Saving…' : 'Save changes'}</button></div>
          </form>}
        </article>)}</div>}
    </section>
  </div>;
}
