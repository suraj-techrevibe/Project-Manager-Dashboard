import { useMemo, useState } from 'react';
import { localISO } from '../../lib/meetingNotes';
import { shortDate } from '../../lib/minutesFormat';
import { EmptyState, btnChip } from './ui/kit';
import type { ActionItem, MeetingMinutesSummary } from '../../types/pm';

export const todayISO = () => localISO(new Date());

/** Whole days from today to an ISO date (negative = past). */
function daysFromToday(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  const due = new Date(y, m - 1, d).getTime();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((due - today) / 86_400_000);
}

export const isOverdue = (a: ActionItem) => !a.done && !!a.due_date && daysFromToday(a.due_date) < 0;

/** Due text and colour used everywhere an action is listed. */
export function dueLabel(a: ActionItem): { text: string; cls: string } {
  if (a.done) return { text: 'Done', cls: 'text-emerald-600' };
  if (!a.due_date) return { text: 'No due date', cls: 'text-slate-400' };
  const d = daysFromToday(a.due_date);
  if (d < 0) return { text: `Overdue · ${shortDate(a.due_date)}`, cls: 'font-semibold text-red-600' };
  if (d === 0) return { text: 'Due today', cls: 'font-medium text-amber-700' };
  if (d <= 3) return { text: `Due ${shortDate(a.due_date)}`, cls: 'font-medium text-amber-700' };
  return { text: `Due ${shortDate(a.due_date)}`, cls: 'text-slate-500' };
}

export interface OpenRow { minute: MeetingMinutesSummary; index: number; item: ActionItem }

/** Every unfinished action from every meeting. Overdue first, then soonest due, undated last. */
export function openActionRows(minutes: MeetingMinutesSummary[]): OpenRow[] {
  const rows: OpenRow[] = [];
  for (const minute of minutes) minute.action_items.forEach((item, index) => { if (!item.done) rows.push({ minute, index, item }); });
  return rows.sort((a, b) => {
    const da = a.item.due_date ? daysFromToday(a.item.due_date) : Infinity;
    const db = b.item.due_date ? daysFromToday(b.item.due_date) : Infinity;
    return da - db || b.minute.meeting_date.localeCompare(a.minute.meeting_date);
  });
}

export function ActionCheck({ done, label, onChange }: { done: boolean; label: string; onChange: () => void }) {
  return (
    <label className="-m-2.5 flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center" title={label}>
      <input type="checkbox" checked={done} onChange={onChange} aria-label={label} className="h-5 w-5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
    </label>
  );
}

const sel = 'rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm text-slate-700 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500';

