import { useMemo, useState } from 'react';
import axios from 'axios';
import { button, businessCode, dateTime, errorMessage, itemUrl, NO_BUSINESS, primary, STAGES, stageClass, type QAItem } from './types';

const esc = (s: string | null | undefined) => (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\n/g, '<br>');

type Field = 'title' | 'url' | 'assignee' | 'remarks' | 'fail_note';

function groups(items: QAItem[]) {
  const map = new Map<string, QAItem[]>();
  for (const it of items) { const k = it.business || NO_BUSINESS; map.set(k, [...(map.get(k) ?? []), it]); }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([business, list]) => ({
    business,
    items: [...list].sort((a, b) => (a.code ?? '').localeCompare(b.code ?? '', undefined, { numeric: true })),
  }));
}

function buildDoc(items: QAItem[], scope: string): string {
  const rows = groups(items).map(g => `<h2>${esc(g.business)}${g.items[0]?.code ? ` (${esc(businessCode(g.items[0].code))})` : ''}</h2>
<table border="1" cellpadding="4" cellspacing="0" width="100%" style="border-collapse:collapse;font-size:10pt">
<tr style="background:#f1f5f9"><th>Code</th><th>Item</th><th>Site</th><th>Stage</th><th>Assignee</th><th>Checks</th><th>Failure note</th><th>Remarks</th></tr>
${g.items.map(i => `<tr><td>${esc(i.code)}</td><td>${esc(i.title)}${i.url ? `<br>${esc(i.url)}` : ''}</td><td>${esc(i.site)}</td><td>${i.stage}</td><td>${esc(i.assignee)}</td><td>${i.checks.filter(c => c.is_done).length}/${i.checks.length}</td><td>${esc(i.fail_note)}</td><td>${esc(i.remarks)}</td></tr>`).join('')}
</table>`).join('');
  return `<html><head><meta charset="utf-8"><title>QA summary</title></head><body style="font-family:Calibri,Arial,sans-serif"><h1>QA summary</h1><p>${esc(scope)} · ${items.length} items · ${esc(dateTime(new Date().toISOString()))}</p>${rows}</body></html>`;
}

const cell = 'w-full min-w-[8rem] rounded border border-transparent bg-transparent px-1.5 py-1 text-sm hover:border-slate-300 focus:border-indigo-500 focus:bg-white focus:outline-none disabled:text-slate-700';

/** Detailed table of the items currently shown. Text cells edit inline and save when you leave them. */
export default function SummaryTable({ items, scope, onChange }: { items: QAItem[]; scope: string; onChange: (item: QAItem) => void }) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const grouped = useMemo(() => groups(items), [items]);

  async function save(item: QAItem, field: Field, value: string) {
    if (value === (item[field] ?? '')) return;
    try {
      const { data } = await axios.patch<{ item: QAItem }>(itemUrl(item), { [field]: value });
      onChange(data.item);
      setErrors(e => ({ ...e, [item.key]: '' }));
    } catch (e) { setErrors(prev => ({ ...prev, [item.key]: errorMessage(e, 'Could not save.') })); }
  }

  function download() {
    const blob = new Blob(['﻿', buildDoc(items, scope)], { type: 'application/msword' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `qa-summary-${new Date().toISOString().slice(0, 10)}.doc`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // Keyed on updated_at so a server refresh resets the cell; a plain function (not a component) so typing never remounts it.
  const cellFor = (item: QAItem, field: Field, multi = false) => {
    const locked = !item.editable && (field === 'title' || field === 'url' || field === 'assignee');
    const common = { className: cell, defaultValue: item[field] ?? '', disabled: locked, 'aria-label': field, onBlur: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => void save(item, field, e.target.value) };
    return multi ? <textarea key={item.updated_at} rows={2} {...common}/> : <input key={item.updated_at} {...common}/>;
  };

  return <section className="rounded-xl border bg-white p-4" id="qa-summary">
    <style>{`@media print { body * { visibility: hidden !important; } #qa-summary, #qa-summary * { visibility: visible !important; } #qa-summary { position: absolute; left: 0; top: 0; width: 100%; } .qa-no-print { display: none !important; } }`}</style>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h3 className="text-base font-semibold text-slate-900">Summary</h3><p className="text-xs text-slate-500">{scope} · {items.length} items · click a cell to edit; it saves when you leave it.</p></div>
      <div className="qa-no-print flex gap-2"><button className={primary} disabled={!items.length} onClick={download}>Export to doc</button><button className={button} disabled={!items.length} onClick={() => window.print()}>Print</button></div>
    </div>
    {items.length === 0 && <p className="mt-4 text-sm text-slate-500">Nothing matches the current filters.</p>}
    {grouped.map(g => {
      const n = (s: string) => g.items.filter(i => i.stage === s).length;
      return <div key={g.business} className="mt-5">
        <h4 className="text-sm font-semibold text-slate-900">{g.business}</h4>
        <p className="text-xs text-slate-500">{STAGES.map(s => `${s} ${n(s)}`).join(' · ')}</p>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[56rem] border-collapse text-left text-sm">
            <thead><tr className="border-b bg-slate-50 text-xs uppercase tracking-wide text-slate-500">{['Code', 'Item', 'Page URL', 'Site', 'Stage', 'Assignee', 'Checks', 'Failure note', 'Remarks'].map(h => <th key={h} className="px-1.5 py-2 font-medium">{h}</th>)}</tr></thead>
            <tbody>{g.items.map(i => <tr key={i.key} className="border-b align-top">
              <td className="whitespace-nowrap px-1.5 py-1.5 font-mono text-xs font-semibold text-slate-600">{i.code}</td>
              <td>{cellFor(i, "title", true)}{errors[i.key] && <p role="alert" className="px-1.5 text-xs text-rose-700">{errors[i.key]}</p>}</td>
              <td>{cellFor(i, "url")}</td>
              <td className="px-1.5 py-1.5 text-slate-700">{i.site ?? '—'}</td>
              <td className="px-1.5 py-1.5"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${stageClass[i.stage]}`}>{i.stage}</span></td>
              <td>{cellFor(i, "assignee")}</td>
              <td className="whitespace-nowrap px-1.5 py-1.5 text-slate-600">{i.checks.filter(c => c.is_done).length}/{i.checks.length}</td>
              <td>{cellFor(i, "fail_note", true)}</td>
              <td>{cellFor(i, "remarks", true)}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </div>;
    })}
  </section>;
}
