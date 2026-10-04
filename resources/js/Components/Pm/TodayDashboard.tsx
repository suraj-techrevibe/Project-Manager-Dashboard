import { useMemo, useState } from 'react';
import { pmApi } from '../../lib/pmApi';
import { setUrlParams } from '../../lib/urlState';
import type { PmFlag, SinceSummary, TaskFocus, WorkloadRow } from '../../types/pm';

type Props = {
  flags: PmFlag[];
  workload: WorkloadRow[];
  since: SinceSummary;
  lastSyncedAt: string | null;
  onOpenTask: (focus: TaskFocus) => void;
};

const flagLabels: Record<PmFlag['type'], string> = {
  overdue: 'Overdue',
  blocked: 'Blocked',
  stuck: 'Stuck',
  due_today: 'Due today',
  due_soon: 'Due soon',
  unassigned: 'Unassigned',
  unverified: 'Verify',
};

const flagTone: Record<PmFlag['type'], string> = {
  overdue: 'bg-red-50 text-red-700 ring-red-200',
  blocked: 'bg-red-50 text-red-700 ring-red-200',
  stuck: 'bg-amber-50 text-amber-700 ring-amber-200',
  due_today: 'bg-amber-50 text-amber-700 ring-amber-200',
  due_soon: 'bg-slate-100 text-slate-700 ring-slate-200',
  unassigned: 'bg-violet-50 text-violet-700 ring-violet-200',
  unverified: 'bg-blue-50 text-blue-700 ring-blue-200',
};

function uniqueCards(flags: PmFlag[]): PmFlag[] {
  const seen = new Set<number>();
  return flags.filter((flag) => {
    if (seen.has(flag.card_id)) return false;
    seen.add(flag.card_id);
    return true;
  });
}

function daysAgo(iso: string | null): number | null {
  if (!iso) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}

