import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { button, dateTime, errorMessage, heading, input, itemUrl, primary, stageClass, type QAItem, type Site, type Stage } from './types';

const STANDARD_CHECKS = ['Works on desktop', 'Works on mobile'];

const MOVES: Record<Stage, { to: Stage; label: string; tone: 'primary' | 'danger' | 'plain' }[]> = {
  Queue: [{ to: 'Testing', label: 'Start testing', tone: 'plain' }, { to: 'Failed', label: 'Fail and send back', tone: 'danger' }, { to: 'Passed', label: 'Pass', tone: 'primary' }],
  Testing: [{ to: 'Failed', label: 'Fail and send back', tone: 'danger' }, { to: 'Passed', label: 'Pass', tone: 'primary' }, { to: 'Queue', label: 'Back to queue', tone: 'plain' }],
  Failed: [{ to: 'Queue', label: 'Re-queue for retest', tone: 'primary' }],
  Passed: [{ to: 'Queue', label: 'Re-open', tone: 'plain' }],
};

export default function ReviewPanel({ item, businesses, sites, onChange, onDeleted, onClose }: {
  item: QAItem; businesses: string[]; sites: Site[]; onChange: (item: QAItem) => void; onDeleted: (key: string) => void; onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [remarks, setRemarks] = useState(item.remarks ?? '');
  const [note, setNote] = useState(item.fail_note ?? '');
  const [newCheck, setNewCheck] = useState('');
  const [editing, setEditing] = useState(false);
  const [edit, setEdit] = useState({ title: item.title, business: item.business ?? '', site: item.site ?? '', url: item.url ?? '', assignee: item.assignee ?? '' });
  const [showHistory, setShowHistory] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const base = itemUrl(item);

  // A different item (or a server refresh of this one) resets the local drafts.
  useEffect(() => {
    setRemarks(item.remarks ?? ''); setNote(item.fail_note ?? ''); setError('');
    setEdit({ title: item.title, business: item.business ?? '', site: item.site ?? '', url: item.url ?? '', assignee: item.assignee ?? '' });
  }, [item.key, item.updated_at]);
  useEffect(() => { setEditing(false); setNewCheck(''); setShowHistory(false); }, [item.key]);

  async function run(fn: () => Promise<{ data: { item: QAItem } } | void>, fallback: string) {
    setBusy(true); setError('');
    try { const res = await fn(); if (res) onChange(res.data.item); }
    catch (e) { setError(errorMessage(e, fallback)); }
    finally { setBusy(false); }
  }

  const patch = (body: Record<string, unknown>, fallback = 'Could not save.') => run(() => axios.patch(base, body), fallback);
  const move = (to: Stage) => patch({ stage: to, fail_note: note, remarks }, 'Could not move this item.');
  const toggle = (id: number, is_done: boolean) => run(() => axios.patch(`${base}/checks/${id}`, { is_done }), 'Could not update the check.');
  const removeCheck = (id: number) => run(() => axios.delete(`${base}/checks/${id}`), 'Could not remove the check.');
  const addChecks = (labels: string[]) => run(() => axios.post(`${base}/checks`, { labels }), 'Could not add the check.');

  async function submitCheck() {
    const label = newCheck.trim();
    if (!label) return;
    setNewCheck('');
    await addChecks([label]);
  }

  function upload(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    void run(() => axios.post(`${base}/screenshots`, form), 'Could not upload the screenshot (images up to 5MB).');
    if (fileRef.current) fileRef.current.value = '';
  }

  async function destroy() {
    if (!window.confirm(`Delete ${item.code ?? 'this item'}? The code is not reused.`)) return;
    setBusy(true);
    try { await axios.delete(base); onDeleted(item.key); }
    catch (e) { setError(errorMessage(e, 'Could not delete.')); setBusy(false); }
  }

  const saveText = () => {
    if ((remarks || '') === (item.remarks ?? '') && (note || '') === (item.fail_note ?? '')) return;
    void patch({ remarks, fail_note: note });
  };

  const done = item.checks.filter(c => c.is_done).length;
  const noteLabel = item.stage === 'Failed' || item.stage === 'Testing' || item.stage === 'Queue' ? 'Failure note (required to fail)' : 'Note';

  return <section className="rounded-xl border bg-white p-4">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm font-semibold text-slate-700">{item.code ?? '—'}</span>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${stageClass[item.stage]}`}>{item.stage}</span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{item.source}</span>
        </div>
        <h3 className="mt-1 break-words text-base font-semibold text-slate-900">{item.title}</h3>
        <p className="text-xs text-slate-500">{[item.business, item.site, item.assignee].filter(Boolean).join(' · ') || 'No business or site'}</p>
      </div>
      <button className="shrink-0 rounded-lg border px-2.5 py-1.5 text-sm text-slate-600 md:hidden" onClick={onClose}>Back</button>
    </div>

    {item.url
      ? <a href={item.url} target="_blank" rel="noreferrer" className="mt-2 block break-all text-sm text-indigo-700 hover:underline">{item.url}</a>
      : <p className="mt-2 text-sm text-amber-700">No page URL yet. Add one so the developer can open it.</p>}

    {!editing && <button className={button + ' mt-3'} onClick={() => setEditing(true)}>Edit</button>}
    {editing && <div className="mt-3 space-y-3 rounded-lg border bg-slate-50 p-3">
      <label className="block"><span className="mb-1 block text-xs font-medium text-slate-600">Title</span><input className={input} value={edit.title} onChange={e => setEdit({ ...edit, title: e.target.value })}/></label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block"><span className="mb-1 block text-xs font-medium text-slate-600">Business</span><input className={input} list="qa-edit-biz" value={edit.business} onChange={e => setEdit({ ...edit, business: e.target.value })}/><datalist id="qa-edit-biz">{businesses.map(b => <option key={b} value={b}/>)}</datalist></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-slate-600">Website / app</span><input className={input} list="qa-edit-site" value={edit.site} onChange={e => setEdit({ ...edit, site: e.target.value })}/><datalist id="qa-edit-site">{sites.filter(x => !edit.business || x.business === edit.business).map(x => <option key={x.id} value={x.name}/>)}</datalist></label>
      </div>
      <label className="block"><span className="mb-1 block text-xs font-medium text-slate-600">Page URL</span><input className={input} value={edit.url} onChange={e => setEdit({ ...edit, url: e.target.value })}/></label>
      <label className="block"><span className="mb-1 block text-xs font-medium text-slate-600">Assignee</span><input className={input} value={edit.assignee} onChange={e => setEdit({ ...edit, assignee: e.target.value })}/></label>
      {item.kind === 'task' && <p className="text-xs text-slate-500">Edits apply here only. Clear a field to go back to the Taskmandu value. The QA code stays the same.</p>}
      <div className="flex gap-2"><button className={primary} disabled={busy} onClick={async () => { setBusy(true); setError(''); try { const res = await axios.patch(base, edit); onChange(res.data.item); setEditing(false); } catch (e) { setError(errorMessage(e, 'Could not save.')); } finally { setBusy(false); } }}>Save</button><button className={button} onClick={() => setEditing(false)}>Cancel</button></div>
    </div>}

    {item.details.length > 0 && <dl className="mt-3 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
      {item.details.map(d => <div key={d.label} className="min-w-0"><dt className="inline text-slate-500">{d.label}: </dt><dd className="inline break-words text-slate-800">{d.value}</dd></div>)}
    </dl>}

    {item.stage === 'Failed' && item.fail_note && <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"><div className="text-xs font-semibold uppercase tracking-wide">Failed</div><p className="mt-1 whitespace-pre-wrap break-words">{item.fail_note}</p></div>}

    <div className="mt-4">
      <div className="flex items-center justify-between"><h4 className={heading}>Checklist</h4><span className="text-xs text-slate-500">{done}/{item.checks.length} checked</span></div>
      <p className="text-xs text-slate-500">Ticking a check starts testing. Pass needs every check ticked.</p>
      {item.checks.length === 0 && <div className="mt-2 rounded-lg border border-dashed p-3 text-sm text-slate-600">No checks yet. <button className="font-medium text-indigo-700 hover:underline" disabled={busy} onClick={() => void addChecks(STANDARD_CHECKS)}>Add standard checks</button></div>}
      <ul className="mt-2 space-y-1">
        {item.checks.map(c => <li key={c.id} className="flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-slate-50">
          <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-sm text-slate-800"><input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={c.is_done} disabled={busy} onChange={e => void toggle(c.id, e.target.checked)}/><span className={`break-words ${c.is_done ? 'text-slate-500 line-through' : ''}`}>{c.label}</span></label>
          <button className="px-1 text-xs text-slate-400 hover:text-rose-700" aria-label={`Remove ${c.label}`} disabled={busy} onClick={() => void removeCheck(c.id)}>✕</button>
        </li>)}
      </ul>
      <div className="mt-2 flex gap-2"><input className={input} placeholder="Add check" value={newCheck} onChange={e => setNewCheck(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void submitCheck(); }}/><button className={button} disabled={busy || !newCheck.trim()} onClick={() => void submitCheck()}>Add</button></div>
    </div>

    <div className="mt-4">
      <div className="flex items-center justify-between"><h4 className={heading}>Screenshots</h4><button className={button} disabled={busy} onClick={() => fileRef.current?.click()}>Upload</button></div>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => upload(e.target.files)}/>
      {item.screenshots.length === 0
        ? <p className="mt-1 text-xs text-slate-500">No screenshots yet.</p>
        : <div className="mt-2 grid grid-cols-3 gap-2">{item.screenshots.map(s => <div key={s.id} className="group relative">
            <a href={s.url} target="_blank" rel="noreferrer"><img src={s.url} alt={s.name} className="h-20 w-full rounded-lg border object-cover"/></a>
            <button className="absolute right-1 top-1 rounded bg-white/90 px-1.5 text-xs text-rose-700 shadow" aria-label="Remove screenshot" disabled={busy} onClick={() => void run(() => axios.delete(`${base}/screenshots/${s.id}`), 'Could not remove the screenshot.')}>✕</button>
          </div>)}</div>}
    </div>

    <div className="mt-4 grid gap-3">
      <label className="block"><span className={heading}>Remarks</span><textarea className={input + ' mt-1'} rows={2} value={remarks} onChange={e => setRemarks(e.target.value)} onBlur={saveText} placeholder="Anything the next person should know"/></label>
      <label className="block"><span className={heading}>{noteLabel}</span><textarea className={input + ' mt-1'} rows={3} value={note} onChange={e => setNote(e.target.value)} onBlur={saveText} placeholder="What failed, and how to reproduce it"/></label>
    </div>

    {error && <p role="alert" className="mt-3 rounded-lg bg-rose-50 p-2 text-sm text-rose-700">{error}</p>}

    <div className="mt-4 flex flex-wrap gap-2">
      {MOVES[item.stage].map(m => <button key={m.to + m.label} disabled={busy}
        className={m.tone === 'primary' ? primary : m.tone === 'danger' ? button + ' border-rose-300 text-rose-700 hover:bg-rose-50' : button}
        onClick={() => void move(m.to)}>{m.label}</button>)}
    </div>

    <div className="mt-4 border-t pt-3">
      <button className="text-sm font-medium text-slate-600" onClick={() => setShowHistory(v => !v)}>{showHistory ? 'Hide' : 'Show'} history ({item.history.length})</button>
      {showHistory && <ul className="mt-2 space-y-1 text-xs text-slate-600">{[...item.history].reverse().map((h, i) => <li key={i}><span className="text-slate-400">{dateTime(h.at)}</span> · {h.message}{h.by ? ` · ${h.by}` : ''}</li>)}</ul>}
      {item.kind === 'issue' && <div className="mt-3"><button className="text-xs text-rose-700 hover:underline" disabled={busy} onClick={() => void destroy()}>Delete this item</button></div>}
    </div>
  </section>;
}
