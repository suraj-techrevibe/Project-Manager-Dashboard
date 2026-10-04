import { useMemo, useState } from 'react';
import type { WorkloadRow } from '../../types/pm';

type Level = 'none' | 'light' | 'balanced' | 'full' | 'over' | 'heavy';

const LEVELS: Record<Level, { label: string; pill: string; bar: string }> = {
  none: { label: 'No tasks', pill: 'bg-sky-100 text-sky-700', bar: 'bg-sky-300' },
  light: { label: 'Light', pill: 'bg-sky-50 text-sky-700', bar: 'bg-sky-400' },
  balanced: { label: 'Balanced', pill: 'bg-green-50 text-green-700', bar: 'bg-green-500' },
  full: { label: 'Nearly full', pill: 'bg-amber-50 text-amber-700', bar: 'bg-amber-500' },
  over: { label: 'Over capacity', pill: 'bg-red-100 text-red-700', bar: 'bg-red-500' },
  heavy: { label: 'Many tasks', pill: 'bg-red-50 text-red-700', bar: 'bg-red-400' },
};

const HIDDEN_KEY = 'pm.hidden_staff';

function loadHidden(): string[] {
  try {
    return JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? '[]');
  } catch {
    return [];
  }
}

/** Hours-based when estimates exist, falls back to task count when they don't. */
export function levelOf(w: WorkloadRow, overloadAt: number): Level {
  if (w.open === 0) return 'none';
  const cap = w.capacity ?? 40;
  const week = w.week_hours ?? 0;
  const known = (w.hours ?? 0) > 0;

  if (!known) return w.open >= overloadAt ? 'heavy' : 'balanced';
  const pct = week / cap;
  if (pct > 1) return 'over';
  if (pct > 0.8) return 'full';
  if (pct >= 0.3) return 'balanced';
  return 'light';
}

export function overloadThreshold(workload: WorkloadRow[]): number {
  if (!workload.length) return Infinity;
  const avg = workload.reduce((n, w) => n + w.open, 0) / workload.length;
  return Math.max(5, Math.ceil(avg * 1.5));
}

/**
 * Who has too much, who has nothing — so work can be divided evenly.
 * Bars are estimated hours due this week (overdue included) against weekly capacity.
 */
