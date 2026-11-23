import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import TaskQAInbox from '@/Components/Pm/TaskQAInbox';
import QADesk from '@/Components/Pm/QADesk';

type RecordType = 'Website' | 'Ad-hoc';
type Status = 'Draft' | 'Reported' | 'Fixing' | 'Ready for Retest' | 'Passed' | 'Failed';
type Severity = 'Critical' | 'High' | 'Medium' | 'Low';
type QARecord = {
  id: number; record_type: RecordType; business: string | null; site_app: string | null;
  project_id: string | null; project_name: string | null; task_id: string | null;
  task_title: string | null; subtask_id: string | null; subtask_title: string | null;
  page_url: string | null; title: string; description: string | null;
  expected_behaviour: string | null; developer_notes: string | null; severity: Severity;
  status: Status; assignee: string | null; evidence_url: string | null;
  retest_notes: string | null; pm_task_url: string | null; created_at: string;
};
type Website = {
  id: number; business: string; project_id: string | null; project_name: string | null;
  name: string; url: string; website_type: string; frequency: string; is_active: boolean;
};
type Draft = Partial<QARecord> & { record_type: RecordType; title: string };
type Filters = { businesses: string[]; projects: { id: string; name: string }[] };
const input = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500';
const blank: Draft = { record_type: 'Ad-hoc', business: '', site_app: '', project_id: '', project_name: '', task_id: '', task_title: '', subtask_id: '', subtask_title: '', page_url: '', title: '', description: '', expected_behaviour: '', developer_notes: '', severity: 'Medium', status: 'Draft', assignee: '', evidence_url: '', retest_notes: '', pm_task_url: '' };
const tabs = [
  ['review', 'Review Desk'], ['overview', 'Overview'], ['websites', 'Website QA'], ['tasks', 'Task QA'],
  ['adhoc', 'All Quick QA Records'], ['records', 'All QA records'], ['retest', 'Needs retest'],
] as const;
type Tab = typeof tabs[number][0];

