import { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';

type Status = 'queue' | 'testing' | 'failed' | 'passed';
type Check = { id: string; text: string; done: boolean };
type Screenshot = { id: string; name: string; url: string; created_at: string };
type HistoryEntry = { at: string; message: string };
type DeskItem = {
  id: number; title: string; business: string | null; site_app: string | null;
  source: 'Taskmandu' | 'Site check' | 'Client report'; source_id: string | null;
  assignee: string | null; url: string | null; status: Status; checks: Check[];
  screenshots: Screenshot[]; fail_note: string | null; history: HistoryEntry[];
  created_at: string; updated_at: string;
};
type Candidate = { source: DeskItem['source']; source_id: string; title: string; business?: string | null; site_app?: string | null; assignee?: string | null; url?: string | null; detail?: string };
const statuses: Status[] = ['queue', 'testing', 'failed', 'passed'];
const labels: Record<Status, string> = { queue: 'Queue', testing: 'Testing', failed: 'Failed', passed: 'Passed' };
const input = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500';
const button = 'inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50';
const primary = 'inline-flex items-center justify-center rounded-lg bg-indigo-700 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-800 disabled:opacity-50';
const panelTitle = 'text-sm font-semibold text-slate-900';

export default function QADesk() {
  const [items, setItems] = useState<DeskItem[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [view, setView] = useState<'board' | 'report' | 'summary' | 'detailed'>('board');
  const [statusFilter, setStatusFilter] = useState<'all' | Status>('all');
  const [businessFilter, setBusinessFilter] = useState('All');
  const [sourceFilter, setSourceFilter] = useState('All');
  const [assigneeFilter, setAssigneeFilter] = useState('All');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('oldest');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [newCheck, setNewCheck] = useState('');
  const [failNote, setFailNote] = useState('');
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickDraft, setQuickDraft] = useState({ title: '', business: '', site_app: '', assignee: '', url: '', checks: '' });
  const [reportScope, setReportScope] = useState('all');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [desk, qa, taskQa] = await Promise.all([
        axios.get('/pm/api/qa/review-desk'),
        axios.get('/pm/api/qa'),
        axios.get('/pm/api/qa/task-inbox'),
      ]);
      setItems(desk.data.items ?? []);
      const issueCandidates: Candidate[] = (qa.data.issues ?? []).map((x: any) => ({
        source: x.record_type === 'Ad-hoc' ? 'Client report' : 'Site check',
        source_id: 'issue:' + x.id, title: x.title, business: x.business,
        site_app: x.site_app, assignee: x.assignee, url: x.page_url,
        detail: x.status + ' · ' + (x.severity || 'Normal'),
      }));
      const websiteCandidates: Candidate[] = (qa.data.websites ?? []).map((x: any) => ({
        source: 'Site check', source_id: 'website:' + x.id,
        title: 'Website QA - ' + x.name, business: x.business, site_app: x.name,
        url: x.url, detail: x.project_name || x.website_type,
      }));
      const taskCandidates: Candidate[] = (taskQa.data.reviews ?? []).map((x: any) => ({
        source: 'Taskmandu', source_id: 'task:' + x.id,
        title: x.task_title || x.title || 'Task QA review',
        business: x.business || x.project_name, site_app: x.project_name,
        assignee: x.assignee || x.tester_name, url: x.task_url || null,
        detail: (x.qa_status || 'Awaiting QA') + ' · ' + (x.project_name || 'Taskmandu'),
      }));
      const existing = new Set((desk.data.items ?? []).map((x: DeskItem) => x.source_id).filter(Boolean));
      setCandidates([...websiteCandidates, ...issueCandidates, ...taskCandidates].filter(x => !existing.has(x.source_id)));
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Unable to load the Review Desk. Check the QA API and try again.');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const selected = items.find(x => x.id === selectedId) ?? null;
  const businesses = [...new Set(items.map(x => x.business).filter(Boolean) as string[])].sort();
  const assignees = [...new Set(items.map(x => x.assignee).filter(Boolean) as string[])].sort();
  const counts = useMemo(() => statuses.reduce((acc, s) => ({ ...acc, [s]: items.filter(x => x.status === s).length }), { queue: 0, testing: 0, failed: 0, passed: 0 } as Record<Status, number>), [items]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = items.filter(x =>
      (statusFilter === 'all' || x.status === statusFilter) &&
      (businessFilter === 'All' || x.business === businessFilter) &&
      (sourceFilter === 'All' || x.source === sourceFilter) &&
      (assigneeFilter === 'All' || (x.assignee || 'Unassigned') === assigneeFilter) &&
      (!q || [x.title, x.business, x.site_app, x.source, x.assignee, x.url, x.id].filter(Boolean).join(' ').toLowerCase().includes(q))
    );
    return rows.sort((a, b) => sort === 'newest' ? b.created_at.localeCompare(a.created_at) : sort === 'updated' ? b.updated_at.localeCompare(a.updated_at) : sort === 'status' ? statuses.indexOf(a.status) - statuses.indexOf(b.status) : a.created_at.localeCompare(b.created_at));
  }, [items, statusFilter, businessFilter, sourceFilter, assigneeFilter, query, sort]);

  async function addCandidate(candidate: Candidate) {
    setSaving(true); setError('');
    try {
      const { data } = await axios.post('/pm/api/qa/review-desk', candidate);
      await load(); setSelectedId(data.item.id); setView('board');
    } catch (e: any) { setError(e?.response?.data?.message || 'Could not add this item to the QA queue.'); }
    finally { setSaving(false); }
  }

  async function saveItem(patch: Partial<DeskItem>) {
    if (!selected) return;
    setSaving(true); setError('');
    try {
      const { data } = await axios.patch('/pm/api/qa/review-desk/' + selected.id, patch);
      setItems(current => current.map(x => x.id === selected.id ? data.item : x));
    } catch (e: any) { setError(e?.response?.data?.message || 'Could not save this review.'); }
    finally { setSaving(false); }
  }

  async function createQuick() {
    if (!quickDraft.title.trim()) { setError('Enter what needs checking.'); return; }
    setSaving(true); setError('');
    try {
      const checks = quickDraft.checks.split('\n').map(text => text.trim()).filter(Boolean).slice(0, 40).map(text => ({ id: crypto.randomUUID(), text, done: false }));
      const { data } = await axios.post('/pm/api/qa/review-desk', { ...quickDraft, source: 'Client report', checks });
      setQuickDraft({ title: '', business: '', site_app: '', assignee: '', url: '', checks: '' });
      setQuickOpen(false); await load(); setSelectedId(data.item.id);
    } catch (e: any) { setError(e?.response?.data?.message || 'Could not create the QA item.'); }
    finally { setSaving(false); }
  }

  async function uploadScreenshots(files: FileList | null) {
    if (!selected || !files?.length) return;
    setSaving(true); setError('');
    try {
      for (const file of Array.from(files)) {
        const form = new FormData(); form.append('file', file);
        await axios.post('/pm/api/qa/review-desk/' + selected.id + '/screenshots', form, { headers: { 'Content-Type': 'multipart/form-data' } });
      }
      await load();
    } catch (e: any) { setError(e?.response?.data?.message || 'Could not upload screenshot.'); }
    finally { setSaving(false); }
  }

  async function removeScreenshot(id: string) {
    if (!selected) return;
    setSaving(true);
    try { const { data } = await axios.delete('/pm/api/qa/review-desk/' + selected.id + '/screenshots/' + id); setItems(current => current.map(x => x.id === selected.id ? data.item : x)); }
    catch { setError('Could not remove screenshot.'); }
    finally { setSaving(false); }
  }

  async function transition(status: Status) {
    if (!selected) return;
    if (status === 'passed' && (!selected.checks.length || selected.checks.some(x => !x.done))) {
      setError(!selected.checks.length ? 'Add at least one check before passing.' : 'Complete every checklist item before passing.'); return;
    }
    if (status === 'failed' && !failNote.trim()) { setError('Add a failure note so the developer knows what to fix.'); return; }
    if (selected.source === 'Taskmandu' && (status === 'passed' || status === 'failed')) {
      const reviewId = selected.source_id?.startsWith('task:') ? selected.source_id.slice(5) : '';
      if (reviewId) {
        try {
          await axios.patch('/pm/api/qa/task-inbox/' + reviewId, {
            result: status === 'passed' ? 'Pass' : 'Fail',
            severity: status === 'failed' ? 'Medium' : undefined,
            notes: status === 'failed' ? failNote.trim() : 'QA passed in the Review Desk.',
            evidence_url: selected.screenshots[0]?.url || null,
          });
        } catch (e: any) {
          setError(e?.response?.data?.message || 'The Taskmandu QA result could not be saved. The Review Desk status was not changed.');
          return;
        }
      }
    }
    await saveItem({ status, fail_note: status === 'failed' ? failNote.trim() : selected.fail_note });
    setFailNote('');
  }

  const reportRows = filtered.filter(x => reportScope === 'all' || (reportScope === 'open' ? x.status !== 'passed' : x.status === 'failed'));
  const reportText = [
    'QA Review Desk · ' + new Date().toLocaleDateString('en-AU'),
    reportRows.length + ' items · Queue ' + reportRows.filter(x => x.status === 'queue').length + ' · Testing ' + reportRows.filter(x => x.status === 'testing').length + ' · Failed ' + reportRows.filter(x => x.status === 'failed').length + ' · Passed ' + reportRows.filter(x => x.status === 'passed').length,
    ...reportRows.map(x => '[' + labels[x.status].toUpperCase() + '] ' + x.title + ' · ' + (x.business || 'Unassigned business') + ' · ' + x.source + (x.fail_note ? '\nProblem: ' + x.fail_note : '') + '\n' + x.checks.map(c => '[' + (c.done ? 'x' : ' ') + '] ' + c.text).join('\n')),
  ].join('\n\n');

  if (loading) return <div className="rounded-xl border bg-white p-6 text-sm text-slate-500">Loading QA Review Desk…</div>;

  return <div className="space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-lg font-semibold text-slate-900">QA Review Desk</h2><p className="text-sm text-slate-500">Review website checks, Taskmandu work and quick QA requests in one place.</p></div>
      <div className="flex flex-wrap gap-2"><button className={button} onClick={() => setQuickOpen(v => !v)}>＋ Quick QA</button><button className={button} onClick={() => void load()}>Refresh</button></div>
    </div>
    {error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
      {statuses.map(s => <button key={s} onClick={() => setStatusFilter(statusFilter === s ? 'all' : s)} className={'rounded-xl border bg-white p-3 text-left ' + (statusFilter === s ? 'border-indigo-500 ring-1 ring-indigo-500' : 'border-slate-200')}><div className="text-xs text-slate-500">{s === 'queue' ? 'In queue' : labels[s]}</div><div className="mt-1 text-2xl font-semibold tabular-nums">{counts[s]}</div></button>)}
    </div>
    {quickOpen && <section className="rounded-xl border bg-white p-4">
      <div className="mb-3 flex items-center justify-between"><h3 className={panelTitle}>Add Quick QA item</h3><button className="text-sm text-slate-500" onClick={() => setQuickOpen(false)}>Close</button></div>
      <div className="grid gap-2 md:grid-cols-2">
        <input className={input} placeholder="What needs checking *" value={quickDraft.title} onChange={e => setQuickDraft(v => ({ ...v, title: e.target.value }))}/>
        <input className={input} placeholder="Business" value={quickDraft.business} onChange={e => setQuickDraft(v => ({ ...v, business: e.target.value }))}/>
        <input className={input} placeholder="Website / app" value={quickDraft.site_app} onChange={e => setQuickDraft(v => ({ ...v, site_app: e.target.value }))}/>
        <input className={input} placeholder="Assignee" value={quickDraft.assignee} onChange={e => setQuickDraft(v => ({ ...v, assignee: e.target.value }))}/>
        <input className={input + ' md:col-span-2'} placeholder="Page URL (optional)" value={quickDraft.url} onChange={e => setQuickDraft(v => ({ ...v, url: e.target.value }))}/>
        <textarea className={input + ' md:col-span-2'} rows={3} placeholder="Checklist — one check per line" value={quickDraft.checks} onChange={e => setQuickDraft(v => ({ ...v, checks: e.target.value }))}/>
      </div>
      <div className="mt-3 flex gap-2"><button className={primary} disabled={saving} onClick={() => void createQuick()}>{saving ? 'Saving…' : 'Add to queue'}</button><button className={button} onClick={() => setQuickOpen(false)}>Cancel</button></div>
    </section>}
    <section className="rounded-xl border bg-white p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          {(['board', 'report', 'summary', 'detailed'] as const).map(v => <button key={v} onClick={() => setView(v)} className={'rounded-lg px-3 py-2 text-sm font-medium capitalize ' + (view === v ? 'bg-slate-900 text-white' : 'border text-slate-600')}>{v === 'board' ? 'Review queue' : v}</button>)}
        </div>
        {view === 'board' && <span className="text-xs text-slate-500">{filtered.length} item(s)</span>}
      </div>
      <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <input className={input + ' lg:col-span-2'} placeholder="Search title, business, site or code" value={query} onChange={e => setQuery(e.target.value)}/>
        <select className={input} value={businessFilter} onChange={e => setBusinessFilter(e.target.value)}><option>All</option>{businesses.map(b => <option key={b}>{b}</option>)}</select>
        <select className={input} value={sourceFilter} onChange={e => setSourceFilter(e.target.value)}><option>All</option>{['Taskmandu', 'Site check', 'Client report'].map(s => <option key={s}>{s}</option>)}</select>
        <select className={input} value={assigneeFilter} onChange={e => setAssigneeFilter(e.target.value)}><option>All</option>{assignees.map(a => <option key={a}>{a}</option>)}<option>Unassigned</option></select>
      </div>
      {candidates.length > 0 && <details className="mb-3 rounded-lg border border-dashed p-3"><summary className="cursor-pointer text-sm font-medium text-slate-700">Add existing QA work to this queue ({candidates.length} available)</summary><div className="mt-3 grid gap-2 md:grid-cols-2">{candidates.slice(0, 30).map(c => <div key={c.source_id} className="flex min-w-0 items-center justify-between gap-2 rounded-lg border p-2"><div className="min-w-0"><div className="truncate text-sm font-medium">{c.title}</div><div className="truncate text-xs text-slate-500">{c.business || c.source} · {c.detail || c.site_app || ''}</div></div><button className={button} disabled={saving} onClick={() => void addCandidate(c)}>Add</button></div>)}</div></details>}
      {view === 'board' && <div className="grid gap-3 lg:grid-cols-[minmax(260px,.85fr)_minmax(0,1.15fr)]">
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-500"><span>{filtered.length} in view</span><select className="rounded-lg border px-2 py-1" value={sort} onChange={e => setSort(e.target.value)}><option value="oldest">Oldest first</option><option value="newest">Newest first</option><option value="updated">Recently updated</option><option value="status">Needs attention first</option></select></div>
          {filtered.map(item => <button key={item.id} onClick={() => { setSelectedId(item.id); setFailNote(item.fail_note || ''); }} className={'w-full rounded-lg border p-3 text-left ' + (selectedId === item.id ? 'border-indigo-500 ring-1 ring-indigo-500' : 'border-slate-200 hover:border-slate-400')}><div className="flex flex-wrap items-center gap-2"><span className={'rounded-full px-2 py-1 text-[11px] font-semibold ' + (item.status === 'failed' ? 'bg-rose-100 text-rose-700' : item.status === 'passed' ? 'bg-emerald-100 text-emerald-700' : item.status === 'testing' ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-700')}>{labels[item.status]}</span><span className="ml-auto text-[11px] text-slate-400">{item.source}</span></div><div className="mt-2 text-sm font-semibold text-slate-900">{item.title}</div><div className="mt-1 text-xs text-slate-500">{item.business || 'Business not set'} · {item.site_app || 'No site'} · {item.assignee || 'Unassigned'}</div><div className="mt-2 flex gap-3 text-xs text-slate-500"><span>{item.checks.filter(c => c.done).length}/{item.checks.length} checks</span><span>{item.screenshots.length} screenshots</span></div></button>)}
          {!filtered.length && <div className="rounded-lg border border-dashed p-6 text-center text-sm text-slate-500">No QA items match these filters. Add Quick QA or add existing work above.</div>}
        </div>
        <div className="min-h-[360px] rounded-xl border bg-slate-50 p-4">
          {selected ? <>
            <div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-slate-200 px-2 py-1 text-xs font-semibold uppercase text-slate-700">{selected.source}</span><span className="rounded-full bg-white px-2 py-1 text-xs">{labels[selected.status]}</span><span className="flex-1"/><button className={button} disabled={saving} onClick={() => void saveItem({ status: 'queue', checks: selected.checks.map(c => ({ ...c, done: false })) })}>Reset for retest</button></div>
            <h3 className="mt-3 text-lg font-semibold text-slate-900">{selected.title}</h3><p className="mt-1 text-sm text-slate-500">{[selected.business, selected.site_app, selected.assignee].filter(Boolean).join(' · ') || 'No additional details'}</p>
            {selected.url && <a className="mt-2 inline-block break-all text-sm text-indigo-700 underline" href={selected.url} target="_blank" rel="noreferrer">{selected.url}</a>}
            <div className="mt-5 flex items-center justify-between"><h4 className={panelTitle}>Checklist <span className="font-normal text-slate-500">({selected.checks.filter(c => c.done).length}/{selected.checks.length})</span></h4></div>
            <div className="mt-2 space-y-1">{selected.checks.map(check => <label key={check.id} className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm"><input type="checkbox" checked={check.done} onChange={e => void saveItem({ checks: selected.checks.map(c => c.id === check.id ? { ...c, done: e.target.checked } : c) })}/><span className={check.done ? 'text-slate-400 line-through' : 'text-slate-800'}>{check.text}</span></label>)}{!selected.checks.length && <p className="text-sm text-slate-500">No checks yet. Add the items you want to verify.</p>}</div>
            <div className="mt-2 flex gap-2"><input className={input} placeholder="Add a check…" value={newCheck} onChange={e => setNewCheck(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && newCheck.trim()) { void saveItem({ checks: [...selected.checks, { id: crypto.randomUUID(), text: newCheck.trim(), done: false }] }); setNewCheck(''); } }}/><button className={button} onClick={() => { if (newCheck.trim()) { void saveItem({ checks: [...selected.checks, { id: crypto.randomUUID(), text: newCheck.trim(), done: false }] }); setNewCheck(''); } }}>Add</button></div>
            <div className="mt-5"><h4 className={panelTitle}>Screenshots <span className="font-normal text-slate-500">({selected.screenshots.length})</span></h4><div className="mt-2 flex flex-wrap gap-2">{selected.screenshots.map(s => <div key={s.id} className="group relative"><a href={s.url} target="_blank" rel="noreferrer"><img src={s.url} alt={s.name} className="h-16 w-20 rounded-lg border object-cover"/></a><button title="Remove screenshot" onClick={() => void removeScreenshot(s.id)} className="absolute -right-2 -top-2 rounded-full bg-rose-600 px-1.5 text-xs text-white">×</button></div>)}<label className="flex h-16 w-20 cursor-pointer items-center justify-center rounded-lg border border-dashed bg-white text-2xl text-slate-400">＋<input type="file" accept="image/*" multiple className="hidden" onChange={e => { void uploadScreenshots(e.target.files); e.currentTarget.value = ''; }}/></label></div></div>
            {selected.status === 'failed' && <div className="mt-5 rounded-lg border border-rose-200 bg-rose-50 p-3"><h4 className="text-sm font-semibold text-rose-800">Sent back to developer</h4><p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{selected.fail_note || 'No failure note.'}</p></div>}
            {selected.status !== 'failed' && <div className="mt-5"><h4 className={panelTitle}>Failure note / testing notes</h4><textarea className={input + ' mt-2'} rows={3} value={failNote} onChange={e => setFailNote(e.target.value)} placeholder="If this fails, explain what is wrong and how to reproduce it."/></div>}
            <div className="mt-4 flex flex-wrap gap-2">
              {selected.status === 'queue' && <button className={button} onClick={() => void transition('testing')}>Start testing</button>}
              {selected.status === 'testing' && <button className={button} onClick={() => void transition('queue')}>Back to queue</button>}
              {(selected.status === 'queue' || selected.status === 'testing') && <><button className="rounded-lg border border-rose-300 px-3 py-2 text-sm font-semibold text-rose-700" onClick={() => void transition('failed')}>Fail and send back</button><button className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white" onClick={() => void transition('passed')}>Pass</button></>}
              {selected.status === 'failed' && <button className={primary} onClick={() => void transition('queue')}>Re-queue for retest</button>}
              {selected.status === 'passed' && <button className={button} onClick={() => void transition('testing')}>Reopen</button>}
            </div>
            <details className="mt-5 border-t pt-3"><summary className="cursor-pointer text-sm font-semibold">History ({selected.history.length})</summary><ol className="mt-2 space-y-2">{[...selected.history].reverse().map((h, i) => <li key={i} className="flex gap-3 text-xs"><time className="w-32 shrink-0 text-slate-500">{new Date(h.at).toLocaleString('en-AU')}</time><span>{h.message}</span></li>)}</ol></details>
          </> : <div className="grid min-h-[320px] place-items-center text-center text-sm text-slate-500">Select an item from the queue to review its checks and evidence.</div>}
        </div>
      </div>}
      {view === 'summary' && <div className="overflow-x-auto"><table className="w-full min-w-[600px] text-left text-sm"><thead className="bg-slate-100 text-xs text-slate-500"><tr>{['Business / site','Queue','Testing','Failed','Passed','Total'].map(x => <th key={x} className="p-3">{x}</th>)}</tr></thead><tbody>{businesses.map(b => { const rows = filtered.filter(x => x.business === b); return <tr key={b} className="border-t"><td className="p-3 font-medium">{b}</td>{statuses.map(s => <td key={s} className="p-3 tabular-nums">{rows.filter(x => x.status === s).length}</td>)}<td className="p-3">{rows.length}</td></tr>; })}</tbody></table></div>}
      {view === 'detailed' && <div className="space-y-3">{filtered.map(x => <article key={x.id} className="rounded-lg border p-4"><div className="flex flex-wrap items-center gap-2"><span className="text-xs text-slate-500">{x.source}</span><span className="rounded-full bg-slate-100 px-2 py-1 text-xs">{labels[x.status]}</span></div><h3 className="mt-2 font-semibold">{x.title}</h3><p className="text-xs text-slate-500">{x.business} · {x.site_app} · {x.assignee || 'Unassigned'}</p><p className="mt-2 text-sm">{x.checks.filter(c => c.done).length}/{x.checks.length} checks complete · {x.screenshots.length} screenshots</p>{x.fail_note && <p className="mt-2 whitespace-pre-wrap rounded-lg bg-rose-50 p-2 text-sm">{x.fail_note}</p>}</article>)}</div>}
      {view === 'report' && <div><div className="mb-3 flex flex-wrap items-center gap-2"><select className={input + ' max-w-xs'} value={reportScope} onChange={e => setReportScope(e.target.value)}><option value="all">All items</option><option value="open">Open items (not passed)</option><option value="failed">Failed only</option></select><button className={button} onClick={() => void navigator.clipboard.writeText(reportText)}>Copy report</button></div><pre className="whitespace-pre-wrap break-words rounded-lg border bg-slate-50 p-4 text-xs">{reportText}</pre></div>}
    </section>
  </div>;
}
