import { useState } from 'react';
import axios from 'axios';
import { button, errorMessage, input, heading, primary, type Project, type QAItem, type Site } from './types';

const SITE_TYPES = ['Business website', 'E-commerce', 'Event platform', 'Dashboard', 'Web application', 'Other'];
const FREQUENCIES = ['Daily', 'Weekly', 'Manual'];

const Field = ({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) =>
  <label className="block"><span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>{children}{hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}</label>;

/** Pick an existing business or type a new one. */
const BusinessInput = ({ id, value, options, onChange }: { id: string; value: string; options: string[]; onChange: (v: string) => void }) =>
  <><input className={input} list={id} placeholder="Choose or type a business" value={value} onChange={e => onChange(e.target.value)}/><datalist id={id}>{options.map(b => <option key={b} value={b}/>)}</datalist></>;

/** Register a website or app. Linking its Taskmandu project is what files that project's tasks under this site. */
export function SitePanel({ businesses, projects, sites, onSaved, onClose }: {
  businesses: string[]; projects: Project[]; sites: Site[]; onSaved: () => Promise<void>; onClose: () => void;
}) {
  const blank = { business: '', name: '', url: '', website_type: 'Business website', frequency: 'Manual', project_id: '' };
  const [draft, setDraft] = useState(blank);
  const [editId, setEditId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (patch: Partial<typeof draft>) => { setDraft(d => ({ ...d, ...patch })); setError(''); };

  async function save() {
    const url = /^https?:\/\//i.test(draft.url.trim()) ? draft.url.trim() : 'https://' + draft.url.trim();
    if (!draft.business.trim() || !draft.name.trim() || draft.url.trim() === '') { setError('Enter a business, a name and an address.'); return; }
    setSaving(true);
    try {
      const project = projects.find(p => p.id === draft.project_id);
      const body = {
        business: draft.business.trim(), name: draft.name.trim(), url,
        website_type: draft.website_type, frequency: draft.frequency,
        project_id: project?.id ?? null, project_name: project?.name ?? null,
      };
      if (editId) await axios.patch('/pm/api/qa/websites/' + editId, body); else await axios.post('/pm/api/qa/websites', body);
      setDraft(blank); setEditId(null);
      await onSaved();
    } catch (e) { setError(errorMessage(e, 'Could not save this site or app.')); }
    finally { setSaving(false); }
  }

  async function remove(site: Site) {
    if (!window.confirm(`Remove ${site.name}? Its QA items stay.`)) return;
    try { await axios.delete('/pm/api/qa/websites/' + site.id); await onSaved(); }
    catch (e) { setError(errorMessage(e, 'Could not remove this site or app.')); }
  }

  return <section className="rounded-xl border bg-white p-4">
    <div className="mb-3 flex items-center justify-between"><h3 className={heading}>{editId ? 'Edit website / app' : 'Add website / app'}</h3><button className="text-sm text-slate-500" onClick={onClose}>Close</button></div>
    <div className="space-y-3">
      <Field label="Business"><BusinessInput id="qa-site-biz" value={draft.business} options={businesses} onChange={v => set({ business: v })}/></Field>
      <Field label="Name"><input className={input} placeholder="e.g. Maison Éclat" value={draft.name} onChange={e => set({ name: e.target.value })}/></Field>
      <Field label="Address"><input className={input} placeholder="e.g. maisoneclat.com" value={draft.url} onChange={e => set({ url: e.target.value })}/></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Type"><select className={input} value={draft.website_type} onChange={e => set({ website_type: e.target.value })}>{SITE_TYPES.map(v => <option key={v}>{v}</option>)}</select></Field>
        <Field label="Check how often"><select className={input} value={draft.frequency} onChange={e => set({ frequency: e.target.value })}>{FREQUENCIES.map(v => <option key={v}>{v}</option>)}</select></Field>
      </div>
      <Field label="Taskmandu project (optional)" hint="Tasks from this project are filed under this site."><select className={input} value={draft.project_id} onChange={e => set({ project_id: e.target.value })}><option value="">None</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
    </div>
    {error && <p role="alert" className="mt-3 text-sm text-rose-700">{error}</p>}
    <div className="mt-4 flex gap-2"><button className={primary} disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : editId ? 'Save changes' : 'Add site or app'}</button><button className={button} onClick={() => { if (editId) { setEditId(null); setDraft(blank); } else onClose(); }}>Cancel</button></div>
    {sites.length > 0 && <div className="mt-5 border-t pt-3">
      <h4 className={heading}>Registered ({sites.length})</h4>
      <ul className="mt-2 divide-y text-sm">{sites.map(s => <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><div className="min-w-0"><div className="font-medium text-slate-800">{s.name} <span className="font-normal text-slate-500">· {s.business}</span></div><a className="break-all text-xs text-indigo-700" href={s.url} target="_blank" rel="noreferrer">{s.url}</a>{s.project_name && <div className="text-xs text-slate-500">Taskmandu: {s.project_name}</div>}</div><div className="flex gap-3"><button className="text-xs text-indigo-700 hover:underline" onClick={() => { setEditId(s.id); setError(''); setDraft({ business: s.business, name: s.name, url: s.url, website_type: s.website_type, frequency: s.frequency, project_id: s.project_id ?? '' }); }}>Edit</button><button className="text-xs text-rose-700 hover:underline" onClick={() => void remove(s)}>Remove</button></div></li>)}</ul>
    </div>}
  </section>;
}

/** Add a site check (registered site) or a client report (any site). Taskmandu tasks arrive on their own. */
export function ItemPanel({ businesses, members, sites, onCreated, onClose }: {
  businesses: string[]; members: string[]; sites: Site[]; onCreated: (item: QAItem) => void; onClose: () => void;
}) {
  const [draft, setDraft] = useState({ title: '', business: '', site: '', url: '', assignee: '', checks: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (patch: Partial<typeof draft>) => { setDraft(d => ({ ...d, ...patch })); setError(''); };
  const siteOptions = sites.filter(s => !draft.business || s.business === draft.business);

  async function save() {
    if (!draft.title.trim()) { setError('Enter what needs checking.'); return; }
    setSaving(true);
    try {
      const { data } = await axios.post('/pm/api/qa-center/items', {
        ...draft, checks: draft.checks.split('\n').map(l => l.trim()).filter(Boolean),
      });
      onCreated(data.item);
    } catch (e) { setError(errorMessage(e, 'Could not add this QA item.')); }
    finally { setSaving(false); }
  }

  return <section className="rounded-xl border bg-white p-4">
    <div className="mb-3 flex items-center justify-between"><h3 className={heading}>Add QA item</h3><button className="text-sm text-slate-500" onClick={onClose}>Close</button></div>
    <div className="space-y-3">
      <Field label="What needs checking?"><input className={input} placeholder="e.g. Fix checkout total rounding" value={draft.title} onChange={e => set({ title: e.target.value })}/></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Business"><BusinessInput id="qa-item-biz" value={draft.business} options={businesses} onChange={v => set({ business: v, site: '' })}/></Field>
        <Field label="Website / app"><input className={input} list="qa-site-options" placeholder="Choose a site" value={draft.site} onChange={e => set({ site: e.target.value })}/><datalist id="qa-site-options">{siteOptions.map(s => <option key={s.id} value={s.name}/>)}</datalist></Field>
      </div>
      <Field label="Page URL" hint="So the developer can open it directly. Blank uses the site's address."><input className={input} placeholder="https://…" value={draft.url} onChange={e => set({ url: e.target.value })}/></Field>
      <Field label="Assignee (optional)"><input className={input} list="qa-members" placeholder="Choose or type a name" value={draft.assignee} onChange={e => set({ assignee: e.target.value })}/><datalist id="qa-members">{members.map(m => <option key={m} value={m}/>)}</datalist></Field>
      <Field label="Checklist" hint={'One check per line. Blank adds "Works on desktop" and "Works on mobile".'}><textarea className={input} rows={3} value={draft.checks} onChange={e => set({ checks: e.target.value })}/></Field>
    </div>
    <p className="mt-3 text-xs text-slate-500">A registered site makes this a site check; any other site is saved as a client report. Taskmandu tasks join the queue on their own.</p>
    {error && <p role="alert" className="mt-3 text-sm text-rose-700">{error}</p>}
    <div className="mt-4 flex gap-2"><button className={primary} disabled={saving} onClick={() => void save()}>{saving ? 'Adding…' : 'Add to queue'}</button><button className={button} onClick={onClose}>Cancel</button></div>
  </section>;
}

/** Add, rename and delete businesses. A rename updates every site, item and report; QA codes keep their old prefix. */
export function BusinessPanel({ businesses, sites, items, onChanged, onClose }: {
  businesses: string[]; sites: Site[]; items: QAItem[]; onChanged: () => Promise<void>; onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [rename, setRename] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  async function run(fn: () => Promise<unknown>, fallback: string) {
    setBusy(true); setError('');
    try { await fn(); await onChanged(); return true; }
    catch (e) { setError(errorMessage(e, fallback)); return false; }
    finally { setBusy(false); }
  }

  async function importProjects() {
    setBusy(true); setError(''); setNote('');
    try {
      const { data } = await axios.post<{ created: number; linked: number; total: number }>('/pm/api/qa-center/businesses/import');
      setNote(data.linked === 0 ? `All ${data.total} Taskmandu projects are already imported.` : `Imported ${data.linked} Taskmandu project(s); ${data.created} new business(es).`);
      await onChanged();
    } catch (e) { setError(errorMessage(e, 'Could not import Taskmandu projects.')); }
    finally { setBusy(false); }
  }

  async function add() {
    if (!name.trim()) { setError('Enter a business name.'); return; }
    if (await run(() => axios.post('/pm/api/qa-center/businesses', { name: name.trim() }), 'Could not add the business.')) setName('');
  }
  async function save(from: string) {
    if (!rename.trim()) { setError('Enter a business name.'); return; }
    if (await run(() => axios.patch('/pm/api/qa-center/businesses', { from, name: rename.trim() }), 'Could not rename the business.')) setEditing(null);
  }
  async function remove(b: string) {
    if (!window.confirm(`Delete ${b}?`)) return;
    await run(() => axios.delete('/pm/api/qa-center/businesses', { data: { name: b } }), 'Could not delete the business.');
  }

  return <section className="rounded-xl border bg-white p-4">
    <div className="mb-3 flex items-center justify-between"><h3 className={heading}>Businesses</h3><button className="text-sm text-slate-500" onClick={onClose}>Close</button></div>
    <Field label="Add business"><div className="flex gap-2"><input className={input} placeholder="e.g. Tec.com" value={name} onChange={e => { setName(e.target.value); setError(''); }} onKeyDown={e => { if (e.key === 'Enter') void add(); }}/><button className={primary} disabled={busy} onClick={() => void add()}>Add</button></div></Field>
    <div className="mt-3 flex flex-wrap items-center gap-2"><button className={button} disabled={busy} onClick={() => void importProjects()}>Import Taskmandu projects</button><span className="text-xs text-slate-500">Each Taskmandu project becomes a business.</span></div>
    {note && <p className="mt-2 text-sm text-emerald-700">{note}</p>}
    {error && <p role="alert" className="mt-2 text-sm text-rose-700">{error}</p>}
    <ul className="mt-4 divide-y text-sm">
      {businesses.length === 0 && <li className="py-3 text-slate-500">No businesses yet.</li>}
      {businesses.map(b => {
        const nSites = sites.filter(x => x.business === b).length;
        const nItems = items.filter(x => x.business === b).length;
        return <li key={b} className="py-2">
          {editing === b
            ? <div className="flex flex-wrap gap-2"><input className={input + ' flex-1'} aria-label="Business name" value={rename} onChange={e => { setRename(e.target.value); setError(''); }} onKeyDown={e => { if (e.key === 'Enter') void save(b); }}/><button className={primary} disabled={busy} onClick={() => void save(b)}>Save</button><button className={button} onClick={() => setEditing(null)}>Cancel</button></div>
            : <div className="flex flex-wrap items-center justify-between gap-2"><div><div className="font-medium text-slate-800">{b}</div><div className="text-xs text-slate-500">{nSites} site{nSites === 1 ? '' : 's'} · {nItems} item{nItems === 1 ? '' : 's'}</div></div>
                <div className="flex gap-2"><button className={button} onClick={() => { setEditing(b); setRename(b); setError(''); }}>Edit</button><button className={button + ' text-rose-700'} disabled={busy} onClick={() => void remove(b)}>Delete</button></div></div>}
        </li>;
      })}
    </ul>
    <p className="mt-3 text-xs text-slate-500">Renaming updates every site, item and report. Existing QA codes keep their prefix. A business that still has sites or items can't be deleted.</p>
  </section>;
}
