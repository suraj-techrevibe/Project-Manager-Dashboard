import type { OperationsTodaySummary } from '../../types/pm';

/** One line on the Command center: what is waiting on you in Operations, with a link to the full view. */
export default function IncomingStrip({ summary, followupOpen, onNavigate }: { summary: OperationsTodaySummary; followupOpen: number; onNavigate: (tab: string) => void }) {
  const c = summary.counts;
  const items = [
    { label: 'Requests awaiting decision', n: c.requests_for_decision, tab: 'operations' },
    { label: 'Ideas to review', n: c.ideas_for_review, tab: 'operations' },
    { label: 'Overdue requests', n: c.overdue_requests, tab: 'operations', warn: true },
    { label: 'Draft meeting minutes', n: summary.meetings.draft_minutes, tab: 'minutes' },
    ...(followupOpen ? [{ label: 'Meeting follow-ups', n: followupOpen, tab: 'minutes' }] : []),
  ];
  const any = items.some((i) => i.n > 0);
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200/80 bg-white px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <span className="mr-1 text-sm font-semibold text-slate-900">Incoming</span>
      {any ? items.filter((i) => i.n > 0).map((i) => (
        <button key={i.label} onClick={() => onNavigate(i.tab)} className={`rounded-full px-3 py-1 text-xs font-medium ${i.warn ? 'bg-rose-50 text-rose-700 hover:bg-rose-100' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>
          {i.n} {i.label.toLowerCase()}
        </button>
      )) : <span className="text-xs text-slate-500">Nothing waiting on you.</span>}
      <button onClick={() => onNavigate('operations')} className="ml-auto text-xs font-semibold text-indigo-700 hover:underline">Open Operations →</button>
    </div>
  );
}
