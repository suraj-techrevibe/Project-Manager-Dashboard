import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';

type Finding = {
  id: number; business: string | null; site_app: string | null; page_url: string | null;
  title: string; description: string | null; expected_behaviour: string | null; developer_notes: string | null; severity: 'Critical' | 'High' | 'Medium' | 'Low';
  status: string; assignee: string | null; evidence_url: string | null; retest_notes: string | null;
  pm_task_url: string | null; created_at: string;
};
type Report = {
  id: number; report_code: string; business: string; site_app: string | null; report_date: string;
  areas_tested: string | null; environment: string | null; summary: string | null;
  fix_first: string | null; open_questions: string | null; findings: Finding[];
  checklist: { label: string; result: string }[] | null; handed_over_at: string | null; created_at: string;
};
const field = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm';
const severities = ['Critical', 'High', 'Medium', 'Low'] as const;
const today = new Date().toISOString().slice(0, 10);
const lines = (value: string) => value.split(/\r?\n/).map(x => x.trim()).filter(Boolean);

export default function QAReportsPanel() {
  const [issues, setIssues] = useState<Finding[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [business, setBusiness] = useState('');
  const [site, setSite] = useState('');
  const [date, setDate] = useState(today);
  const [areas, setAreas] = useState('');
  const [environment, setEnvironment] = useState('');
  const [summary, setSummary] = useState('');
  const [fixFirst, setFixFirst] = useState('');
  const [questions, setQuestions] = useState('');
  const [checklistText, setChecklistText] = useState('Homepage loads | Pass\nNavigation and links | Pass\nForms and validation | Not tested\nMobile responsive layout | Not tested\nImages and content | Pass');
  const [severityFilter, setSeverityFilter] = useState('All');
  const [search, setSearch] = useState('');
  const [active, setActive] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    try {
      const [qa, saved] = await Promise.all([axios.get('/pm/api/qa'), axios.get('/pm/api/qa/reports')]);
      setIssues(qa.data.issues ?? []);
      setReports(saved.data.reports ?? []);
    } catch { setError('Could not load QA findings or saved reports.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  const businesses = useMemo(() => Array.from(new Set(issues.map(x => x.business).filter(Boolean))) as string[], [issues]);
  const visible = useMemo(() => issues.filter(x =>
    (!business || x.business === business) &&
    (severityFilter === 'All' || x.severity === severityFilter) &&
    (!search || [x.title, x.description, x.page_url, x.site_app].filter(Boolean).join(' ').toLowerCase().includes(search.toLowerCase()))
  ), [issues, business, severityFilter, search]);

  function toggle(id: number) { setSelected(current => current.includes(id) ? current.filter(x => x !== id) : [...current, id]); }
  function useReport(report: Report) { setActive(report); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  function printReport() { window.print(); }

  async function generate() {
    if (!business.trim()) { setError('Select or enter the business name before generating a report.'); return; }
    if (!selected.length) { setError('Select at least one finding to include.'); return; }
    setSaving(true); setError('');
    try {
      const response = await axios.post('/pm/api/qa/reports', {
        business, site_app: site, report_date: date, areas_tested: areas,
        environment, summary, fix_first: fixFirst, open_questions: questions,
        issue_ids: selected,
        checklist: lines(checklistText).map(row => { const [label, result = 'Not tested'] = row.split('|').map(x => x.trim()); return { label, result }; }),
      });
      const report = response.data.report as Report;
      setReports(current => [report, ...current]);
      setActive(report);
      setSelected([]);
    } catch (e: any) { setError(e?.response?.data?.message ?? 'Could not generate QA report.'); }
    finally { setSaving(false); }
  }

  async function markHandedOver(report: Report) {
    try {
      const response = await axios.patch('/pm/api/qa/reports/' + report.id + '/handover');
      const updated = response.data.report as Report;
      setReports(current => current.map(x => x.id === updated.id ? updated : x));
      setActive(updated);
    } catch { setError('Could not update handover status.'); }
  }

  const counts = (findings: Finding[]) => ({
    critical: findings.filter(x => x.severity === 'Critical').length,
    high: findings.filter(x => x.severity === 'High').length,
    medium: findings.filter(x => x.severity === 'Medium').length,
    low: findings.filter(x => x.severity === 'Low').length,
  });

  return <div className="space-y-5">
    <style>{`@media print { body * { visibility: hidden !important; } #qa-print, #qa-print * { visibility: visible !important; } #qa-print { position: absolute; inset: 0; width: 100%; padding: 24px; background: white; color: #111827; } .no-print { display: none !important; } .qa-break { break-inside: avoid; } }`}</style>
    <div className="no-print flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-lg font-semibold">QA Reports</h2><p className="text-sm text-slate-500">Record findings in QA Center, then select them here to create a developer handover report.</p></div>
      <button onClick={() => void load()} className="rounded-lg border bg-white px-3 py-2 text-sm">Refresh findings</button>
    </div>

    {active ? <div className="space-y-3">
      <div className="no-print flex flex-wrap items-center justify-between gap-2">
        <button onClick={() => setActive(null)} className="rounded-lg border bg-white px-3 py-2 text-sm">← Back to report builder</button>
        <div className="flex flex-wrap gap-2">
          {!active.handed_over_at && <button onClick={() => void markHandedOver(active)} className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-800">Mark handed over</button>}
          <button onClick={printReport} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white">Print / Save as PDF</button>
        </div>
      </div>
      <article id="qa-print" className="rounded-xl border bg-white p-6 shadow-sm print:shadow-none">
        <header className="border-b pb-4"><div className="text-xs font-semibold uppercase tracking-widest text-slate-500">Quality Assurance Report</div><h1 className="mt-2 text-2xl font-bold">{active.business} – QA Report</h1><p className="mt-1 text-sm text-slate-600">{active.report_code} · {active.report_date} · {active.site_app || 'Website / App'}</p>{active.handed_over_at && <p className="mt-2 text-xs font-semibold text-emerald-700">HANDED OVER · {new Date(active.handed_over_at).toLocaleString()}</p>}</header>
        <section className="grid grid-cols-2 gap-3 border-b py-4 text-sm md:grid-cols-4"><div><div className="text-xs text-slate-500">Total findings</div><strong>{active.findings.length}</strong></div>{Object.entries(counts(active.findings)).map(([k,v])=><div key={k}><div className="text-xs capitalize text-slate-500">{k}</div><strong>{v}</strong></div>)}</section>
        <section className="grid gap-3 border-b py-4 text-sm md:grid-cols-2"><div><strong>Areas tested</strong><p className="mt-1 whitespace-pre-wrap">{active.areas_tested || 'Not specified'}</p></div><div><strong>Environment</strong><p className="mt-1 whitespace-pre-wrap">{active.environment || 'Not specified'}</p></div></section>
        {active.summary && <section className="border-b py-4"><h2 className="font-bold">Testing summary</h2><p className="mt-2 whitespace-pre-wrap text-sm">{active.summary}</p></section>}
        {active.fix_first && <section className="border-b py-4"><h2 className="font-bold">Fix first</h2><ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{lines(active.fix_first).map((x,i)=><li key={i}>{x}</li>)}</ul></section>}
        <section className="border-b py-4"><h2 className="font-bold">Issue index</h2><div className="mt-2 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b text-xs text-slate-500"><th className="py-2">ID</th><th>Severity</th><th>Issue</th><th>Where</th></tr></thead><tbody>{active.findings.map((f,i)=><tr key={f.id} className="border-b"><td className="py-2">QA-{String(i+1).padStart(2,'0')}</td><td>{f.severity}</td><td>{f.title}</td><td>{f.page_url || 'Not specified'}</td></tr>)}</tbody></table></div></section>
        <section className="space-y-4 py-4"><h2 className="font-bold">Detailed findings</h2>{active.findings.map((f,i)=><div key={f.id} className="qa-break border-b pb-4"><h3 className="font-semibold">QA-{String(i+1).padStart(2,'0')} · {f.title}</h3><p className="mt-1 text-xs font-semibold uppercase text-slate-500">{f.severity} · {f.status}</p><p className="mt-2 text-sm"><strong>Where:</strong> {f.page_url || 'Not specified'}</p><p className="mt-2 whitespace-pre-wrap text-sm"><strong>Actual behaviour:</strong>{' '}{f.description || 'Not recorded'}</p><p className="mt-2 whitespace-pre-wrap text-sm"><strong>Expected behaviour:</strong>{' '}{f.expected_behaviour || 'Not recorded'}</p>{f.developer_notes && <p className="mt-2 whitespace-pre-wrap text-sm"><strong>Developer notes:</strong>{' '}{f.developer_notes}</p>}<p className="mt-2 text-sm"><strong>Developer:</strong> {f.assignee || 'Unassigned'}</p>{f.evidence_url && <p className="mt-2 break-all text-sm"><strong>Evidence:</strong> {f.evidence_url}</p>}{f.pm_task_url && <p className="mt-1 break-all text-sm"><strong>Taskmandu task:</strong> {f.pm_task_url}</p>}{f.retest_notes && <p className="mt-2 whitespace-pre-wrap text-sm"><strong>Retest notes:</strong> {f.retest_notes}</p>}</div>)}</section>
        {active.checklist?.length ? <section className="border-t py-4"><h2 className="font-bold">Checklist results</h2>{active.checklist.map((c,i)=><div key={i} className="flex justify-between gap-4 border-b py-2 text-sm"><span>{c.label}</span><strong>{c.result}</strong></div>)}</section> : null}
        {active.open_questions && <section className="border-t py-4"><h2 className="font-bold">Open questions</h2><ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{lines(active.open_questions).map((x,i)=><li key={i}>{x}</li>)}</ul></section>}
        <footer className="border-t pt-4 text-xs text-slate-500">Generated from QA findings recorded in the PM Dashboard. Report content is a snapshot taken at generation time.</footer>
      </article>
    </div> : <>
      <section className="no-print rounded-xl border bg-white p-4">
        <h3 className="font-semibold">1. Select findings for this report</h3>
        <div className="mt-3 grid gap-2 sm:grid-cols-3"><input className={field} placeholder="Search findings" value={search} onChange={e=>setSearch(e.target.value)}/><select className={field} value={business} onChange={e=>{setBusiness(e.target.value);setSelected([]);}}><option value="">Select business *</option>{businesses.map(x=><option key={x}>{x}</option>)}</select><select className={field} value={severityFilter} onChange={e=>setSeverityFilter(e.target.value)}><option>All</option>{severities.map(x=><option key={x}>{x}</option>)}</select></div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500"><span>{selected.length} selected · {visible.length} findings shown</span><button onClick={()=>setSelected(visible.map(x=>x.id))} className="text-indigo-700">Select all visible</button></div>
        {loading ? <p className="py-4 text-sm text-slate-500">Loading…</p> : <div className="mt-2 divide-y">{visible.map(f=><label key={f.id} className="flex cursor-pointer items-start gap-3 py-3 text-sm"><input type="checkbox" checked={selected.includes(f.id)} onChange={()=>toggle(f.id)} className="mt-1"/><span className="min-w-0 flex-1"><span className="font-medium">{f.title}</span><span className="block text-xs text-slate-500">{f.business} · {f.site_app} · {f.page_url}</span></span><span className="text-xs font-semibold">{f.severity}</span></label>)}</div>}
      </section>
      <section className="no-print rounded-xl border bg-white p-4 space-y-3">
        <h3 className="font-semibold">2. Report details</h3>
        <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">Website / app<input className={field+' mt-1'} value={site} onChange={e=>setSite(e.target.value)} placeholder="Website or app name"/></label><label className="text-sm">Report date<input type="date" className={field+' mt-1'} value={date} onChange={e=>setDate(e.target.value)}/></label><label className="text-sm sm:col-span-2">Areas tested<textarea className={field+' mt-1'} rows={2} value={areas} onChange={e=>setAreas(e.target.value)} placeholder="Homepage, product listing, checkout, mobile navigation…"/></label><label className="text-sm sm:col-span-2">Testing environment<textarea className={field+' mt-1'} rows={2} value={environment} onChange={e=>setEnvironment(e.target.value)} placeholder="Browser, device, OS, login state, staging / production…"/></label><label className="text-sm sm:col-span-2">Testing summary<textarea className={field+' mt-1'} rows={2} value={summary} onChange={e=>setSummary(e.target.value)} placeholder="Brief overall outcome…"/></label><label className="text-sm">Fix first<textarea className={field+' mt-1'} rows={3} value={fixFirst} onChange={e=>setFixFirst(e.target.value)} placeholder="One priority per line"/></label><label className="text-sm">Open questions<textarea className={field+' mt-1'} rows={3} value={questions} onChange={e=>setQuestions(e.target.value)} placeholder="One question per line"/></label><label className="text-sm sm:col-span-2">Checklist results<textarea className={field+' mt-1'} rows={4} value={checklistText} onChange={e=>setChecklistText(e.target.value)} placeholder="Test area | Pass / Fail / Not tested"/></label></div>
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <button disabled={saving} onClick={()=>void generate()} className="rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">{saving?'Generating…':'Generate QA report'}</button>
      </section>
      <section className="no-print rounded-xl border bg-white p-4"><h3 className="font-semibold">3. Saved QA reports</h3>{reports.length===0?<p className="mt-2 text-sm text-slate-500">Generated reports will be saved here for later review and handover.</p>:<div className="mt-2 divide-y">{reports.map(r=><button key={r.id} onClick={()=>useReport(r)} className="flex w-full items-center justify-between gap-3 py-3 text-left"><span><span className="block text-sm font-medium">{r.business} · {r.report_code}</span><span className="block text-xs text-slate-500">{r.report_date} · {r.findings?.length ?? 0} findings · {r.site_app || 'Website / App'}</span></span><span className="text-xs font-semibold text-indigo-700">{r.handed_over_at?'Handed over':'Draft / ready'} →</span></button>)}</div>}</section>
    </>}
  </div>;
}