function dueText(date: string | null): string {
  if (!date) return 'No due date';
  const due = new Date(`${date}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((due.getTime() - today.getTime()) / 86_400_000);
  if (diff < 0) return `${Math.abs(diff)}d overdue`;
  if (diff === 0) return 'Due today';
  if (diff === 1) return 'Due tomorrow';
  return `Due in ${diff}d`;
}

function firstFlag(card: PmFlag, all: PmFlag[]): PmFlag['type'] {
  const flags = all.filter((f) => f.card_id === card.card_id);
  const order: PmFlag['type'][] = ['overdue', 'blocked', 'stuck', 'due_today', 'due_soon', 'unassigned', 'unverified'];
  return order.find((type) => flags.some((f) => f.type === type)) ?? card.type;
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function loadLevel(row: WorkloadRow): 'high' | 'medium' | 'light' {
  const capacity = row.capacity || 40;
  const hours = row.week_hours ?? row.hours ?? 0;
  if (hours >= capacity) return 'high';
  if (hours >= capacity * 0.75) return 'medium';
  return 'light';
}

export default function TodayDashboard({ flags, workload, since, lastSyncedAt, onOpenTask }: Props) {
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const cards = useMemo(() => uniqueCards(flags), [flags]);
  const critical = useMemo(
    () => cards.filter((card) => flags.some((f) => f.card_id === card.card_id && f.severity === 'danger')).slice(0, 6),
    [cards, flags],
  );
  const atRisk = useMemo(
    () => cards.filter((card) => !critical.some((c) => c.card_id === card.card_id) && flags.some((f) => f.card_id === card.card_id && f.severity === 'warning')).slice(0, 6),
    [cards, critical, flags],
  );

  const counts = useMemo(() => ({
    critical: new Set(flags.filter((f) => f.severity === 'danger').map((f) => f.card_id)).size,
    overdue: new Set(flags.filter((f) => f.type === 'overdue').map((f) => f.card_id)).size,
    dueToday: new Set(flags.filter((f) => f.type === 'due_today').map((f) => f.card_id)).size,
    blocked: new Set(flags.filter((f) => f.type === 'blocked').map((f) => f.card_id)).size,
  }), [flags]);

  const overloaded = useMemo(
    () => workload.filter((row) => loadLevel(row) === 'high').sort((a, b) => (b.week_hours ?? b.hours ?? 0) - (a.week_hours ?? a.hours ?? 0)).slice(0, 5),
    [workload],
  );

  const busyPeople = useMemo(
    () => [...workload].sort((a, b) => (b.week_hours ?? b.hours ?? 0) - (a.week_hours ?? a.hours ?? 0)).slice(0, 5),
    [workload],
  );

  const handleSync = async () => {
    setSyncing(true);
    setSyncMessage(null);
    try {
      const result = await pmApi.sync();
      setSyncMessage(`Synced ${result.data.synced ?? 0} tasks from Taskmandu.`);
      window.location.reload();
    } catch {
      setSyncMessage('Sync failed. Check the Taskmandu connection.');
    } finally {
      setSyncing(false);
    }
  };

  const openProjects = () => setUrlParams({ tab: 'projects', project: null, ptab: null, task: null, sub: null });
  const openMinutes = () => setUrlParams({ tab: 'minutes', project: null, ptab: null, task: null, sub: null, minute: null });
  const openAutomation = () => setUrlParams({ tab: 'automation', project: null, ptab: null, task: null, sub: null });
  const openBrief = () => setUrlParams({ tab: 'brief', project: null, ptab: null, task: null, sub: null });

  const syncLabel = lastSyncedAt
    ? `Last synced ${Math.max(0, Math.floor((Date.now() - new Date(lastSyncedAt).getTime()) / 60_000))} min ago`
    : 'Not synced yet';

  const renderTask = (card: PmFlag, index: number) => {
    const type = firstFlag(card, flags);
    const idle = daysAgo(card.last_activity_at);
    const taskFlags = flags.filter((f) => f.card_id === card.card_id);
    return (
      <div key={card.card_id} className="group rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-300 hover:shadow">
        <div className="flex items-start gap-3">
          <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${type === 'overdue' || type === 'blocked' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
            {index + 1}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate font-semibold text-slate-900">{card.title}</h3>
              {card.priority && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">{card.priority}</span>}
            </div>
            <p className="mt-1 text-sm text-slate-500">
              {card.project_name || 'Standalone task'} {card.assignee ? `· ${card.assignee}` : '· Unassigned'}
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {taskFlags.slice(0, 3).map((flag) => (
                <span key={flag.type} className={`rounded-full px-2 py-1 text-[11px] font-medium ring-1 ring-inset ${flagTone[flag.type]}`}>
                  {flagLabels[flag.type]}
                </span>
              ))}
              <span className="rounded-full bg-slate-50 px-2 py-1 text-[11px] text-slate-500">{dueText(card.due_at)}</span>
              {idle !== null && idle >= 3 && <span className="rounded-full bg-slate-50 px-2 py-1 text-[11px] text-slate-500">{idle}d since activity</span>}
            </div>
          </div>
          <button
            type="button"
            onClick={() => card.project_id && card.task_id ? onOpenTask({ projectId: card.project_id, taskId: card.task_id }) : undefined}
            disabled={!card.project_id || !card.task_id}
            className="shrink-0 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Open
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white px-5 py-5 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-slate-500">{new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-950">{greeting()}</h1>
            <p className="mt-1 text-sm text-slate-500">Here is what needs your attention today.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-400">{syncLabel}</span>
            <button type="button" onClick={handleSync} disabled={syncing} className="rounded-lg bg-slate-900 px-3.5 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50">
              {syncing ? 'Syncing…' : 'Sync now'}
            </button>
          </div>
        </div>
        {syncMessage && <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">{syncMessage}</p>}
      </section>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: 'Critical', value: counts.critical, note: 'needs action', tone: 'border-red-200 bg-red-50 text-red-700' },
          { label: 'Overdue', value: counts.overdue, note: 'past due', tone: 'border-red-200 bg-white text-red-700' },
          { label: 'Due today', value: counts.dueToday, note: 'today', tone: 'border-amber-200 bg-amber-50 text-amber-700' },
          { label: 'Blocked', value: counts.blocked, note: 'waiting to move', tone: 'border-amber-200 bg-white text-amber-700' },
        ].map((item) => (
          <div key={item.label} className={`rounded-xl border p-4 ${item.tone}`}>
            <p className="text-xs font-semibold uppercase tracking-wide opacity-75">{item.label}</p>
            <div className="mt-1 flex items-end gap-2">
              <span className="text-3xl font-bold">{item.value}</span>
              <span className="pb-1 text-xs opacity-70">{item.note}</span>
            </div>
          </div>
        ))}
      </section>

      <section>
        <div className="mb-3 flex items-end justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900">Needs your attention</h2>
            <p className="text-xs text-slate-500">The most important tasks first.</p>
          </div>
          {critical.length === 0 && <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">Nothing critical</span>}
        </div>
        <div className="space-y-3">
          {critical.map(renderTask)}
          {critical.length === 0 && <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500">No critical tasks right now. Check At risk below for items that need monitoring.</div>}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="font-bold text-slate-900">At risk</h2>
              <p className="text-xs text-slate-500">Due soon, stuck, or otherwise drifting.</p>
            </div>
            <button type="button" onClick={openProjects} className="text-xs font-semibold text-slate-700 hover:underline">View projects</button>
          </div>
          <div className="space-y-2">
            {atRisk.slice(0, 5).map((card) => (
              <button
                key={card.card_id}
                type="button"
                onClick={() => card.project_id && card.task_id && onOpenTask({ projectId: card.project_id, taskId: card.task_id })}
                className="flex w-full items-center gap-3 rounded-lg border border-slate-100 p-3 text-left hover:bg-slate-50"
              >
                <span className="h-2 w-2 shrink-0 rounded-full bg-amber-400" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">{card.title}</span>
                <span className="shrink-0 text-xs text-slate-500">{card.project_name || 'Standalone'}</span>
              </button>
            ))}
            {!atRisk.length && <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-500">No at-risk tasks detected.</p>}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="font-bold text-slate-900">Team load</h2>
              <p className="text-xs text-slate-500">Who may need help this week.</p>
            </div>
            <button type="button" onClick={openBrief} className="text-xs font-semibold text-slate-700 hover:underline">Assign work</button>
          </div>
          <div className="space-y-3">
            {busyPeople.map((row) => {
              const capacity = row.capacity || 40;
              const hours = row.week_hours ?? row.hours ?? 0;
              const pct = Math.min(100, Math.round((hours / capacity) * 100));
              const level = loadLevel(row);
              return (
                <div key={row.name}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-slate-800">{row.name}</span>
                    <span className={level === 'high' ? 'font-semibold text-red-600' : level === 'medium' ? 'font-semibold text-amber-600' : 'text-slate-500'}>{hours.toFixed(1)}h / {capacity}h</span>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100">
                    <div className={`h-full rounded-full ${level === 'high' ? 'bg-red-500' : level === 'medium' ? 'bg-amber-400' : 'bg-slate-400'}`} style={{ width: `${pct}%` }} />
                  </div>
                  <p className="mt-1 text-[11px] text-slate-400">{row.open} open{row.overdue ? ` · ${row.overdue} overdue` : ''}{row.blocked ? ` · ${row.blocked} blocked` : ''}</p>
                </div>
              );
            })}
            {!busyPeople.length && <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-500">No workload data yet. Sync from Taskmandu first.</p>}
          </div>
          {overloaded.length > 0 && <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700">{overloaded.length} team member{overloaded.length === 1 ? '' : 's'} at or above weekly capacity.</p>}
        </section>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="font-bold text-slate-900">Since last workday</h2>
            <p className="text-xs text-slate-500">{since.tracked ? `Changes since ${since.label}.` : 'Activity tracking starts after the first sync.'}</p>
          </div>
          <button type="button" onClick={openAutomation} className="text-xs font-semibold text-slate-700 hover:underline">Automation</button>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            { label: 'Completed', value: since.completed.count, tone: 'text-emerald-700 bg-emerald-50' },
            { label: 'Created', value: since.created.count, tone: 'text-blue-700 bg-blue-50' },
            { label: 'Blocked', value: since.blocked.count, tone: 'text-red-700 bg-red-50' },
            { label: 'Became overdue', value: since.overdue.count, tone: 'text-amber-700 bg-amber-50' },
          ].map((item) => (
            <div key={item.label} className={`rounded-lg px-3 py-3 ${item.tone}`}>
              <div className="text-2xl font-bold">{item.value}</div>
              <div className="mt-0.5 text-xs font-medium">{item.label}</div>
            </div>
          ))}
        </div>
        {since.idle.length > 0 && (
          <p className="mt-3 text-xs text-slate-500">{since.idle.length} task{since.idle.length === 1 ? '' : 's'} reported as idle since the last workday.</p>
        )}
      </section>

      <section>
        <div className="mb-3">
          <h2 className="text-base font-bold text-slate-900">Quick actions</h2>
          <p className="text-xs text-slate-500">Jump straight to the work you normally do.</p>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: 'Projects', hint: 'Health & tasks', action: openProjects },
            { label: 'Meeting minutes', hint: 'Actions & follow-ups', action: openMinutes },
            { label: 'Automation', hint: 'Nudges & rules', action: openAutomation },
            { label: 'Brief to tickets', hint: 'Create new work', action: openBrief },
          ].map((item) => (
            <button key={item.label} type="button" onClick={item.action} className="rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm hover:border-slate-300 hover:bg-slate-50">
              <div className="text-sm font-semibold text-slate-900">{item.label}</div>
              <div className="mt-1 text-xs text-slate-500">{item.hint}</div>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