/** Open actions from all meetings in one list, with owner filter and group-by-person. */
export function OpenActionsView({ minutes, onToggle, onOpenMeeting }: {
  minutes: MeetingMinutesSummary[];
  onToggle: (minuteId: number, index: number) => void;
  onOpenMeeting: (id: number) => void;
}) {
  const [owner, setOwner] = useState('All');
  const [byPerson, setByPerson] = useState(false);
  const all = useMemo(() => openActionRows(minutes), [minutes]);
  const owners = useMemo(() => Array.from(new Set(all.map((r) => r.item.owner?.trim() || 'Unassigned'))).sort(), [all]);
  const rows = all.filter((r) => owner === 'All' || (r.item.owner?.trim() || 'Unassigned') === owner);
  const groups = byPerson
    ? owners.filter((o) => rows.some((r) => (r.item.owner?.trim() || 'Unassigned') === o)).map((o) => ({ name: o, rows: rows.filter((r) => (r.item.owner?.trim() || 'Unassigned') === o) }))
    : [{ name: '', rows }];

  if (all.length === 0) return <EmptyState title="Nothing open">Every action item from every meeting is done.</EmptyState>;

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 p-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Everything still open, across all meetings</h3>
          <p className="text-xs text-slate-500">Overdue first, then by due date. Ticking an item closes it in its meeting too.</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <select value={owner} onChange={(e) => setOwner(e.target.value)} className={sel} aria-label="Owner">
            <option value="All">Everyone</option>
            {owners.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
          <button type="button" onClick={() => setByPerson((v) => !v)} className={btnChip(byPerson)} aria-pressed={byPerson}>Group by person</button>
        </div>
      </div>
      {rows.length === 0 && <p className="p-6 text-center text-sm text-slate-500">Nothing open for {owner}.</p>}
      {groups.map((g) => (
        <div key={g.name || 'all'}>
          {byPerson && (
            <div className="flex justify-between border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-600">
              <span>{g.name}</span>
              <span className="font-medium text-slate-500">{g.rows.length} open{g.rows.filter((r) => isOverdue(r.item)).length ? ` · ${g.rows.filter((r) => isOverdue(r.item)).length} overdue` : ''}</span>
            </div>
          )}
          <ul className="divide-y divide-slate-100">
            {g.rows.map((r) => {
              const due = dueLabel(r.item);
              return (
                <li key={`${r.minute.id}-${r.index}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
                  <ActionCheck done={false} label={`Mark done: ${r.item.task}`} onChange={() => onToggle(r.minute.id, r.index)} />
                  <div className="min-w-0 flex-1 basis-60">
                    <div className="text-sm font-medium text-slate-900">{r.item.task}</div>
                    <button type="button" onClick={() => onOpenMeeting(r.minute.id)} className="mt-0.5 text-xs text-indigo-600 hover:underline">
                      from {r.minute.title} · {shortDate(r.minute.meeting_date)}
                    </button>
                  </div>
                  <span className="w-24 text-sm text-slate-700">{r.item.owner?.trim() || 'Unassigned'}</span>
                  <span className={`w-36 text-xs ${due.cls}`}>{due.text}</span>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** Every decision from every meeting, newest first. */
export function DecisionsView({ minutes, onOpenMeeting }: { minutes: MeetingMinutesSummary[]; onOpenMeeting: (id: number) => void }) {
  const [q, setQ] = useState('');
  const rows = useMemo(() => {
    const out: { id: number; title: string; date: string; text: string }[] = [];
    for (const m of minutes) {
      const seen = new Set<string>();
      for (const text of [...(m.decisions ?? []), ...((m.topics ?? []).map((t) => t.decision))]) {
        const t = (text ?? '').trim();
        if (t && !seen.has(t.toLowerCase())) { seen.add(t.toLowerCase()); out.push({ id: m.id, title: m.title, date: m.meeting_date, text: t }); }
      }
    }
    return out;
  }, [minutes]);
  const needle = q.trim().toLowerCase();
  const shown = rows.filter((r) => !needle || r.text.toLowerCase().includes(needle) || r.title.toLowerCase().includes(needle));

  if (rows.length === 0) return <EmptyState title="No decisions recorded yet">Decisions you write in a meeting's topics appear here.</EmptyState>;

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 p-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Decision log</h3>
          <p className="text-xs text-slate-500">What did we agree, and when? Newest first.</p>
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search decisions…" aria-label="Search decisions" className={`${sel} w-56`} />
      </div>
      {shown.length === 0 && <p className="p-6 text-center text-sm text-slate-500">No decision matches that search.</p>}
      <ul className="divide-y divide-slate-100">
        {shown.map((r, i) => (
          <li key={`${r.id}-${i}`} className="flex flex-wrap gap-x-4 gap-y-1 px-4 py-3">
            <div className="w-24 shrink-0 text-xs font-semibold text-slate-600">{shortDate(r.date)}</div>
            <div className="min-w-0 flex-1 basis-72">
              <p className="text-sm leading-relaxed text-slate-900">{r.text}</p>
              <button type="button" onClick={() => onOpenMeeting(r.id)} className="mt-0.5 text-xs text-indigo-600 hover:underline">{r.title} →</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
