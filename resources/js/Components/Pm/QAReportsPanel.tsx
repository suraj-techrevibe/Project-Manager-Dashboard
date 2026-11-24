import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { errorMessage, STAGES, stageClass, type QAItem, type Stage } from './QA/types';

/** One line in a saved report. Reports saved before the QA Center rebuild hold the old finding shape; those are converted on read. */
type Row = { key?: string | null; code: string | null; title: string; stage: Stage; business?: string | null; site: string | null; source?: string | null; assignee: string | null; url: string | null; fail_note: string | null; remarks: string | null; checks: { label: string; is_done: boolean }[]; screenshots: string[]; updated_at?: string | null };
type Report = { id: number; report_code: string; business: string; site_app: string | null; report_date: string; areas_tested: string | null; environment: string | null; summary: string | null; fix_first: string | null; open_questions: string | null; findings: Record<string, any>[]; checklist: { label: string; result: string }[] | null; handed_over_at: string | null };

const today = new Date().toISOString().slice(0, 10);
const fmt = (s: string | null | undefined) => s || 'Not recorded';
const ALL_SITES = 'All sites / apps';
const rank: Record<Stage, number> = { Failed: 0, Testing: 1, Queue: 2, Passed: 3 };

function toRow(f: Record<string, any>): Row {
  if (f.stage) return { ...f, checks: f.checks ?? [], screenshots: f.screenshots ?? [] } as Row;
  const status = String(f.status ?? '');
  return {
    code: null, title: f.title ?? 'Untitled', site: f.site_app ?? null, assignee: f.assignee ?? null, url: f.page_url ?? null,
    stage: status === 'Passed' ? 'Passed' : ['Reported', 'Fixing', 'Failed'].includes(status) ? 'Failed' : 'Queue',
    fail_note: f.description ?? null, remarks: f.developer_notes ?? null, checks: [], screenshots: f.evidence_url ? [f.evidence_url] : [],
  };
}

const counts = (rows: Row[]) => Object.fromEntries(STAGES.map(s => [s, rows.filter(r => r.stage === s).length])) as Record<Stage, number>;
const open = (rows: Row[]) => rows.filter(r => r.stage !== 'Passed');
const label = (r: Row) => `${r.code ? r.code + ': ' : ''}${r.title}`;

