import { useEffect, useMemo, useState } from 'react';
import { pmApi } from '@/lib/pmApi';
import { visitPm } from '@/lib/pmNav';
import { CATEGORIES, CATEGORY_STYLE, emptyHours, fmtHours, addHours, sumHours } from '@/lib/taskCategories';
import type { CategoryHours, TaskCategory, WorkloadProject, WorkloadRow } from '../../types/pm';
import { CategoryBar } from './CategoryBadge';
import { btnChip } from './ui/kit';
import InvestigationPanel from './investigation/InvestigationPanel';
import type { InvByDeveloper } from '../../types/pmInvestigation';

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

type Mode = 'week' | 'all';

/** Category hours for a row in the chosen mode (this week's work, or everything open). */
const hoursOf = (w: WorkloadRow, mode: Mode): CategoryHours => (mode === 'week' ? w.category_week_hours : w.category_hours) ?? emptyHours();

/**
 * Who has too much, who has nothing — so work can be divided evenly.
 * The capacity bar is estimated hours due this week (overdue included) against weekly capacity.
 * Under it, a stacked bar splits the same estimated hours by task category (see the Dictionary tab).
 * These are Taskmandu estimates, not timesheets.
 */
function WorkloadView({
  workload,
  selected,
  onSelect,
  forceOpen,
  bare = false,
}: {
  workload: WorkloadRow[];
  selected: string;
  onSelect: (name: string) => void;
  forceOpen?: number;
  /** Render without its own card/header — for use inside a <Section> (always expanded). */
  bare?: boolean;
}) {
  const [open, setOpen] = useState(true);
  const [hidden, setHidden] = useState<string[]>(loadHidden);
  const [showHidden, setShowHidden] = useState(false);

  const [mode, setMode] = useState<Mode>('week');
  const [project, setProject] = useState('');
  const [category, setCategory] = useState<TaskCategory | ''>('');
  const [projects, setProjects] = useState<WorkloadProject[]>([]);
  const [reviewCount, setReviewCount] = useState(0);
  const [filtered, setFiltered] = useState<WorkloadRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const narrowed = Boolean(project || category);

  // Business list + "needs review" count (once, and again whenever Today refreshes the workload).
  useEffect(() => {
    let live = true;
    pmApi
      .workload()
      .then(({ data }) => {
        if (!live) return;
        setProjects(data.projects);
        setReviewCount(data.review_count);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [workload]);

  // Business / category filters are calculated by the server with the same workload rules.
  useEffect(() => {
    if (!narrowed) {
      setFiltered(null);
      setError(null);
      return;
    }
    let live = true;
    setLoading(true);
    setError(null);
    pmApi
      .workload({ project_id: project || undefined, category: category || undefined })
      .then(({ data }) => live && setFiltered(data.workload))
      .catch(() => live && setError("Couldn't apply the filter."))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [project, category, narrowed, workload]);

  const data = narrowed && filtered ? filtered : workload;
  const overloadAt = useMemo(() => overloadThreshold(data), [data]);

  // Visible rows: idle people can be hidden (e.g. HR/admin accounts that are in Taskmandu but not on your team).
  const rows = data.filter((w) => showHidden || w.open > 0 || !hidden.includes(w.name));
  const hiddenCount = data.filter((w) => w.open === 0 && hidden.includes(w.name)).length;

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
  }, [data, hidden, showHidden]);

  // Where the estimated hours go, across everyone shown.
  const totals = useMemo(() => rows.reduce((t, w) => addHours(t, hoursOf(w, mode)), emptyHours()), [rows, mode]);
  const totalHours = sumHours(totals);

  const insights = useMemo(() => {
    const out: string[] = [];
    const pct = (n: number, d: number) => Math.round((n / d) * 100);

    rows.forEach((w) => {
      const h = hoursOf(w, mode);
      const t = sumHours(h);
      if (t < 6) return;
      const top = (['Development', 'Research', 'QA', 'Maintenance'] as TaskCategory[]).sort((a, b) => h[b] - h[a])[0];
      if (h[top] / t >= 0.5 && top !== 'Development') out.push(`${w.name} has ${pct(h[top], t)}% of their estimated hours in ${top}.`);
    });
    if (totals.QA > totals.Development && totals.QA > 0) out.push(`QA hours (${fmtHours(totals.QA)}h) exceed Development (${fmtHours(totals.Development)}h).`);
    if (!project && !category) {
      projects.filter((p) => p.tasks > 0 && p.hours.Research === 0).slice(0, 3).forEach((p) => out.push(`${p.name} has no research work planned.`));
    }
    rows
      .filter((w) => w.open > 0 && (w.capacity ?? 40) - (w.week_hours ?? 0) >= 20)
      .slice(0, 2)
      .forEach((w) => out.push(`${w.name} has about ${Math.round((w.capacity ?? 40) - (w.week_hours ?? 0))}h of spare capacity this week.`));
    return out.slice(0, 6);
  }, [rows, mode, totals, projects, project, category]);

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
  const unknown = data.reduce((n, w) => n + (w.no_estimate ?? 0), 0);
  const openTasks = data.reduce((n, w) => n + w.open, 0);
  const openHours = data.reduce((n, w) => n + (w.hours ?? 0), 0);
  const selectCls = 'rounded-lg border border-slate-200 bg-white py-1.5 pl-2.5 pr-7 text-xs text-slate-700 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400';

  return (
    <div className={bare ? '' : 'mb-3 rounded-lg border border-slate-200 bg-white'} key={forceOpen}>
      <button onClick={() => setOpen((o) => !o)} className={`flex w-full flex-wrap items-center justify-between gap-2 px-3 py-2 text-left ${bare ? 'hidden' : ''}`}>
        <span className="text-sm font-medium text-slate-800">Team workload</span>
        <span className="flex flex-wrap items-center gap-1.5 text-xs">
          {free.length > 0 && <span className="rounded bg-sky-100 px-1.5 py-0.5 text-sky-700">{free.length} with no tasks</span>}
          {over.length > 0 && <span className="rounded bg-red-100 px-1.5 py-0.5 text-red-700">{over.length} overloaded</span>}
          {free.length === 0 && over.length === 0 && <span className="text-slate-400">evenly spread</span>}
          <span className="text-slate-400">{open ? '▾' : '▸'}</span>
        </span>
      </button>

      {(bare || open) && (
        <div className={bare ? '' : 'border-t border-slate-100 px-3 pb-3 pt-2'}>
          {/* Summary numbers */}
          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { label: 'Open tasks', value: String(openTasks) },
              { label: 'Estimated hours', value: `${fmtHours(openHours)}h` },
              { label: 'Missing estimates', value: String(unknown) },
              { label: 'Need category review', value: String(reviewCount), onClick: reviewCount > 0 ? () => visitPm('dictionary') : undefined },
            ].map((m) => (
              <div key={m.label} className="rounded-lg bg-slate-50 px-3 py-2">
                <div className="text-[11px] text-slate-500">{m.label}</div>
                {m.onClick ? (
                  <button onClick={m.onClick} className="text-lg font-semibold text-indigo-700 hover:underline" title="Open the Dictionary tab to review these tasks">
                    {m.value}
                  </button>
                ) : (
                  <div className="text-lg font-semibold text-slate-900">{m.value}</div>
                )}
              </div>
            ))}
          </div>

          {/* Filters */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <select value={selected} onChange={(e) => onSelect(e.target.value)} className={selectCls} aria-label="Developer">
              <option value="">All developers</option>
              {[...workload].sort((a, b) => a.name.localeCompare(b.name)).map((w) => (
                <option key={w.name} value={w.name}>
                  {w.name}
                </option>
              ))}
            </select>
            <select value={project} onChange={(e) => setProject(e.target.value)} className={selectCls} aria-label="Business or project">
              <option value="">All businesses</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <select value={category} onChange={(e) => setCategory(e.target.value as TaskCategory | '')} className={selectCls} aria-label="Category">
              <option value="">All categories</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            {(narrowed || selected) && (
              <button
                onClick={() => {
                  setProject('');
                  setCategory('');
                  onSelect('');
                }}
                className="text-xs text-slate-500 underline hover:text-slate-800"
              >
                Clear filters
              </button>
            )}
            <span className="ml-auto flex items-center gap-1.5">
              <button onClick={() => setMode('week')} className={btnChip(mode === 'week')}>
                This week
              </button>
              <button onClick={() => setMode('all')} className={btnChip(mode === 'all')}>
                All open
              </button>
            </span>
          </div>

          {narrowed && (
            <p className="mb-2 text-[11px] text-slate-500">
              {loading ? 'Applying filter…' : `Showing only ${category ? `${category} tasks` : 'tasks'}${project ? ` in ${projects.find((p) => p.id === project)?.name ?? 'this business'}` : ''}. Capacity bars count just these tasks.`}
            </p>
          )}
          {error && <p className="mb-2 text-xs text-red-600">{error}</p>}

          {suggestion && (
            <div className="mb-2 rounded-md bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">
              Rebalance: move about <b>{suggestion.hours}h</b> of this week's work from <b>{suggestion.from}</b> to{' '}
              <b>{suggestion.to}</b>.
            </div>
          )}

          <ul className="flex flex-col gap-1.5">
            {rows.map((w) => {
              const level = levels.get(w.name) ?? 'balanced';
              const style = LEVELS[level];
              const cap = w.capacity ?? capacity;
              const pct = Math.min(150, Math.round(((w.week_hours ?? 0) / cap) * 100));
              const on = selected === w.name;
              const hasHours = (w.hours ?? 0) > 0;
              const catHours = hoursOf(w, mode);

              return (
                <li key={w.name} className={`group rounded-lg border px-1 py-1 transition ${on ? 'border-indigo-600 bg-slate-50' : 'border-transparent hover:bg-slate-50'}`}>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => onSelect(on ? '' : w.name)}
                      className="flex min-w-0 flex-1 items-center gap-3 rounded-md px-1.5 py-1 text-left"
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
                          ) : narrowed ? (
                            'No matching tasks'
                          ) : (
                            'Nothing open — available for new work'
                          )}
                        </span>
                      </span>

                      <span className="shrink-0 text-right text-[11px] text-slate-500">
                        {w.open} open
                        {w.overdue > 0 && <span className="text-red-600"> · {w.overdue} overdue</span>}
                        {w.blocked > 0 && <span className="text-amber-600"> · {w.blocked} blocked</span>}
                        {(w.no_estimate ?? 0) > 0 && <span className="text-slate-400"> · {w.no_estimate} no estimate</span>}
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
                  </div>

                  {sumHours(catHours) > 0 && (
                    <div className="px-1.5 pb-1 pt-0.5 sm:pl-[10.5rem]">
                      <CategoryBar hours={catHours} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          {/* Insights from the same estimated hours */}
          {totalHours > 0 && (
            <div className="mt-3 border-t border-slate-100 pt-2.5">
              <div className="mb-1 text-xs font-medium text-slate-700">Insights from estimated hours</div>
              <p className="mb-1 text-xs text-slate-500">
                {CATEGORIES.filter((c) => totals[c] > 0)
                  .map((c) => `${CATEGORY_STYLE[c].label} ${Math.round((totals[c] / totalHours) * 100)}%`)
                  .join(' · ')}
              </p>
              {insights.length > 0 ? (
                <ul className="list-disc space-y-0.5 pl-4 text-xs text-slate-600">
                  {insights.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-slate-500">Nothing stands out in this view.</p>
              )}
            </div>
          )}

          <p className="mt-2 text-[11px] text-slate-400">
            Hours are Taskmandu estimates for tasks due by the end of this week (overdue included); capacity is {capacity}h/week
            (set PM_WEEKLY_CAPACITY_HOURS). Categories come from the Dictionary tab and are a guide, not timesheets.
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

type WorkloadProps = React.ComponentProps<typeof WorkloadView>;

/**
 * Team workload with two subtabs. "Workload" is the existing view, unchanged. "Investigation" is where projects
 * are assigned to developers for review. Investigations are not tasks: they never add to anyone's task count or hours.
 */
export default function TeamWorkload(props: WorkloadProps) {
  const [tab, setTab] = useState<'workload' | 'investigation'>('workload');
  const [inv, setInv] = useState<InvByDeveloper[]>([]);

  // Compact note on the Workload tab: who currently has an investigation (kept separate from task numbers).
  useEffect(() => {
    if (tab !== 'workload') return;
    let live = true;
    pmApi.invByDeveloper().then((r) => live && setInv(r.data.developers)).catch(() => undefined);
    return () => { live = false; };
  }, [tab, props.workload]);

  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5" role="tablist" aria-label="Team workload views">
        <button role="tab" aria-selected={tab === 'workload'} className={btnChip(tab === 'workload')} onClick={() => setTab('workload')}>Workload</button>
        <button role="tab" aria-selected={tab === 'investigation'} className={btnChip(tab === 'investigation')} onClick={() => setTab('investigation')}>Investigation</button>
      </div>
      {tab === 'workload' ? (
        <>
          <WorkloadView {...props} />
          {inv.length > 0 && (
            <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              <span className="font-medium text-slate-700">Active investigations</span> (not counted as task hours):{' '}
              {inv.map((d, i) => (
                <span key={d.name} title={d.projects.join(', ')}>{i > 0 && ' · '}{d.name} {d.active}{d.awaiting_review ? ` (${d.awaiting_review} awaiting review)` : ''}</span>
              ))}
              {' · '}<button className="text-indigo-600 hover:underline" onClick={() => setTab('investigation')}>Open</button>
            </div>
          )}
        </>
      ) : (
        <InvestigationPanel />
      )}
    </div>
  );
}
