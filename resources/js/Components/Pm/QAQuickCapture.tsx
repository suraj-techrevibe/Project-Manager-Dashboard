import { useState } from 'react';
import axios from 'axios';

type DraftFinding = {
  title: string;
  business: string;
  site_app: string;
  project_name: string;
  task_title: string;
  page_url: string;
  description: string;
  expected_behaviour: string;
  developer_notes: string;
  severity: 'Critical'|'High'|'Medium'|'Low';
  finding_type: 'Bug'|'UI/UX'|'Content'|'Performance'|'Functional'|'Enhancement'|'Observation';
  confidence: 'High'|'Medium'|'Low';
  needs_review: boolean;
};
type DraftResponse = { summary: string; findings: DraftFinding[]; questions: string[]; };
const field = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm';
const severityOptions = ['Critical','High','Medium','Low'] as const;

export default function QAQuickCapture({ onSaved }: { onSaved: () => void }) {
  const [notes, setNotes] = useState('');
  const [draft, setDraft] = useState<DraftResponse|null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(0);
  const [expanded, setExpanded] = useState<number|null>(null);

  async function organise() {
    if (!notes.trim()) { setError('Paste your rough notes first.'); return; }
    setLoading(true); setError(''); setDraft(null); setSaved(0);
    try {
      const response = await axios.post('/pm/api/qa/quick-capture/draft', { notes });
      setDraft(response.data.draft as DraftResponse);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? e?.response?.data?.error ?? 'Could not organise these notes. Try again or shorten them.');
    } finally { setLoading(false); }
  }

  function update(index: number, key: keyof DraftFinding, value: string|boolean) {
    setDraft(current => current ? ({...current, findings: current.findings.map((item,i) => i===index ? ({...item,[key]:value} as DraftFinding) : item)}) : current);
  }

  function removeFinding(index: number) { setDraft(current => current ? ({...current, findings: current.findings.filter((_,i)=>i!==index)}) : current); }\n\n  async function saveFindings() {
    if (!draft?.findings.length) return;
    setSaving(true); setError('');
    try {
      const response = await axios.post('/pm/api/qa/quick-capture/save', { findings: draft.findings });
      setSaved(response.data.saved ?? draft.findings.length);
      setDraft(null);
      setNotes('');
      onSaved();
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'Could not save the organised findings.');
    } finally { setSaving(false); }
  }

  return <div className="space-y-4">
    <section className="rounded-xl border bg-white p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><h2 className="text-lg font-semibold">QA Quick Capture</h2><p className="text-sm text-slate-500">Paste rough notes from any inspection. AI separates businesses, pages and individual findings.</p></div>
        <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700">AI organiser</span>
      </div>
      <div className="rounded-lg border border-indigo-100 bg-indigo-50/50 p-3 text-sm text-indigo-950">
        You do not need a template. Write naturally: what you checked, where you found it, what happened, and anything you want to remember.
      </div>
      <textarea className={field+' min-h-56'} value={notes} onChange={e=>setNotes(e.target.value)} maxLength={12000} placeholder={'Example:\nChecked Adevents landing page on mobile. Hero heading overlaps search field at 375px. Search button sometimes does nothing.\n\nRegistration page: password field has no show/hide option.\n\nTechmandu admin: user table feels slow to load; need to investigate further.'}/>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-slate-500">{notes.length.toLocaleString()} / 12,000 characters · Nothing is saved until you review and confirm.</span>
        <button disabled={loading||!notes.trim()} onClick={()=>void organise()} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{loading?'Organising…':'✦ Organise my notes'}</button>
      </div>
      {error&&<p className="text-sm text-rose-600">{error}</p>}
      {saved>0&&<p className="text-sm text-emerald-700">{saved} findings saved as Draft QA records.</p>}
    </section>

    {draft&&<section className="rounded-xl border bg-white p-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="font-semibold">Review organised findings</h3><p className="text-sm text-slate-500">Check the AI interpretation. Unknown details are left blank rather than invented.</p></div><span className="text-xs text-slate-500">{draft.findings.length} findings detected</span></div>
      {draft.summary&&<p className="rounded-lg bg-slate-50 p-3 text-sm">{draft.summary}</p>}
      {draft.questions?.length>0&&<div className="rounded-lg border border-amber-200 bg-amber-50 p-3"><div className="text-sm font-medium text-amber-900">Needs your attention</div><ul className="mt-1 list-disc pl-5 text-sm text-amber-900">{draft.questions.map((q,i)=><li key={i}>{q}</li>)}</ul></div>}
      {draft.findings.map((item,index)=><article key={index} className="rounded-lg border p-3 space-y-3">
        <div className="flex items-start justify-between gap-2"><div className="min-w-0"><div className="text-xs text-slate-500">Finding {String(index+1).padStart(2,'0')} · {item.finding_type} · AI confidence {item.confidence}</div><div className="font-medium">{item.title}</div><div className="mt-1 flex flex-wrap gap-1 text-xs"><span className="rounded bg-slate-100 px-2 py-1">{item.business||'Business not identified'}</span><span className="rounded bg-slate-100 px-2 py-1">{item.site_app||'Site/app not identified'}</span>{item.needs_review&&<span className="rounded bg-amber-100 px-2 py-1 text-amber-800">Review suggested</span>}</div></div><div className="flex shrink-0 gap-2"><button onClick={()=>removeFinding(index)} className="rounded border px-2 py-1 text-xs text-rose-700">Remove</button><button onClick={()=>setExpanded(expanded===index?null:index)} className="rounded border px-2 py-1 text-xs">{expanded===index?'Less':'Review / edit'}</button></div></div>
        <div className="grid gap-2 sm:grid-cols-2"><label className="text-xs text-slate-500">Business<input className={field+' mt-1'} value={item.business} onChange={e=>update(index,'business',e.target.value)}/></label><label className="text-xs text-slate-500">Severity suggestion<select className={field+' mt-1'} value={item.severity} onChange={e=>update(index,'severity',e.target.value)}>{severityOptions.map(s=><option key={s}>{s}</option>)}</select></label></div>
        <p className="whitespace-pre-wrap text-sm text-slate-700">{item.description}</p>
        {expanded===index&&<div className="grid gap-2 sm:grid-cols-2">
          <label className="text-xs text-slate-500">Finding type<select className={field+' mt-1'} value={item.finding_type} onChange={e=>update(index,'finding_type',e.target.value)}>{['Bug','UI/UX','Content','Performance','Functional','Enhancement','Observation'].map(t=><option key={t}>{t}</option>)}</select></label>\n          <label className="text-xs text-slate-500">Finding title<input className={field+' mt-1'} value={item.title} onChange={e=>update(index,'title',e.target.value)}/></label>
          <label className="text-xs text-slate-500">Website / app<input className={field+' mt-1'} value={item.site_app} onChange={e=>update(index,'site_app',e.target.value)}/></label>
          <label className="text-xs text-slate-500">Project<input className={field+' mt-1'} value={item.project_name} onChange={e=>update(index,'project_name',e.target.value)}/></label>
          <label className="text-xs text-slate-500">Related task (optional)<input className={field+' mt-1'} value={item.task_title} onChange={e=>update(index,'task_title',e.target.value)}/></label>
          <label className="text-xs text-slate-500 sm:col-span-2">Page URL<input className={field+' mt-1'} value={item.page_url} onChange={e=>update(index,'page_url',e.target.value)}/></label>
          <label className="text-xs text-slate-500 sm:col-span-2">Expected behaviour<textarea className={field+' mt-1'} rows={2} value={item.expected_behaviour} onChange={e=>update(index,'expected_behaviour',e.target.value)}/></label>
          <label className="text-xs text-slate-500 sm:col-span-2">Developer / investigation note<textarea className={field+' mt-1'} rows={2} value={item.developer_notes} onChange={e=>update(index,'developer_notes',e.target.value)}/></label>
        </div>}
      </article>)}
      <div className="flex flex-wrap justify-between gap-2 border-t pt-3"><button onClick={()=>{setDraft(null);setError('');}} className="rounded-lg border px-3 py-2 text-sm">Discard organisation</button><button disabled={saving||!draft.findings.length} onClick={()=>void saveFindings()} className="rounded-lg bg-indigo-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{saving?'Saving…':`Confirm and save ${draft.findings.length} findings as Draft`}</button></div>
    </section>}
  </div>;
}