export default function QAReportsPanel() {
  const [items, setItems] = useState<QAItem[]>([]);
  const [businessList, setBusinessList] = useState<string[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [business, setBusiness] = useState('');
  const [site, setSite] = useState(ALL_SITES);
  const [date, setDate] = useState(today);
  const [active, setActive] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Report | null>(null);

  async function load() {
    setLoading(true); setError('');
    try {
      const [qa, saved] = await Promise.all([axios.get('/pm/api/qa-center'), axios.get('/pm/api/qa/reports')]);
      setItems(qa.data.items ?? []); setBusinessList(qa.data.businesses ?? []); setReports(saved.data.reports ?? []);
    } catch { setError('Unable to load QA Center records.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  const businesses = useMemo(() => [...new Set([...businessList, ...items.map(i => i.business).filter(Boolean) as string[]])].sort(), [businessList, items]);
  const sites = useMemo(() => [...new Set(items.filter(i => i.business === business).map(i => i.site).filter(Boolean) as string[])].sort(), [items, business]);
  const scoped = useMemo(() => items.filter(i => i.business === business && (site === ALL_SITES || i.site === site))
    .sort((a, b) => rank[a.stage] - rank[b.stage] || (a.code ?? '').localeCompare(b.code ?? '', undefined, { numeric: true })), [items, business, site]);
  const c = counts(scoped as unknown as Row[]);

  const summary = () => {
    if (!scoped.length) return 'No QA items were recorded for this selected scope.';
    const decided = c.Passed + c.Failed;
    return `QA review covers ${scoped.length} item(s) for ${business}${site !== ALL_SITES ? ' (' + site + ')' : ''}. ${c.Failed} failed and need fixing, ${c.Testing} are in testing, ${c.Queue} are waiting in the queue, and ${c.Passed} passed${decided ? ` (pass rate ${Math.round((c.Passed / decided) * 100)}% of decided items)` : ''}.`;
  };

  async function generate() {
    if (!business) { setError('Select a project first.'); return; }
    if (!scoped.length) { setError('No QA items exist for this scope.'); return; }
    setSaving(true); setError('');
    try {
      const unresolved = open(scoped as unknown as Row[]);
      const res = await axios.post('/pm/api/qa-center/reports', {
        business, site_app: site === ALL_SITES ? '' : site, report_date: date,
        areas_tested: site === ALL_SITES ? '' : site, environment: 'Generated from QA Center scope',
        summary: summary(), fix_first: unresolved.slice(0, 8).map(r => `${r.stage}: ${label(r as unknown as Row)}`).join('\n'), open_questions: '',
        item_keys: scoped.map(i => i.key),
        checklist: [
          { label: 'Failed items triaged', result: c.Failed ? 'Retest required' : 'Pass' },
          { label: 'Every item has been tested', result: c.Queue + c.Testing ? 'Not tested' : 'Pass' },
          { label: 'Passed items identified separately', result: c.Passed ? 'Pass' : 'Not tested' },
        ],
      });
      const r = res.data.report as Report;
      setReports(prev => [r, ...prev]); setActive(r);
    } catch (e) { setError(errorMessage(e, 'Report generation failed.')); }
    finally { setSaving(false); }
  }

  async function saveEdits() {
    if (!active || !draft) return;
    setSaving(true);
    try {
      const res = await axios.patch('/pm/api/qa-center/reports/' + active.id, { ...draft, findings: draft.findings.map(f => toRow(f)) });
      const updated = res.data.report as Report;
      setActive(updated); setReports(prev => prev.map(x => (x.id === updated.id ? updated : x))); setEditing(false); setError('');
    } catch (e) { setError(errorMessage(e, 'Save failed. Please review the report fields.')); }
    finally { setSaving(false); }
  }

  async function handover(r: Report) {
    try {
      const res = await axios.patch('/pm/api/qa/reports/' + r.id + '/handover');
      setActive(res.data.report); setReports(prev => prev.map(x => (x.id === r.id ? res.data.report : x)));
    } catch { setError('Could not update handover status.'); }
  }

  const editRow = (index: number, patch: Partial<Row>) => setDraft(d => d && ({ ...d, findings: d.findings.map((f, i) => (i === index ? { ...toRow(f), ...patch } : f)) }));

  const RowView = ({ r }: { r: Row }) => <div className="qa-finding border-b py-4">
    <div className="flex flex-wrap justify-between gap-2"><h3 className="font-semibold">{r.code ? <span className="mr-2 font-mono text-sm text-slate-600">{r.code}</span> : null}{r.title}</h3><span className={'rounded-full px-2 py-1 text-xs font-semibold ' + stageClass[r.stage]}>{r.stage}</span></div>
    <p className="mt-1 text-xs text-slate-500">{[r.source, r.site, r.assignee].filter(Boolean).join(' · ') || 'No site or assignee'}</p>
    <p className="mt-2 break-all text-sm"><strong>Page URL:</strong> {fmt(r.url)}</p>
    {r.fail_note && <p className="mt-2 whitespace-pre-wrap text-sm"><strong>Failure note:</strong> {r.fail_note}</p>}
    {r.remarks && <p className="mt-2 whitespace-pre-wrap text-sm"><strong>Remarks:</strong> {r.remarks}</p>}
    {r.checks.length > 0 && <ul className="mt-2 grid gap-0.5 text-sm sm:grid-cols-2">{r.checks.map((k, i) => <li key={i} className={k.is_done ? 'text-emerald-700' : 'text-slate-500'}>{k.is_done ? '☑ Done' : '☐ Not checked'}: {k.label}</li>)}</ul>}
    {r.screenshots.length > 0 && <div className="mt-2 flex flex-wrap gap-2">{r.screenshots.map((u, i) => <a key={i} href={u} target="_blank" rel="noreferrer"><img src={u} alt="Screenshot" className="h-20 rounded border object-cover"/></a>)}</div>}
  </div>;

  const ta = 'mt-1 w-full rounded-lg border p-2 text-sm';

  return <div className="space-y-5"><style>{'@media print { body * {visibility:hidden!important} #qa-print,#qa-print *{visibility:visible!important} #qa-print{position:absolute;inset:0;width:100%;padding:24px;background:white;color:#111827}.no-print{display:none!important}.qa-finding{break-inside:avoid-page} }'}</style>
    <div className="no-print flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">QA Report Generator</h2><p className="text-sm text-slate-500">Developer handover reports built from QA Center items.</p></div><button onClick={() => void load()} className="rounded-lg border px-3 py-2 text-sm">Refresh QA data</button></div>

    {active ? (() => {
      const rows = active.findings.map(toRow);
      const cc = counts(rows);
      const unresolved = rows.filter(r => r.stage !== 'Passed');
      const passed = rows.filter(r => r.stage === 'Passed');
      return <div className="space-y-3">
        <div className="no-print flex flex-wrap justify-between gap-2"><button className="rounded-lg border px-3 py-2" onClick={() => { setActive(null); setEditing(false); }}>← Back</button>
          <div className="flex gap-2">{!editing && <button className="rounded-lg border px-3 py-2" onClick={() => { setDraft({ ...active, findings: rows as unknown as Record<string, any>[] }); setEditing(true); }}>Edit report</button>}{!active.handed_over_at && <button className="rounded-lg border px-3 py-2" onClick={() => void handover(active)}>Mark handed over</button>}<button className="rounded-lg bg-slate-900 px-4 py-2 text-white" onClick={() => window.print()}>Print / Save PDF</button></div></div>
        {error && <p className="no-print text-sm text-rose-600">{error}</p>}
        {editing && draft && <section className="no-print space-y-3 rounded-xl border bg-white p-4"><h2 className="font-semibold">Edit report snapshot</h2><p className="text-xs text-slate-500">Changes apply only to this saved report, not to the live QA Center items.</p>
          {(['areas_tested', 'environment', 'summary', 'fix_first', 'open_questions'] as const).map(k => <label key={k} className="block text-sm font-medium">{k.replace(/_/g, ' ').replace(/^./, ch => ch.toUpperCase())}<textarea className={ta} rows={k === 'areas_tested' || k === 'environment' ? 2 : 4} value={(draft[k] || '') as string} onChange={e => setDraft({ ...draft, [k]: e.target.value })}/></label>)}
          <div className="space-y-3"><h3 className="text-sm font-semibold">Items · {draft.findings.length}</h3>
            {draft.findings.map((f, index) => { const r = toRow(f); return <div key={index} className="space-y-2 rounded-lg border p-3">
              <strong className="text-sm">{r.code ?? `Item ${index + 1}`}</strong>
              <label className="block text-xs font-medium">Title<input className={ta} value={r.title} onChange={e => editRow(index, { title: e.target.value })}/></label>
              <label className="block text-xs font-medium">Stage<select className={ta} value={r.stage} onChange={e => editRow(index, { stage: e.target.value as Stage })}>{STAGES.map(s => <option key={s}>{s}</option>)}</select></label>
              {(['url', 'assignee', 'fail_note', 'remarks'] as const).map(k => <label key={k} className="block text-xs font-medium">{{ url: 'Page URL', assignee: 'Assignee', fail_note: 'Failure note', remarks: 'Remarks' }[k]}<textarea rows={k === 'fail_note' || k === 'remarks' ? 3 : 1} className={ta} value={(r[k] ?? '') as string} onChange={e => editRow(index, { [k]: e.target.value })}/></label>)}
            </div>; })}
          </div>
          <div className="flex gap-2"><button disabled={saving} onClick={() => void saveEdits()} className="rounded-lg bg-slate-900 px-4 py-2 text-white">{saving ? 'Saving…' : 'Save report edits'}</button><button onClick={() => setEditing(false)} className="rounded-lg border px-4 py-2">Cancel</button></div></section>}
        <article id="qa-print" className="mx-auto max-w-4xl rounded-xl border bg-white p-6 text-slate-900">
          <header className="border-b-2 pb-4"><p className="text-xs font-bold uppercase tracking-widest text-slate-500">Quality assurance · Developer handover</p><h1 className="mt-2 text-2xl font-bold">QA Report — {active.site_app || active.business}</h1><p className="mt-2 text-sm">{active.report_code} · {active.report_date} · {active.business}</p>{active.areas_tested && <p className="mt-2 text-sm">Scope: {active.areas_tested}</p>}{active.handed_over_at && <p className="mt-2 text-sm font-semibold text-green-700">Handed over {new Date(active.handed_over_at).toLocaleString()}</p>}</header>
          <div className="grid grid-cols-2 gap-3 py-4 sm:grid-cols-4">{STAGES.map(s => <div className="rounded-lg border p-3" key={s}><p className="text-xs uppercase text-slate-500">{s}</p><p className="text-2xl font-bold">{cc[s]}</p></div>)}</div>
          <section className="border-b py-3"><h2 className="font-bold">Executive summary</h2><p className="mt-2 text-sm leading-6">{active.summary || 'No summary available.'}</p></section>
          <section className="border-b py-3"><h2 className="font-bold">Recommended fix order</h2><ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">{(active.fix_first || '').split('\n').filter(Boolean).map((x, i) => <li key={i}>{x}</li>)}</ol></section>
          <section className="py-3"><h2 className="font-bold">Open items · {unresolved.length}</h2>{[...unresolved].sort((a, b) => rank[a.stage] - rank[b.stage]).map((r, i) => <RowView key={i} r={r}/>)}</section>
          <section className="py-3"><h2 className="font-bold">Verified / passed · {passed.length}</h2>{passed.map((r, i) => <RowView key={i} r={r}/>)}</section>
          {active.checklist && active.checklist.length > 0 && <section className="border-t py-3"><h2 className="font-bold">Automated rule checks</h2>{active.checklist.map((k, i) => <div key={i} className="flex justify-between border-b py-2 text-sm"><span>{k.label}</span><strong>{k.result}</strong></div>)}</section>}
          <footer className="mt-4 border-t pt-3 text-xs text-slate-500">Snapshot generated from QA Center. Later item changes do not alter this report.</footer>
        </article>
      </div>;
    })() : <>
      <section className="no-print rounded-xl border bg-white p-4"><h3 className="font-semibold">Report scope</h3><p className="mt-1 text-sm text-slate-500">Choose a project and optionally a site. Every QA item in scope is included, failed first; passed items are listed separately.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <label className="text-sm">Project<select className="mt-1 w-full rounded-lg border p-2" value={business} onChange={e => { setBusiness(e.target.value); setSite(ALL_SITES); }}><option value="">Select project</option>{businesses.map(x => <option key={x}>{x}</option>)}</select></label>
          <label className="text-sm">Website / App<select className="mt-1 w-full rounded-lg border p-2" value={site} onChange={e => setSite(e.target.value)}><option>{ALL_SITES}</option>{sites.map(x => <option key={x}>{x}</option>)}</select></label>
          <label className="text-sm">Report date<input className="mt-1 w-full rounded-lg border p-2" type="date" value={date} onChange={e => setDate(e.target.value)}/></label>
        </div></section>
      <section className="no-print grid grid-cols-2 gap-3 sm:grid-cols-4">{STAGES.map(s => <div key={s} className="rounded-xl border bg-white p-4"><p className="text-xs text-slate-500">{s}</p><p className="text-2xl font-semibold">{business ? c[s] : '—'}</p></div>)}</section>
      <section className="no-print rounded-xl border bg-white p-4"><h3 className="font-semibold">Included items</h3>
        {loading ? <p className="py-4 text-sm">Loading…</p> : !business ? <p className="py-3 text-sm text-slate-500">Select a project to preview report contents.</p> : scoped.length === 0 ? <p className="py-3 text-sm">No QA items in this scope.</p>
          : <div className="mt-2 divide-y">{scoped.map(i => <div key={i.key} className="flex flex-wrap justify-between gap-2 py-3"><span className="text-sm font-medium"><span className="mr-2 font-mono text-xs text-slate-500">{i.code}</span>{i.title}<span className="block text-xs text-slate-500">{[i.site, i.source, i.assignee].filter(Boolean).join(' · ')}</span></span><span className={'h-fit rounded-full px-2 py-0.5 text-xs font-medium ' + stageClass[i.stage]}>{i.stage}</span></div>)}</div>}
        {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
        <button disabled={saving || loading || !business || !scoped.length} onClick={() => void generate()} className="mt-4 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">{saving ? 'Generating…' : 'Generate report from scope'}</button></section>
      <section className="no-print rounded-xl border bg-white p-4"><h3 className="font-semibold">Saved reports</h3>{reports.length === 0 ? <p className="mt-2 text-sm text-slate-500">Generated reports will appear here.</p> : reports.map(r => <button key={r.id} onClick={() => setActive(r)} className="flex w-full justify-between gap-3 border-b py-3 text-left"><span className="text-sm font-medium">{r.business} · {r.report_code}<span className="block text-xs text-slate-500">{r.report_date} · {r.findings?.length || 0} items</span></span><span className="text-xs">{r.handed_over_at ? 'Handed over' : 'Saved'} →</span></button>)}</section>
    </>}
  </div>;
}
