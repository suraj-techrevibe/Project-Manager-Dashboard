import type { OperationsTodaySummary } from '../../types/pm';

interface Props {
  summary: OperationsTodaySummary;
  /** Project with the most warning signals, if any. */
  riskProject: { id: string; name: string } | null;
  overloadedCount: number;
  onNavigate: (tab: string) => void;
  onOpenProject: (projectId: string) => void;
  onShowWorkload: () => void;
}

interface Item {
  key: string;
  title: string;
  why: string;
  count: number;
  clearText: string;
  action: string;
  onClick: () => void;
  tone: 'rose' | 'amber' | 'indigo' | 'slate';
}

const TONE: Record<Item['tone'], { badge: string; btn: string }> = {
  rose: { badge: 'bg-rose-100 text-rose-700', btn: 'bg-rose-600 text-white hover:bg-rose-700' },
  amber: { badge: 'bg-amber-100 text-amber-700', btn: 'bg-amber-600 text-white hover:bg-amber-700' },
  indigo: { badge: 'bg-indigo-100 text-indigo-700', btn: 'bg-indigo-600 text-white hover:bg-indigo-700' },
  slate: { badge: 'bg-slate-100 text-slate-700', btn: 'bg-slate-800 text-white hover:bg-slate-900' },
};

export default function OperationsChecklist({ summary, riskProject, overloadedCount, onNavigate, onOpenProject, onShowWorkload }: Props) {
  const { counts } = summary;
  const deliveryIssues = summary.projects.reduce((n, p) => n + p.blocked + p.overdue, 0);

  // Ordered by how much waiting costs the business: decisions first, delivery risk next, capacity last.
  const items: Item[] = [
    { key: 'decide', title: 'Decide on requests in review', why: 'Requesters are waiting on you.', count: counts.requests_for_decision, clearText: 'No requests are waiting for a decision.', action: 'Open requests', onClick: () => onNavigate('operations'), tone: 'amber' },
    { key: 'overdue-requests', title: 'Clear overdue requests', why: 'Past the date the requester asked for.', count: counts.overdue_requests, clearText: 'No request is past its requested date.', action: 'Open requests', onClick: () => onNavigate('operations'), tone: 'rose' },
    { key: 'ideas', title: 'Review new ideas', why: 'Accept, defer or reject so the backlog stays honest.', count: counts.ideas_for_review, clearText: 'No ideas are waiting for review.', action: 'Open ideas', onClick: () => onNavigate('operations'), tone: 'indigo' },
    { key: 'delivery', title: 'Check delivery across projects', why: 'Blocked or overdue tasks on the synced board.', count: deliveryIssues, clearText: 'No blocked or overdue project tasks.', action: 'Open projects', onClick: () => onNavigate('projects'), tone: 'rose' },
    { key: 'riskiest', title: 'Review the riskiest project', why: riskProject ? `${riskProject.name} has the most warning signals.` : 'Most warning signals sit here.', count: riskProject ? 1 : 0, clearText: 'No project is showing warning signals.', action: 'Open project', onClick: () => riskProject && onOpenProject(riskProject.id), tone: 'slate' },
    { key: 'capacity', title: 'Rebalance overloaded people', why: 'Overloaded people cause the next round of delays.', count: overloadedCount, clearText: 'Nobody is over weekly capacity.', action: 'Team capacity', onClick: onShowWorkload, tone: 'amber' },
  ];

  return (
    <section aria-label="Operations checklist" className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-5">
      <div className="mb-4">
        <h3 className="text-sm font-semibold tracking-tight text-slate-900 sm:text-base">Operations checklist</h3>
        <p className="mt-0.5 text-sm text-slate-500">Work it from 1 down. Items clear themselves when there is nothing left to do.</p>
      </div>
      <ol className="space-y-2.5">
        {items.map((item, i) => {
          const clear = item.count === 0;
          const t = TONE[item.tone];
          return (
            <li key={item.key} className={`flex flex-wrap items-center gap-4 rounded-xl border p-3.5 ${clear ? 'border-slate-100 bg-slate-50/60' : 'border-slate-200 bg-white'}`}>
              <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold ${clear ? 'bg-emerald-100 text-emerald-600' : t.badge}`}>{clear ? '✓' : i + 1}</div>
              <div className="min-w-0 flex-1 basis-64">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`text-sm font-semibold ${clear ? 'text-slate-500' : 'text-slate-900'}`}>{item.title}</span>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${clear ? 'bg-emerald-100 text-emerald-700' : t.badge}`}>{clear ? 'All clear' : item.key === 'riskiest' ? 'Review' : item.count}</span>
                </div>
                <div className="mt-0.5 text-sm text-slate-500">{clear ? item.clearText : item.why}</div>
              </div>
              {!clear && (
                <button type="button" onClick={item.onClick} className={`shrink-0 rounded-lg px-3.5 py-1.5 text-xs font-semibold ${t.btn}`}>
                  {item.action} →
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
