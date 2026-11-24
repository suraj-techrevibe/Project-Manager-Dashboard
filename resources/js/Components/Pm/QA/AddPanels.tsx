import { useState } from 'react';
import axios from 'axios';
import { button, errorMessage, input, heading, primary, type Project, type QAItem, type Site } from './types';
import { Combo, splitNames } from './Combo';

const SITE_TYPES = ['Business website', 'E-commerce', 'Event platform', 'Dashboard', 'Web application', 'Other'];
const FREQUENCIES = ['Daily', 'Weekly', 'Manual'];

const Field = ({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) =>
  <label className="block"><span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>{children}{hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}</label>;

/** Business picker: Taskmandu projects first, then businesses added here, or a custom name. */
const businessGroups = (businesses: string[], projects: Project[]) =>
  splitNames(businesses, projects.map(p => p.name), 'Taskmandu projects', 'Added here');

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
      <Field label="Business"><Combo id="qa-site-biz" value={draft.business} groups={businessGroups(businesses, projects)} placeholder="Choose a business" customLabel="Other business…" onChange={v => set({ business: v })}/></Field>
      <Field label="Name"><input className={input} placeholder="e.g. Tec.com" value={draft.name} onChange={e => set({ name: e.target.value })}/></Field>
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
export function ItemPanel({ businesses, members, staff, projects, sites, onCreated, onClose }: {
  businesses: string[]; members: string[]; staff: string[]; projects: Project[]; sites: Site[]; onCreated: (item: QAItem) => void; onClose: () => void;
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
        <Field label="Business"><Combo id="qa-item-biz" value={draft.business} groups={businessGroups(businesses, projects)} placeholder="Choose a business" customLabel="Other business…" onChange={v => set({ business: v, site: '' })}/></Field>
        <Field label="Website / app"><Combo key={draft.business} id="qa-item-site" value={draft.site} groups={[{ label: 'Registered sites and apps', options: siteOptions.map(x => x.name) }]} placeholder="Choose a site" customLabel="Another site…" onChange={v => set({ site: v })}/></Field>
      </div>
      <Field label="Page URL" hint="So the developer can open it directly. Blank uses the site's address."><input className={input} placeholder="https://…" value={draft.url} onChange={e => set({ url: e.target.value })}/></Field>
      <Field label="Assignee (optional)"><Combo id="qa-item-assignee" value={draft.assignee} groups={splitNames(members, staff, 'Taskmandu staff', 'Other names')} placeholder="Choose a person" customLabel="Someone else…" onChange={v => set({ assignee: v })}/></Field>
      <Field label="Checklist" hint={'One check per line. Blank adds "Works on desktop" and "Works on mobile".'}><textarea className={input} rows={3} value={draft.checks} onChange={e => set({ checks: e.target.value })}/></Field>
    </div>
    <p className="mt-3 text-xs text-slate-500">A registered site makes this a site check; any other site is saved as a client report. Taskmandu tasks join the queue on their own once they are set to Awaiting review.</p>
    {error && <p role="alert" className="mt-3 text-sm text-rose-700">{error}</p>}
    <div className="mt-4 flex gap-2"><button className={primary} disabled={saving} onClick={() => void save()}>{saving ? 'Adding…' : 'Add to queue'}</button><button className={button} onClick={onClose}>Cancel</button></div>
  </section>;
}

/**
 * Add a Taskmandu project as a business. Pick one that already exists in Taskmandu, or name a new one
 * and it is created in Taskmandu first.
 */
export function ProjectPanel({ projects, onSaved, onClose }: { projects: Project[]; onSaved: () => Promise<void>; onClose: () => void }) {
  const NEW = '__new__';
  const [choice, setChoice] = useState('');
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const creating = choice === NEW || projects.length === 0;

  async function save() {
    if (creating ? !name.trim() : !choice) { setError(creating ? 'Enter a name for the new project.' : 'Choose a Taskmandu project.'); return; }
    setSaving(true); setError(''); setDone('');
    try {
      const { data } = await axios.post('/pm/api/qa-center/projects', creating ? { name: name.trim() } : { project_id: choice });
      setDone(data.project.created ? `Created "${data.project.name}" in Taskmandu and added it as a business.` : `"${data.project.name}" is now a business here.`);
      setChoice(''); setName('');
      await onSaved();
    } catch (e) { setError(errorMessage(e, 'Could not add this project.')); }
    finally { setSaving(false); }
  }

  return <section className="rounded-xl border bg-white p-4">
    <div className="mb-3 flex items-center justify-between"><h3 className={heading}>Add project</h3><button className="text-sm text-slate-500" onClick={onClose}>Close</button></div>
    <p className="mb-3 text-xs text-slate-500">A project is a business here. Choose one from Taskmandu, or add a new name and it is created in Taskmandu too.</p>
    <div className="space-y-3">
      {projects.length > 0 && <Field label="Taskmandu project">
        <select className={input} value={choice} onChange={e => { setChoice(e.target.value); setError(''); setDone(''); }}>
          <option value="">Choose a project</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}{p.business ? ' (already added)' : ''}</option>)}
          <option value={NEW}>New project…</option>
        </select>
      </Field>}
      {creating && <Field label="New project name" hint="Created in Taskmandu. If Taskmandu already has a project with this name, that one is used."><input className={input} placeholder="e.g. Maison Éclat" value={name} onChange={e => { setName(e.target.value); setError(''); setDone(''); }}/></Field>}
    </div>
    {error && <p role="alert" className="mt-3 text-sm text-rose-700">{error}</p>}
    {done && <p role="status" className="mt-3 text-sm text-emerald-700">{done}</p>}
    <div className="mt-4 flex gap-2"><button className={primary} disabled={saving} onClick={() => void save()}>{saving ? 'Adding…' : creating ? 'Create and add' : 'Add project'}</button><button className={button} onClick={onClose}>Close</button></div>
  </section>;
}