export default function QACenter() {
  const [items, setItems] = useState<QARecord[]>([]);
  const [websites, setWebsites] = useState<Website[]>([]);
  const [filters, setFilters] = useState<Filters>({ businesses: [], projects: [] });
  const [draft, setDraft] = useState<Draft>(blank);
  const [tab, setTab] = useState<Tab>('overview');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [businessFilter, setBusinessFilter] = useState('All');
  const [query, setQuery] = useState('');
  const [showWebsiteForm, setShowWebsiteForm] = useState(false);
  const [websiteDraft, setWebsiteDraft] = useState({ business: '', project_id: '', project_name: '', name: '', url: '', website_type: 'Business website', frequency: 'Manual' });
  const [websiteSaving, setWebsiteSaving] = useState(false);
  const [inlineEditId, setInlineEditId] = useState<number | null>(null);
  const [inlineDraft, setInlineDraft] = useState<Partial<QARecord>>({});
  const [inlineSaving, setInlineSaving] = useState(false);

  async function load() {
    setLoading(true); setError('');
    try {
      const { data } = await axios.get('/pm/api/qa');
      setItems(data.issues ?? []);
      setWebsites(data.websites ?? []);
      setFilters({ businesses: data.filters?.businesses ?? [], projects: data.filters?.projects ?? [] });
    } catch { setError('Unable to load QA records. Please refresh and try again.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  const openItems = items.filter(x => !['Passed'].includes(x.status));
  const failed = items.filter(x => ['Failed', 'Reported'].includes(x.status));
  const retest = items.filter(x => x.status === 'Ready for Retest');
  const passed = items.filter(x => x.status === 'Passed');
  const filteredItems = useMemo(() => items.filter(x =>
    (businessFilter === 'All' || x.business === businessFilter) &&
    (tab === 'adhoc' ? x.record_type === 'Ad-hoc' : tab === 'retest' ? x.status === 'Ready for Retest' : tab === 'records' ? true : x.record_type === 'Website') &&
    (!query || [x.title, x.business, x.site_app, x.project_name, x.task_title, x.description, x.assignee].filter(Boolean).join(' ').toLowerCase().includes(query.toLowerCase()))
  ), [items, businessFilter, query, tab]);

  const groupedItems = useMemo(() => {
    const groups = new Map<string, QARecord[]>();
    filteredItems.forEach(item => {
      const business = item.business?.trim() || 'Business not detected';
      groups.set(business, [...(groups.get(business) ?? []), item]);
    });
    return [...groups.entries()].sort(([a], [b]) => {
      if (a === 'Business not detected') return 1;
      if (b === 'Business not detected') return -1;
      const ai = filters.businesses.indexOf(a), bi = filters.businesses.indexOf(b);
      if (ai >= 0 && bi >= 0) return ai - bi;
      if (ai >= 0) return -1;
      if (bi >= 0) return 1;
      return a.localeCompare(b);
    });
  }, [filteredItems, filters.businesses]);

  function beginInlineEdit(item: QARecord) {
    setInlineEditId(item.id);
    setInlineDraft({ ...item });
  }
  async function saveInlineEdit() {
    if (!inlineEditId || !inlineDraft.title?.trim()) return;
    setInlineSaving(true); setError('');
    try {
      const current = items.find(item => item.id === inlineEditId);
      if (!current) return;
      await axios.patch('/pm/api/qa/' + inlineEditId, {
        ...current, ...inlineDraft, title: inlineDraft.title.trim(),
        severity: inlineDraft.severity ?? current.severity,
        status: inlineDraft.status ?? current.status,
      });
      setInlineEditId(null); setInlineDraft({});
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Could not update this QA record.');
    } finally { setInlineSaving(false); }
  }

  function change<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft(current => ({ ...current, [key]: value }));
  }
  function startWebsiteQA(site: Website) {
    setDraft({ ...blank, record_type: 'Website', business: site.business, site_app: site.name, project_id: site.project_id ?? '', project_name: site.project_name ?? '', page_url: site.url, title: 'Website QA - ' + site.name, status: 'Draft' });
    setTab('records');
    setError('');
  }
  function startAdhoc() {
    setDraft({ ...blank, record_type: 'Ad-hoc', title: '', status: 'Draft' });
    setTab('adhoc');
    setError('');
  }
  function edit(item: QARecord) {
    setDraft({ ...item });
    setTab(item.record_type === 'Website' ? 'records' : 'adhoc');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  async function saveRecord() {
    if (!draft.title?.trim()) { setError('Enter a clear QA record title.'); return; }
    setSaving(true); setError('');
    try {
      const payload = { ...blank, ...draft, title: draft.title.trim() };
      if (draft.id) await axios.patch('/pm/api/qa/' + draft.id, payload);
      else await axios.post('/pm/api/qa', payload);
      setDraft(blank);
      await load();
    } catch (e: any) { setError(e?.response?.data?.message || 'Could not save this QA record.'); }
    finally { setSaving(false); }
  }
  async function deleteRecord(id: number) {
    if (!window.confirm('Delete this QA record? This cannot be undone.')) return;
    try { await axios.delete('/pm/api/qa/' + id); await load(); }
    catch { setError('Could not delete QA record.'); }
  }
  async function saveWebsite() {
    if (!websiteDraft.business || !websiteDraft.name.trim() || !/^https?:\/\/.+/.test(websiteDraft.url.trim())) {
      setError('Select a business and enter a website name and valid URL.'); return;
    }
    setWebsiteSaving(true); setError('');
    try {
      await axios.post('/pm/api/qa/websites', { ...websiteDraft, name: websiteDraft.name.trim(), url: websiteDraft.url.trim() });
      setWebsiteDraft({ business: '', project_id: '', project_name: '', name: '', url: '', website_type: 'Business website', frequency: 'Manual' });
      setShowWebsiteForm(false);
      await load();
    } catch (e: any) { setError(e?.response?.data?.message || 'Could not register this website.'); }
    finally { setWebsiteSaving(false); }
  }
  async function deleteWebsite(site: Website) {
    if (!window.confirm('Remove ' + site.name + ' from the website registry? Existing QA records will remain.')) return;
    try { await axios.delete('/pm/api/qa/websites/' + site.id); await load(); }
    catch { setError('Could not remove website.'); }
  }

  const recordForm = (heading: string) => (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h2 className="font-semibold text-slate-900">{draft.id ? 'Edit QA record' : heading}</h2><p className="text-xs text-slate-500">Record what you tested, what happened and what needs to happen next.</p></div>
        {draft.id && <span className="rounded-full bg-indigo-50 px-2 py-1 text-xs text-indigo-700">Editing #{draft.id}</span>}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1 text-xs font-medium text-slate-600">Business<select className={input} value={draft.business ?? ''} onChange={e => change('business', e.target.value)}><option value="">Select business</option>{filters.businesses.map(b => <option key={b}>{b}</option>)}</select></label>
        {draft.record_type === 'Website' ? <label className="space-y-1 text-xs font-medium text-slate-600">Website<select className={input} value={draft.site_app ?? ''} onChange={e => { const site = websites.find(w => w.name === e.target.value && w.business === draft.business); change('site_app', e.target.value); if (site) change('page_url', site.url); }}><option value="">Select website</option>{websites.filter(w => !draft.business || w.business === draft.business).map(w => <option key={w.id} value={w.name}>{w.name}</option>)}</select></label> : <label className="space-y-1 text-xs font-medium text-slate-600">Project (optional)<select className={input} value={draft.project_id ?? ''} onChange={e => { const p = filters.projects.find(x => x.id === e.target.value); change('project_id', e.target.value); change('project_name', p?.name ?? ''); }}><option value="">Select project</option>{filters.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
        <input className={input} placeholder="QA record title *" value={draft.title ?? ''} onChange={e => change('title', e.target.value)}/>
        <input className={input} placeholder={draft.record_type === 'Website' ? 'Page URL being tested' : 'Website / app / item (optional)'} value={draft.page_url ?? ''} onChange={e => change('page_url', e.target.value)}/>
        <select className={input} value={draft.severity ?? 'Medium'} onChange={e => change('severity', e.target.value as Severity)}>{(['Critical','High','Medium','Low'] as Severity[]).map(v => <option key={v}>{v}</option>)}</select>
        <select className={input} value={draft.status ?? 'Draft'} onChange={e => change('status', e.target.value as Status)}>{(['Draft','Reported','Fixing','Ready for Retest','Passed','Failed'] as Status[]).map(v => <option key={v}>{v}</option>)}</select>
        <input className={input} placeholder="Assigned developer / owner" value={draft.assignee ?? ''} onChange={e => change('assignee', e.target.value)}/>
        <input className={input} placeholder="Evidence URL (screenshot / recording)" value={draft.evidence_url ?? ''} onChange={e => change('evidence_url', e.target.value)}/>
        <textarea className={input + ' md:col-span-2'} rows={3} placeholder="What did you check and what actually happened?" value={draft.description ?? ''} onChange={e => change('description', e.target.value)}/>
        <textarea className={input + ' md:col-span-2'} rows={2} placeholder="Expected result" value={draft.expected_behaviour ?? ''} onChange={e => change('expected_behaviour', e.target.value)}/>
        <textarea className={input + ' md:col-span-2'} rows={2} placeholder="Developer feedback / suggested correction" value={draft.developer_notes ?? ''} onChange={e => change('developer_notes', e.target.value)}/>
        <textarea className={input + ' md:col-span-2'} rows={2} placeholder="Retest notes (complete when retesting)" value={draft.retest_notes ?? ''} onChange={e => change('retest_notes', e.target.value)}/>
        <input className={input + ' md:col-span-2'} placeholder="Link to related Taskmandu task (optional)" value={draft.pm_task_url ?? ''} onChange={e => change('pm_task_url', e.target.value)}/>
      </div>
      <div className="flex flex-wrap gap-2"><button type="button" disabled={saving} onClick={() => void saveRecord()} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Saving…' : draft.id ? 'Update QA record' : 'Save QA record'}</button><button type="button" onClick={() => setDraft(blank)} className="rounded-lg border px-3 py-2 text-sm">Clear</button></div>
    </section>
  );

  return <div className="space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-xl font-semibold text-slate-900">QA Centre</h1><p className="text-sm text-slate-500">Website checks, Taskmandu delivery verification and quick QA checks.</p></div>{tab !== 'review' && <button type="button" onClick={startAdhoc} className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white">＋ Quick QA</button>}</div>
    <div className="flex flex-wrap gap-2">{tabs.map(([key, label]) => <button key={key} type="button" onClick={() => { setTab(key); setDraft(blank); }} className={'rounded-lg px-3 py-2 text-sm font-medium ' + (tab === key ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-white text-slate-700')}>{label}</button>)}</div>
    {error && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
    {tab === 'review' ? <QADesk onManageWebsites={() => setTab('websites')} /> : loading ? <p className="rounded-xl border bg-white p-5 text-sm text-slate-500">Loading QA records…</p> : <>
      {tab === 'overview' && <>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[['Open records', openItems.length], ['Awaiting retest', retest.length], ['Failed / reported', failed.length], ['Passed', passed.length]].map(([label, value]) => <div key={String(label)} className="rounded-xl border bg-white p-4"><div className="text-xs text-slate-500">{label}</div><div className="mt-1 text-2xl font-semibold">{value}</div></div>)}</div>
        <div className="grid gap-3 lg:grid-cols-3"><button onClick={() => setTab('websites')} className="rounded-xl border bg-white p-4 text-left hover:border-indigo-300"><div className="text-sm font-semibold">Website QA</div><p className="mt-1 text-xs text-slate-500">{websites.length} registered websites · create a check record</p></button><button onClick={() => setTab('tasks')} className="rounded-xl border bg-white p-4 text-left hover:border-indigo-300"><div className="text-sm font-semibold">Taskmandu Task QA</div><p className="mt-1 text-xs text-slate-500">Verify team work submitted as Completed or Review</p></button><button onClick={startAdhoc} className="rounded-xl border bg-white p-4 text-left hover:border-indigo-300"><div className="text-sm font-semibold">Quick QA</div><p className="mt-1 text-xs text-slate-500">Record an unexpected check or request</p></button></div>
        <section className="rounded-xl border bg-white p-4"><h2 className="font-semibold">Recent QA records</h2>{items.slice(0,6).map(x => <div key={x.id} className="flex flex-wrap items-center justify-between gap-2 border-t py-3 text-sm"><div><div className="font-medium">{x.title}</div><div className="text-xs text-slate-500">{x.business || 'Business not set'} · {x.record_type === 'Ad-hoc' ? 'Quick QA record' : x.record_type} · {x.status}</div></div><button className="text-indigo-700" onClick={() => edit(x)}>Open</button></div>)}{!items.length && <p className="pt-3 text-sm text-slate-500">No QA records yet.</p>}</section>
      </>}
      {tab === 'websites' && <>
        <section className="rounded-xl border bg-white p-4"><div className="flex items-center justify-between gap-3"><div><h2 className="font-semibold">Website registry</h2><p className="text-xs text-slate-500">Websites are grouped under your existing Taskmandu business names.</p></div><button onClick={() => setShowWebsiteForm(v => !v)} className="rounded-lg bg-slate-900 px-3 py-2 text-sm text-white">＋ Add website</button></div>
          {showWebsiteForm && <div className="mt-4 grid gap-2 rounded-lg border bg-slate-50 p-3 md:grid-cols-2"><select className={input} value={websiteDraft.business} onChange={e => setWebsiteDraft(v => ({ ...v, business: e.target.value }))}><option value="">Select business</option>{filters.businesses.map(b => <option key={b}>{b}</option>)}</select><input className={input} placeholder="Website name" value={websiteDraft.name} onChange={e => setWebsiteDraft(v => ({ ...v, name: e.target.value }))}/><input className={input + ' md:col-span-2'} placeholder="https://example.com" value={websiteDraft.url} onChange={e => setWebsiteDraft(v => ({ ...v, url: e.target.value }))}/><select className={input} value={websiteDraft.website_type} onChange={e => setWebsiteDraft(v => ({ ...v, website_type: e.target.value }))}>{['Business website','E-commerce','Event platform','Dashboard','Web application','Other'].map(v => <option key={v}>{v}</option>)}</select><select className={input} value={websiteDraft.frequency} onChange={e => setWebsiteDraft(v => ({ ...v, frequency: e.target.value }))}>{['Daily','Weekly','Manual'].map(v => <option key={v}>{v}</option>)}</select><select className={input} value={websiteDraft.project_id} onChange={e => { const p = filters.projects.find(x => x.id === e.target.value); setWebsiteDraft(v => ({ ...v, project_id: e.target.value, project_name: p?.name ?? '' })); }}><option value="">Link Taskmandu project (optional)</option>{filters.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select><div className="flex gap-2"><button disabled={websiteSaving} onClick={() => void saveWebsite()} className="rounded-lg bg-indigo-700 px-3 py-2 text-sm text-white disabled:opacity-50">{websiteSaving ? 'Saving…' : 'Save website'}</button><button onClick={() => setShowWebsiteForm(false)} className="rounded-lg border px-3 py-2 text-sm">Cancel</button></div></div>}
        </section>
        {filters.businesses.map(b => { const rows = websites.filter(w => w.business === b); if (!rows.length) return null; return <section key={b} className="rounded-xl border bg-white p-4"><h3 className="font-semibold">{b}</h3><div className="mt-2 divide-y">{rows.map(site => <div key={site.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div className="min-w-0"><div className="font-medium text-sm">{site.name}</div><a className="break-all text-xs text-indigo-700" href={site.url} target="_blank" rel="noreferrer">{site.url}</a><div className="text-xs text-slate-500">{site.project_name || 'No project linked'} · {site.website_type} · {site.frequency} QA</div></div><div className="flex gap-2"><button onClick={() => startWebsiteQA(site)} className="rounded-lg bg-indigo-700 px-3 py-2 text-xs font-semibold text-white">Start QA</button><button onClick={() => void deleteWebsite(site)} className="rounded-lg border px-2 py-2 text-xs text-rose-700">Remove</button></div></div>)}</div></section>; })}
        {websites.length === 0 && <div className="rounded-xl border bg-white p-5 text-sm text-slate-500">No websites registered. Add your first website to begin recording website QA.</div>}
      </>}
      {tab === 'tasks' && <TaskQAInbox/>}
      {tab === 'adhoc' && <>{recordForm('Quick QA record')}<section className="rounded-xl border bg-white p-4"><h2 className="font-semibold">All Quick QA Records</h2>{items.filter(x => x.record_type === 'Ad-hoc').map(x => <div key={x.id} className="flex flex-wrap items-center justify-between gap-2 border-t py-3 text-sm"><div><div className="font-medium">{x.title}</div><div className="text-xs text-slate-500">{x.business} · {x.status} · {new Date(x.created_at).toLocaleDateString()}</div></div><button onClick={() => edit(x)} className="text-indigo-700">Open</button></div>)}</section></>}
      {(tab === 'records' || tab === 'retest') && <>
        {draft.record_type === 'Website' && draft.title && recordForm('Record website QA')}
        <section className="space-y-3 rounded-xl border bg-white p-4"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">{tab === 'retest' ? 'Records ready for retest' : 'All QA records'}</h2><div className="flex gap-2"><select className="rounded-lg border px-2 py-2 text-sm" value={businessFilter} onChange={e => setBusinessFilter(e.target.value)}><option>All</option>{filters.businesses.map(b => <option key={b}>{b}</option>)}</select><input className="max-w-48 rounded-lg border px-2 py-2 text-sm" placeholder="Search records" value={query} onChange={e => setQuery(e.target.value)}/></div></div>
          {filteredItems.length === 0 ? <p className="text-sm text-slate-500">No matching QA records.</p> : <div className="space-y-4">
            <section className="rounded-lg border border-indigo-100 bg-indigo-50/50 p-3">
              <h3 className="text-sm font-semibold text-slate-900">Business overview</h3>
              <p className="mt-1 text-xs text-slate-500">Records are automatically grouped using their linked business or Taskmandu project. Unmatched records stay visible under Business not detected so you can correct them inline.</p>
              <div className="mt-3 flex flex-wrap gap-2">{groupedItems.map(([business, rows]) => <span key={business} className="rounded-full border border-white bg-white px-3 py-1 text-xs text-slate-700">{business} · {rows.length}</span>)}</div>
            </section>
            {groupedItems.map(([business, rows]) => <section key={business} className="overflow-hidden rounded-lg border border-slate-200">
              <div className="flex items-center justify-between gap-2 bg-slate-50 px-3 py-2"><h3 className="font-semibold text-slate-900">{business}</h3><span className="text-xs text-slate-500">{rows.length} record(s)</span></div>
              <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-left text-xs text-slate-500"><tr>{['Record','Type / website','Priority','Status','Owner','Actions'].map(x => <th key={x} className="p-3">{x}</th>)}</tr></thead><tbody>
                {rows.map(x => <tr key={x.id} className="border-t align-top">
                  {inlineEditId === x.id ? <>
                    <td className="min-w-56 p-3"><input className={input} value={inlineDraft.title ?? ''} onChange={e => setInlineDraft(v => ({ ...v, title: e.target.value }))}/><input className={input + ' mt-2'} placeholder="Business" value={inlineDraft.business ?? ''} onChange={e => setInlineDraft(v => ({ ...v, business: e.target.value }))}/><input className={input + ' mt-2'} placeholder="Page URL" value={inlineDraft.page_url ?? ''} onChange={e => setInlineDraft(v => ({ ...v, page_url: e.target.value }))}/></td>
                    <td className="min-w-36 p-3"><div className="text-xs text-slate-500">{x.record_type === 'Ad-hoc' ? 'Quick QA record' : 'Website QA'}</div><input className={input + ' mt-2'} placeholder="Website / app" value={inlineDraft.site_app ?? ''} onChange={e => setInlineDraft(v => ({ ...v, site_app: e.target.value }))}/></td>
                    <td className="p-3"><select className={input} value={inlineDraft.severity ?? x.severity} onChange={e => setInlineDraft(v => ({ ...v, severity: e.target.value as Severity }))}>{(['Critical','High','Medium','Low'] as Severity[]).map(v => <option key={v}>{v}</option>)}</select></td>
                    <td className="p-3"><select className={input} value={inlineDraft.status ?? x.status} onChange={e => setInlineDraft(v => ({ ...v, status: e.target.value as Status }))}>{(['Draft','Reported','Fixing','Ready for Retest','Passed','Failed'] as Status[]).map(v => <option key={v}>{v}</option>)}</select></td>
                    <td className="p-3"><input className={input} placeholder="Owner" value={inlineDraft.assignee ?? ''} onChange={e => setInlineDraft(v => ({ ...v, assignee: e.target.value }))}/></td>
                    <td className="p-3"><div className="flex flex-wrap gap-2"><button disabled={inlineSaving} onClick={() => void saveInlineEdit()} className="font-medium text-indigo-700 disabled:opacity-50">{inlineSaving ? 'Saving…' : 'Save'}</button><button onClick={() => { setInlineEditId(null); setInlineDraft({}); }} className="text-slate-500">Cancel</button></div></td>
                  </> : <>
                    <td className="min-w-48 p-3"><div className="font-medium">{x.title}</div><div className="text-xs text-slate-500">{x.page_url}</div></td>
                    <td className="p-3"><div>{x.record_type === 'Ad-hoc' ? 'Quick QA record' : 'Website QA'}</div><div className="text-xs text-slate-500">{x.site_app || '—'}</div></td>
                    <td className="p-3">{x.severity}</td><td className="p-3">{x.status}</td><td className="p-3">{x.assignee || '—'}</td>
                    <td className="p-3"><div className="flex flex-wrap gap-2"><button onClick={() => beginInlineEdit(x)} className="text-indigo-700">Inline edit</button><button onClick={() => edit(x)} className="text-slate-600">Full edit</button><button onClick={() => void deleteRecord(x.id)} className="text-rose-700">Delete</button></div></td>
                  </>}
                </tr>)}
              </tbody></table></div>
            </section>)}
          </div>}
        </section>
      </>}
    </>}
  </div>;
}
