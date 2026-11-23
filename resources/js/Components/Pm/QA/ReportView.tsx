import { useMemo } from 'react';
import { button, businessCode, dateTime, heading, NO_BUSINESS, primary, STAGES, stageClass, type QAItem } from './types';

const esc = (s: string | null | undefined) => (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

type Group = { business: string; code: string; items: QAItem[]; counts: Record<string, number>; rate: number };

function group(items: QAItem[]): Group[] {
  const map = new Map<string, QAItem[]>();
  for (const it of items) { const k = it.business || NO_BUSINESS; map.set(k, [...(map.get(k) ?? []), it]); }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([business, list]) => {
    const sorted = [...list].sort((a, b) => (a.code ?? '').localeCompare(b.code ?? '', undefined, { numeric: true }));
    const counts: Record<string, number> = {};
    for (const s of STAGES) counts[s] = sorted.filter(i => i.stage === s).length;
    const decided = counts.Passed + counts.Failed;
    return { business, code: businessCode(sorted[0]?.code ?? null), items: sorted, counts, rate: decided ? Math.round((counts.Passed / decided) * 100) : 0 };
  });
}

function buildDoc(groups: Group[], total: number, scope: string): string {
  const body = groups.map(g => `
<h2>${esc(g.business)}${g.code ? ` (${esc(g.code)})` : ''}</h2>
<p>${g.items.length} items · Queue ${g.counts.Queue} · Testing ${g.counts.Testing} · Failed ${g.counts.Failed} · Passed ${g.counts.Passed} · Pass rate ${g.rate}%</p>
${g.items.map(i => `
<table border="1" cellpadding="5" cellspacing="0" width="100%" style="border-collapse:collapse;margin-bottom:12px">
<tr style="background:#f1f5f9"><td colspan="2"><b>${esc(i.code)}</b> · ${esc(i.title)} · <b>${i.stage}</b></td></tr>
<tr><td width="25%">Business / site</td><td>${esc(i.business)} · ${esc(i.site)}</td></tr>
<tr><td>Source / assignee</td><td>${esc(i.source)} · ${esc(i.assignee) || '—'}</td></tr>
<tr><td>Page URL</td><td>${esc(i.url) || '—'}</td></tr>
<tr><td>Updated</td><td>${esc(dateTime(i.updated_at))} · ${i.screenshots.length} screenshot(s)</td></tr>
${i.fail_note ? `<tr><td>Failure note</td><td>${esc(i.fail_note)}</td></tr>` : ''}
${i.remarks ? `<tr><td>Remarks</td><td>${esc(i.remarks)}</td></tr>` : ''}
<tr><td>Checklist</td><td>${i.checks.length ? i.checks.map(c => `${c.is_done ? '☑ Done' : '☐ Not checked'}: ${esc(c.label)}`).join('<br>') : '—'}</td></tr>
</table>`).join('')}`).join('');
  return `<html><head><meta charset="utf-8"><title>QA report</title></head><body style="font-family:Calibri,Arial,sans-serif;font-size:11pt">
<h1>QA report</h1><p>${esc(scope)} · ${total} items · Generated ${esc(dateTime(new Date().toISOString()))}</p>${body}</body></html>`;
}

/** The single detailed report. Follows whatever filters are active in the QA Center. */
export default function ReportView({ items, scope, onClose }: { items: QAItem[]; scope: string; onClose: () => void }) {
  const groups = useMemo(() => group(items), [items]);

  function download() {
    const blob = new Blob(['﻿', buildDoc(groups, items.length, scope)], { type: 'application/msword' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `qa-report-${new Date().toISOString().slice(0, 10)}.doc`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  return <section className="rounded-xl border bg-white p-4 print:border-0 print:p-0" id="qa-report">
    <style>{`@media print { body * { visibility: hidden !important; } #qa-report, #qa-report * { visibility: visible !important; } #qa-report { position: absolute; left: 0; top: 0; width: 100%; } .qa-no-print { display: none !important; } }`}</style>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h3 className="text-base font-semibold text-slate-900">Report</h3><p className="text-xs text-slate-500">{scope} · {items.length} items</p></div>
      <div className="qa-no-print flex gap-2"><button className={primary} disabled={!items.length} onClick={download}>Download Word (.doc)</button><button className={button} disabled={!items.length} onClick={() => window.print()}>Print</button><button className={button} onClick={onClose}>Close</button></div>
    </div>
    {items.length === 0 && <p className="mt-4 text-sm text-slate-500">Nothing matches the current filters.</p>}
    {groups.map(g => <div key={g.business} className="mt-5">
      <div className="border-b pb-1"><h4 className={heading}>{g.business}{g.code && <span className="ml-2 font-mono text-xs text-slate-500">{g.code}</span>}</h4>
        <p className="text-xs text-slate-500">{g.items.length} items · Queue {g.counts.Queue} · Testing {g.counts.Testing} · Failed {g.counts.Failed} · Passed {g.counts.Passed} · Pass rate {g.rate}%</p></div>
      <div className="mt-2 space-y-3">{g.items.map(i => <article key={i.key} className="break-inside-avoid rounded-lg border p-3 text-sm">
        <div className="flex flex-wrap items-center gap-2"><span className="font-mono font-semibold text-slate-700">{i.code}</span><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${stageClass[i.stage]}`}>{i.stage}</span><span className="font-medium text-slate-900">{i.title}</span></div>
        <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs text-slate-600 sm:grid-cols-2">
          <div>Site: <span className="text-slate-800">{i.site ?? '—'}</span></div>
          <div>Source: <span className="text-slate-800">{i.source}</span></div>
          <div>Assignee: <span className="text-slate-800">{i.assignee ?? '—'}</span></div>
          <div>Updated: <span className="text-slate-800">{dateTime(i.updated_at)}</span></div>
          <div className="sm:col-span-2 break-all">Page URL: <span className="text-slate-800">{i.url ?? '—'}</span></div>
          <div>Screenshots: <span className="text-slate-800">{i.screenshots.length}</span></div>
        </dl>
        {i.fail_note && <p className="mt-2 whitespace-pre-wrap rounded bg-rose-50 p-2 text-xs text-rose-800"><b>Failure note:</b> {i.fail_note}</p>}
        {i.remarks && <p className="mt-2 whitespace-pre-wrap text-xs text-slate-700"><b>Remarks:</b> {i.remarks}</p>}
        <ul className="mt-2 grid gap-0.5 text-xs sm:grid-cols-2">{i.checks.length === 0 ? <li className="text-slate-400">No checklist</li> : i.checks.map(c => <li key={c.id} className={c.is_done ? 'text-emerald-700' : 'text-slate-500'}>{c.is_done ? '☑ Done' : '☐ Not checked'}: {c.label}</li>)}</ul>
      </article>)}</div>
    </div>)}
  </section>;
}