export default function TeamWorkload({
  workload,
  selected,
  onSelect,
  forceOpen,
}: {
  workload: WorkloadRow[];
  selected: string;
  onSelect: (name: string) => void;
  forceOpen?: number;
}) {
  const [open, setOpen] = useState(true);
  const [hidden, setHidden] = useState<string[]>(loadHidden);
  const [showHidden, setShowHidden] = useState(false);

  const overloadAt = useMemo(() => overloadThreshold(workload), [workload]);

  // Visible rows: idle people can be hidden (e.g. HR/admin accounts that are in Taskmandu but not on your team).
  const rows = workload.filter((w) => showHidden || w.open > 0 || !hidden.includes(w.name));
  const hiddenCount = workload.filter((w) => w.open === 0 && hidden.includes(w.name)).length;

  const levels = new Map(rows.map((w) => [w.name, levelOf(w, overloadAt)]));
  const free = rows.filter((w) => levels.get(w.name) === 'none');
  const over = rows.filter((w) => ['over', 'heavy'].includes(levels.get(w.name) ?? ''));

  // One concrete suggestion: move the excess from the most loaded to the person with most room.
  const suggestion = useMemo(() => {
    const from = over.find((w) => (w.week_hours ?? 0) > (w.capacity ?? 40));
    if (!from) return null;
    const room = (w: WorkloadRow) => (w.capacity ?? 40) - (w.week_hours ?? 0);
    const to = [...rows].filter((w) => w.name !== from.name).sort((a, b) => room(b) - room(a))[0];
    if (!to || room(to) <= 0) return null;
    const excess = (from.week_hours ?? 0) - (from.capacity ?? 40);
    const hours = Math.max(1, Math.round(Math.min(excess, room(to))));
    return { from: from.name, to: to.name, hours };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workload, hidden, showHidden]);

  function hide(name: string) {
    const next = [...hidden, name];
    setHidden(next);
    try {
      localStorage.setItem(HIDDEN_KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable — hiding just lasts for this visit */
    }
  }

  function unhideAll() {
    setHidden([]);
    setShowHidden(false);
    try {
      localStorage.removeItem(HIDDEN_KEY);
    } catch {
      /* ignore */
    }
  }

  if (!workload.length) {
    return (
      <div className="mb-3 rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-500">
        No workload data yet — press <b>Sync now</b> to pull tasks from Taskmandu.
      </div>
    );
  }

  const capacity = workload[0].capacity ?? 40;
  const unknown = workload.reduce((n, w) => n + (w.no_estimate ?? 0), 0);

  return (
    <div className="mb-3 rounded-lg border border-slate-200 bg-white" key={forceOpen}>
      <button onClick={() => setOpen((o) => !o)} className="flex w-full flex-wrap items-center justify-between gap-2 px-3 py-2 text-left">
        <span className="text-sm font-medium text-slate-800">Team workload</span>
        <span className="flex flex-wrap items-center gap-1.5 text-xs">
          {free.length > 0 && <span className="rounded bg-sky-100 px-1.5 py-0.5 text-sky-700">{free.length} with no tasks</span>}
          {over.length > 0 && <span className="rounded bg-red-100 px-1.5 py-0.5 text-red-700">{over.length} overloaded</span>}
          {free.length === 0 && over.length === 0 && <span className="text-slate-400">evenly spread</span>}
          <span className="text-slate-400">{open ? '▾' : '▸'}</span>
        </span>
      </button>

      {open && (
        <div className="border-t border-slate-100 px-3 pb-3 pt-2">
          {suggestion && (
            <div className="mb-2 rounded-md bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">
              Rebalance: move about <b>{suggestion.hours}h</b> of this week's work from <b>{suggestion.from}</b> to{' '}
              <b>{suggestion.to}</b>.
            </div>
          )}

          <ul className="flex flex-col gap-1">
            {rows.map((w) => {
              const level = levels.get(w.name) ?? 'balanced';
              const style = LEVELS[level];
              const cap = w.capacity ?? capacity;
              const pct = Math.min(150, Math.round(((w.week_hours ?? 0) / cap) * 100));
              const on = selected === w.name;
              const hasHours = (w.hours ?? 0) > 0;

              return (
                <li key={w.name} className="group flex items-center gap-2">
                  <button
                    onClick={() => onSelect(on ? '' : w.name)}
                    className={`flex min-w-0 flex-1 items-center gap-3 rounded-md border px-2.5 py-1.5 text-left transition ${
                      on ? 'border-slate-900 bg-slate-50' : 'border-transparent hover:bg-slate-50'
                    }`}
                    title="Click to show only this person's tasks"
                  >
                    <span className="w-36 shrink-0 truncate text-sm text-slate-800">
                      {w.name}
                      {w.designation && <span className="block truncate text-[11px] text-slate-400">{w.designation}</span>}
                    </span>

                    <span className="hidden min-w-0 flex-1 sm:block">
                      <span className="block h-2 overflow-hidden rounded-full bg-slate-100">
                        <span className={`block h-full rounded-full ${style.bar}`} style={{ width: `${Math.min(100, pct)}%` }} />
                      </span>
                      <span className="mt-0.5 block text-[11px] text-slate-500">
                        {hasHours ? (
                          <>
                            {w.week_hours ?? 0}h of {cap}h this week · {w.hours}h open in total
                          </>
                        ) : w.open > 0 ? (
                          'No hour estimates on their tasks'
                        ) : (
                          'Nothing open — available for new work'
                        )}
                      </span>
                    </span>

                    <span className="shrink-0 text-right text-[11px] text-slate-500">
                      {w.open} open
                      {w.overdue > 0 && <span className="text-red-600"> · {w.overdue} overdue</span>}
                      {w.blocked > 0 && <span className="text-amber-600"> · {w.blocked} blocked</span>}
                    </span>

                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${style.pill}`}>{style.label}</span>
                  </button>

                  {w.open === 0 && (
                    <button
                      onClick={() => hide(w.name)}
                      className="shrink-0 text-xs text-slate-300 opacity-0 hover:text-slate-600 group-hover:opacity-100"
                      title="Not on my team — hide"
                      aria-label={`Hide ${w.name}`}
                    >
                      ✕
                    </button>
                  )}
                </li>
              );
            })}
          </ul>

          <p className="mt-2 text-[11px] text-slate-400">
            Hours are Taskmandu estimates for tasks due by the end of this week (overdue included); capacity is {capacity}h/week
            (set PM_WEEKLY_CAPACITY_HOURS).
            {unknown > 0 && ` ${unknown} open task${unknown === 1 ? ' has' : 's have'} no estimate, so loads may be understated.`}
            {hiddenCount > 0 && (
              <>
                {' '}
                {hiddenCount} hidden ·{' '}
                <button onClick={() => setShowHidden((s) => !s)} className="underline">
                  {showHidden ? 'hide again' : 'show'}
                </button>{' '}
                ·{' '}
                <button onClick={unhideAll} className="underline">
                  reset
                </button>
              </>
            )}
          </p>
        </div>
      )}
    </div>
  );
}
