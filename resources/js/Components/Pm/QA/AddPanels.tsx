import { useState } from 'react';
import axios from 'axios';
import { button, errorMessage, input, heading, primary, type Project, type QAItem, type Site } from './types';

const SITE_TYPES = ['Business website', 'E-commerce', 'Event platform', 'Dashboard', 'Web application', 'Other'];
const FREQUENCIES = ['Daily', 'Weekly', 'Manual'];

/** Register a website or app. Linking its Taskmandu project is what files that project's tasks under this site. */
export function SitePanel({ businesses, projects, sites, onSaved, onClose }: {
  businesses: string[]; projects: Project[]; sites: Site[]; onSaved: () => Promise<void>; onClose: () => void;
}) {
  const [draft, setDraft] = useState({ business: '', name: '', url: '', website_type: 'Business website', frequency: 'Manual', project_id: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (patch: Partial<typeof draft>) => { setDraft(d => ({ ...d, ...patch })); setError(''); };

  async function save() {
    const url = /^https?:\/\//i.test(draft.url.trim()) ? draft.url.trim() : 'https://' + draft.url.trim();
    if (!draft.business || !draft.name.trim() || draft.url.trim() === '') { setError('Choose a business and enter a name and address.'); return; }
    setSaving(true);
    try {
      const project = projects.find(p => p.id === draft.project_id);
      await axios.post('/pm/api/qa/websites', {
        business: draft.business, name: draft.name.trim(), url,
        website_type: draft.website_type, frequency: draft.frequency,
        project_id: project?.id ?? null, project_name: project?.name ?? null,
      });
      setDraft({ business: '', name: '', url: '', website_type: 'Business website', frequency: 'Manual', project_id: '' });
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
    <div className="mb-3 flex items-center justify-between"><h3 className={heading}>Add a website or app</h3><button className="text-sm text-slate-500" onClick={onClose}>Close</button></div>
    <div className="grid gap-2 md:grid-cols-2">
      <select className={input} aria-label="Business" value={draft.business} onChange={e => set({ business: e.target.value })}><option value="">Choose business</option>{businesses.map(b => <option key={b}>{b}</option>)}</select>
      <input className={input} placeholder="Name, e.g. Maison Éclat" value={draft.name} onChange={e => set({ name: e.target.value })}/>
      <input className={input + ' md:col-span-2'} placeholder="Address, e.g. maisoneclat.com" value={draft.url} onChange={e => set({ url: e.target.value })}/>
      <select className={input} aria-label="Type" value={draft.website_type} onChange={e => set({ website_type: e.target.value })}>{SITE_TYPES.map(v => <option key={v}>{v}</option>)}</select>
      <select className={input} aria-label="How often" value={draft.frequency} onChange={e => set({ frequency: e.target.value })}>{FREQUENCIES.map(v => <option key={v}>{v}</option>)}</select>
      <select className={input + ' md:col-span-2'} aria-label="Taskmandu project" value={draft.project_id} onChange={e => set({ project_id: e.target.value })}><option value="">Taskmandu project (optional): files that project's tasks under this site</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
    </div>
    {error && <p role="alert" className="mt-2 text-sm text-rose-700">{error}</p>}
    <div className="mt-3 flex gap-2"><button className={primary} disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Add site or app'}</button><button className={button} onClick={onClose}>Cancel</button></div>
    {sites.length > 0 && <div className="mt-4 border-t pt-3">
      <h4 className={heading}>Registered ({sites.length})</h4>
      <ul className="mt-2 divide-y text-sm">{sites.map(s => <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><div className="min-w-0"><div className="font-medium text-slate-800">{s.name} <span className="font-normal text-slate-500">· {s.business}</span></div><a className="break-all text-xs text-indigo-700" href={s.url} target="_blank" rel="noreferrer">{s.url}</a>{s.project_name && <div className="text-xs text-slate-500">Taskmandu: {s.project_name}</div>}</div><button className="text-xs text-rose-700 hover:underline" onClick={() => void remove(s)}>Remove</button></li>)}</ul>
    </div>}
  </section>;
}

/** Add a site check (registered site) or a client report (any site). Taskmandu tasks arrive on their own. */
export function ItemPanel({ businesses, sites, onCreated, onClose }: {
  businesses: string[]; sites: Site[]; onCreated: (item: QAItem) => void; onClose: () => void;
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
    <div className="mb-3 flex items-center justify-between"><h3 className={heading}>Add a QA item</h3><button className="text-sm text-slate-500" onClick={onClose}>Close</button></div>
    <div className="grid gap-2 md:grid-cols-2">
      <input className={input + ' md:col-span-2'} placeholder="What needs checking? *" value={draft.title} onChange={e => set({ title: e.target.value })}/>
      <select className={input} aria-label="Business" value={draft.business} onChange={e => set({ business: e.target.value, site: '' })}><option value="">Business</option>{businesses.map(b => <option key={b}>{b}</option>)}</select>
      <input className={input} list="qa-site-options" placeholder="Website or app" value={draft.site} onChange={e => set({ site: e.target.value })}/>
      <datalist id="qa-site-options">{siteOptions.map(s => <option key={s.id} value={s.name}/>)}</datalist>
      <input className={input + ' md:col-span-2'} placeholder="Page URL so the developer can open it (blank = the site's address)" value={draft.url} onChange={e => set({ url: e.target.value })}/>
      <input className={input + ' md:col-span-2'} placeholder="Assignee (optional)" value={draft.assignee} onChange={e => set({ assignee: e.target.value })}/>
      <textarea className={input + ' md:col-span-2'} rows={3} placeholder={'Checklist, one check per line. Blank adds "Works on desktop" and "Works on mobile".'} value={draft.checks} onChange={e => set({ checks: e.target.value })}/>
    </div>
    <p className="mt-2 text-xs text-slate-500">Pick a registered site and this is a site check. Any other site is saved as a client report. Taskmandu tasks join the queue by themselves when they reach Completed or Review.</p>
    {error && <p role="alert" className="mt-2 text-sm text-rose-700">{error}</p>}
    <div className="mt-3 flex gap-2"><button className={primary} disabled={saving} onClick={() => void save()}>{saving ? 'Adding…' : 'Add to queue'}</button><button className={button} onClick={onClose}>Cancel</button></div>
  </section>;
}
