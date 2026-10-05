import { useState } from 'react';
import type { SinceGroup, SinceItem, SinceSummary } from '../../types/pm';

type Key = 'completed' | 'blocked' | 'overdue' | 'created';

const CHIPS: { key: Key; label: string; on: string; off: string }[] = [
  { key: 'completed', label: 'completed', on: 'bg-green-700 text-white', off: 'bg-green-50 text-green-700 hover:bg-green-100' },
  { key: 'blocked', label: 'newly blocked', on: 'bg-red-700 text-white', off: 'bg-red-50 text-red-700 hover:bg-red-100' },
  { key: 'overdue', label: 'went overdue', on: 'bg-amber-700 text-white', off: 'bg-amber-50 text-amber-700 hover:bg-amber-100' },
  { key: 'created', label: 'new tasks', on: 'bg-slate-700 text-white', off: 'bg-slate-100 text-slate-600 hover:bg-slate-200' },
];

/**
 * "Since yesterday" — the 30-second morning stand-up: what finished, what newly
 * went blocked or overdue, what was added, and who has nothing to do. Built from
 * pm_activities (written at every sync).
 */
export default function SinceStrip({
  since,
  onOpenItem,
  onShowFree,
  bare = false,
}: {
  since: SinceSummary;
  onOpenItem: (item: SinceItem) => void;
  onShowFree?: () => void;
  /** Render without its own card/title — for use inside a <Section>. */
  bare?: boolean;
}) {
  const [open, setOpen] = useState<Key | null>(null);
  const group: SinceGroup | null = open ? since[open] : null;

  return (
    <div className={bare ? '' : 'mb-3 rounded-lg border border-slate-200 bg-white p-3'}>
      <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 ${bare && since.tracked ? 'hidden' : 'mb-2'}`}>
        {!bare && <span className="text-sm font-medium text-slate-800">Since {since.label}</span>}
        {!since.tracked && (
          <span className="text-xs text-slate-400">
            Changes appear here after your next sync — the very first sync only sets a baseline.
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {CHIPS.map((c) => {
          const n = since[c.key].count;
          return (
            <button
              key={c.key}
              disabled={n === 0}
              onClick={() => setOpen((cur) => (cur === c.key ? null : c.key))}
              className={`rounded-md px-2.5 py-1 text-xs transition disabled:cursor-default disabled:opacity-50 ${
                open === c.key ? c.on : c.off
              }`}
            >
              <span className="font-medium">{n}</span> {c.label}
            </button>
          );
        })}

        {since.idle.length > 0 ? (
          <button
            onClick={onShowFree}
            className="rounded-md bg-sky-50 px-2.5 py-1 text-xs text-sky-700 hover:bg-sky-100"
            title="People with nothing open — see Team workload"
          >
            <span className="font-medium">{since.idle.length}</span> with no tasks
          </button>
        ) : (
          <span className="px-1 text-xs text-slate-400">Everyone has work</span>
        )}
      </div>

      {since.idle.length > 0 && (
        <p className="mt-2 text-xs text-sky-700">
          No open tasks: {since.idle.slice(0, 6).join(', ')}
          {since.idle.length > 6 && ` +${since.idle.length - 6} more`}
        </p>
      )}

      {group && (
        <ul className="mt-2 divide-y divide-slate-100 rounded-md border border-slate-100">
          {group.items.map((it) => (
            <li key={it.card_id}>
              <button
                onClick={() => onOpenItem(it)}
                className="flex w-full items-baseline justify-between gap-3 px-2.5 py-1.5 text-left text-xs hover:bg-slate-50"
              >
                <span className="min-w-0 truncate text-slate-800">
                  {it.project_name && <span className="text-slate-400">{it.project_name} · </span>}
                  {it.title}
                </span>
                <span className="shrink-0 text-slate-400">{it.assignee ?? 'Unassigned'}</span>
              </button>
            </li>
          ))}
          {group.count > group.items.length && (
            <li className="px-2.5 py-1.5 text-xs text-slate-400">+{group.count - group.items.length} more</li>
          )}
        </ul>
      )}
    </div>
  );
}
