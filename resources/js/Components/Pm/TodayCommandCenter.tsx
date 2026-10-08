import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { Employee, PmFlag, Project, Severity, SinceItem, SinceSummary, SubtaskFlag, TaskFocus, WorkloadRow } from '../../types/pm';
import SinceStrip from './SinceStrip';
import TeamWorkload, { levelOf } from './TeamWorkload';

/* ------------------------------------------------------------------ */
/* The top half of the Today tab: what a PM should look at, in order.   */
/* Purely presentational — FlagsPanel owns the data and the actions.    */
/* ------------------------------------------------------------------ */

type FlagType = PmFlag['type'];

/** Same shape as FlagsPanel's TaskCard (one card per task, with all its flags). */
export interface CcCard {
  card_id: number;
  task: PmFlag;
  flags: PmFlag[];
  severity: Severity;
}

export interface CcAnswer {
  key: string;
  label: string;
  /** One-line answer to the question, from the synced board. */
  text: string;
  /** How many things need attention for this question (0 = all clear). */
  count: number;
}

export interface RiskProject {
  id: string;
  name: string;
  score: number;
  overdue: number;
  blocked: number;
  stuck: number;
  flags: number;
}

type Tone = 'red' | 'orange' | 'amber' | 'blue' | 'violet' | 'teal' | 'emerald' | 'rose' | 'indigo' | 'slate';

// Every class is written out in full so Tailwind can see it.
const TONES: Record<Tone, { tile: string; num: string; chip: string; dot: string; panel: string; head: string; btn: string; ring: string }> = {
  red: { tile: 'border-red-200 bg-red-50 hover:bg-red-100/70', num: 'text-red-600', chip: 'bg-red-100 text-red-700', dot: 'bg-red-500', panel: 'border-red-200 bg-red-50/40', head: 'text-red-800', btn: 'bg-red-600 text-white hover:bg-red-700', ring: 'ring-red-400' },
  orange: { tile: 'border-orange-200 bg-orange-50 hover:bg-orange-100/70', num: 'text-orange-600', chip: 'bg-orange-100 text-orange-700', dot: 'bg-orange-500', panel: 'border-orange-200 bg-orange-50/40', head: 'text-orange-800', btn: 'bg-orange-600 text-white hover:bg-orange-700', ring: 'ring-orange-400' },
  amber: { tile: 'border-amber-200 bg-amber-50 hover:bg-amber-100/70', num: 'text-amber-600', chip: 'bg-amber-100 text-amber-700', dot: 'bg-amber-500', panel: 'border-amber-200 bg-amber-50/40', head: 'text-amber-800', btn: 'bg-amber-600 text-white hover:bg-amber-700', ring: 'ring-amber-400' },
  blue: { tile: 'border-sky-200 bg-sky-50 hover:bg-sky-100/70', num: 'text-sky-600', chip: 'bg-sky-100 text-sky-700', dot: 'bg-sky-500', panel: 'border-sky-200 bg-sky-50/40', head: 'text-sky-800', btn: 'bg-sky-600 text-white hover:bg-sky-700', ring: 'ring-sky-400' },
  violet: { tile: 'border-violet-200 bg-violet-50 hover:bg-violet-100/70', num: 'text-violet-600', chip: 'bg-violet-100 text-violet-700', dot: 'bg-violet-500', panel: 'border-violet-200 bg-violet-50/40', head: 'text-violet-800', btn: 'bg-violet-600 text-white hover:bg-violet-700', ring: 'ring-violet-400' },
  teal: { tile: 'border-teal-200 bg-teal-50 hover:bg-teal-100/70', num: 'text-teal-600', chip: 'bg-teal-100 text-teal-700', dot: 'bg-teal-500', panel: 'border-teal-200 bg-teal-50/40', head: 'text-teal-800', btn: 'bg-teal-600 text-white hover:bg-teal-700', ring: 'ring-teal-400' },
  emerald: { tile: 'border-emerald-200 bg-emerald-50 hover:bg-emerald-100/70', num: 'text-emerald-600', chip: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500', panel: 'border-emerald-200 bg-emerald-50/40', head: 'text-emerald-800', btn: 'bg-emerald-600 text-white hover:bg-emerald-700', ring: 'ring-emerald-400' },
  rose: { tile: 'border-rose-200 bg-rose-50 hover:bg-rose-100/70', num: 'text-rose-600', chip: 'bg-rose-100 text-rose-700', dot: 'bg-rose-500', panel: 'border-rose-200 bg-rose-50/40', head: 'text-rose-800', btn: 'bg-rose-600 text-white hover:bg-rose-700', ring: 'ring-rose-400' },
  indigo: { tile: 'border-indigo-200 bg-indigo-50 hover:bg-indigo-100/70', num: 'text-indigo-600', chip: 'bg-indigo-100 text-indigo-700', dot: 'bg-indigo-500', panel: 'border-indigo-200 bg-indigo-50/40', head: 'text-indigo-800', btn: 'bg-indigo-600 text-white hover:bg-indigo-700', ring: 'ring-indigo-400' },
  slate: { tile: 'border-slate-200 bg-slate-50 hover:bg-slate-100', num: 'text-slate-700', chip: 'bg-slate-100 text-slate-600', dot: 'bg-slate-400', panel: 'border-slate-200 bg-white', head: 'text-slate-800', btn: 'bg-slate-800 text-white hover:bg-slate-900', ring: 'ring-slate-400' },
};

/* ---------------- small helpers ---------------- */

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function idleDays(iso: string | null): number | null {
  return iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)) : null;
}

function agoText(iso: string | null): string {
  if (!iso) return 'never';
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  return hrs < 24 ? `${hrs}h ago` : `${Math.floor(hrs / 24)}d ago`;
}

function dueText(date: string | null): { text: string; late: boolean } {
  if (!date) return { text: 'No due date', late: false };
  const due = new Date(`${date}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((due.getTime() - today.getTime()) / 86_400_000);
  const pretty = due.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  if (diff < 0) return { text: `${-diff}d overdue · ${pretty}`, late: true };
  if (diff === 0) return { text: `Due today`, late: false };
  if (diff === 1) return { text: `Due tomorrow`, late: false };
  return { text: `Due ${pretty}`, late: false };
}

const hasFlag = (c: CcCard, t: FlagType) => c.flags.some((f) => f.type === t);
const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

/* ---------------- building blocks ---------------- */

function Panel({ id, tone, title, sub, badge, action, children }: { id?: string; tone: Tone; title: string; sub?: string; badge?: ReactNode; action?: ReactNode; children: ReactNode }) {
  const t = TONES[tone];
  const [open, setOpen] = useState(true);
  return (
    <section id={id} className={`scroll-mt-4 rounded-[1.75rem] border p-6 shadow-md shadow-slate-200/40 ${t.panel}`}>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <button type="button" onClick={() => setOpen((v) => !v)} className="text-left">
            <h3 className={`flex items-center gap-2 text-lg font-semibold ${t.head}`}>
              <span className={`h-2.5 w-2.5 rounded-full ${t.dot}`} />
              {title}
              {badge}
              <span className="ml-1 text-xs text-slate-400">{open ? '▾' : '▸'}</span>
            </h3>
            {sub && <p className="mt-0.5 text-sm text-slate-500">{sub}</p>}
          </button>
        </div>
        {action}
      </div>
      {open && children}
    </section>
  );
}

function CollapsibleSection({ id, title, sub, children }: { id?: string; title: string; sub?: string; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <section id={id} className="scroll-mt-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <button type="button" onClick={() => setOpen((v) => !v)} className="mb-4 w-full text-left">
        <h3 className="flex items-center gap-2 text-xl font-semibold text-slate-900">
          {title}<span className="text-xs text-slate-400">{open ? '▾' : '▸'}</span>
        </h3>
        {sub && <p className="mt-0.5 text-sm text-slate-500">{sub}</p>}
      </button>
      {open && children}
    </section>
  );
}

function LinkButton({ children, onClick, tone = 'slate' }: { children: ReactNode; onClick: () => void; tone?: Tone }) {
  return (
    <button onClick={onClick} className={`rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium hover:bg-slate-50 ${TONES[tone].head}`}>
      {children}
    </button>
  );
}

function Count({ n, tone }: { n: number; tone: Tone }) {
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${n ? TONES[tone].chip : 'bg-slate-100 text-slate-400'}`}>{n}</span>;
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-slate-200 bg-white/70 px-4 py-6 text-center text-sm text-slate-500">{children}</div>;
}

function TaskRow({ c, onOpen, onNudge, extra, compact }: { c: CcCard; onOpen: () => void; onNudge?: () => void; extra?: string; compact?: boolean }) {
  const t = c.task;
  const due = dueText(t.due_at);
  const canOpen = Boolean((t.project_id && t.task_id) || t.url);

  // Narrow columns: title gets the full width, buttons sit underneath.
  if (compact) {
    return (
      <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
        <div className="text-[15px] font-medium leading-snug text-slate-900">{t.title}</div>
        <div className="mt-1.5 text-xs text-slate-500">
          <span className="font-medium text-slate-600">{t.project_name ?? 'Standalone'}</span> · {t.assignee ?? 'Unassigned'}
        </div>
        <div className={`text-xs ${due.late && !extra ? 'font-semibold text-red-600' : 'text-slate-500'}`}>{extra ?? due.text}</div>
        <div className="mt-3 flex gap-2">
          <button onClick={onOpen} disabled={!canOpen} className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-40">
            Open →
          </button>
          {onNudge && t.assignee && (
            <button onClick={onNudge} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50" title="Copy a ready-to-send check-in message">
              Nudge
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-white p-3.5 shadow-sm">
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-medium text-slate-900">{t.title}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
          <span className="font-medium text-slate-600">{t.project_name ?? 'Standalone'}</span>
          <span>·</span>
          <span>{t.assignee ?? 'Unassigned'}</span>
          <span>·</span>
          <span className={due.late && !extra ? 'font-semibold text-red-600' : ''}>{extra ?? due.text}</span>
        </div>
      </div>
      {onNudge && t.assignee && (
        <button onClick={onNudge} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50" title="Copy a ready-to-send check-in message">
          Nudge
        </button>
      )}
      <button onClick={onOpen} disabled={!canOpen} className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-40">
        Open →
      </button>
    </div>
  );
}

function AssignRow({ title, meta, staff, onOpen, onAssign }: { title: string; meta: string; staff: Employee[]; onOpen: () => void; onAssign: (employeeId: string) => void }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-white p-3.5 shadow-sm">
      <button onClick={onOpen} className="min-w-0 flex-1 text-left">
        <div className="truncate text-[15px] font-medium text-slate-900">{title}</div>
        <div className="truncate text-xs text-slate-500">{meta}</div>
      </button>
      <select defaultValue="" onChange={(e) => e.target.value && onAssign(e.target.value)} className="max-w-44 rounded-lg border border-violet-200 bg-white px-2 py-1.5 text-xs">
        <option value="">Assign to…</option>
        {staff.map((s) => (
          <option key={s.employeeId} value={s.employeeId}>
            {s.name}
            {typeof s.open === 'number' ? ` · ${s.open} open` : ''}
          </option>
        ))}
      </select>
    </div>
  );
}

/* ---------------- the checklist ---------------- */

interface CheckItem {
  key: string; // matches a CcAnswer key
  tone: Tone;
  title: string;
  why: string;
  /** Where the secondary button goes: another tab, or a section further down this page. */
  go?: { label: string; tab?: string; section?: string };
  /** Free-capacity rows are good news, not a problem to clear. */
  positive?: boolean;
}

// Ascending order of importance: what hurts delivery most comes first.
const CHECKLIST: CheckItem[] = [
  { key: 'overdue', tone: 'red', title: 'Clear what is overdue', why: 'Late work is already costing you.', go: { label: 'Open Projects', tab: 'projects' } },
  { key: 'blocking', tone: 'orange', title: 'Unblock blocked tasks', why: 'Someone is waiting on a decision from you.', go: { label: 'Open Projects', tab: 'projects' } },
  { key: 'duesoon', tone: 'blue', title: 'Check what is due today and in 3 days', why: 'Catch slips before they become overdue.', go: { label: 'Act now list', section: 'act-now' } },
  { key: 'unowned', tone: 'violet', title: 'Give every task an owner', why: 'No owner means nobody is working on it.', go: { label: 'Assign now', section: 'no-owner' } },
  { key: 'stuck', tone: 'amber', title: 'Move work that has stopped', why: 'No movement in 3+ days.', go: { label: 'See stalled', section: 'stalled' } },
  { key: 'unverified', tone: 'teal', title: 'Verify finished work', why: 'Done is not delivered until you have checked it.', go: { label: 'Open Projects', tab: 'projects' } },
  { key: 'overloaded', tone: 'rose', title: 'Rebalance overloaded people', why: 'Overloaded people cause the next round of delays.', go: { label: 'Team capacity', section: 'capacity' } },
  { key: 'free', tone: 'emerald', title: 'Hand work to people with room', why: 'Idle capacity is free delivery.', go: { label: 'Team capacity', section: 'capacity' }, positive: true },
  { key: 'worst', tone: 'indigo', title: 'Review the riskiest project', why: 'Most flagged tasks sit here.', go: { label: 'Project risk', section: 'project-risk' } },
];

/* ---------------- the component ---------------- */

export interface CommandCenterProps {
  counts: Record<FlagType, number>;
  workload: WorkloadRow[];
  overloadAt: number;
  cards: CcCard[];
  riskProjects: RiskProject[];
  waitingCards: CcCard[];
  agingCards: CcCard[];
  unassignedTasks: CcCard[];
  unassignedSubtasks: SubtaskFlag[];
  staff: Employee[];
  since?: SinceSummary;
  timelineProjects: Project[];
  projectsLoading: boolean;

  lastSynced: string | null;
  stale: boolean;
  syncing: boolean;
  syncNotice: boolean;
  onSync: () => void;
  showDigest: boolean;
  digestText: string | null;
  digestLoading: boolean;
  onToggleDigest: () => void;
  onCopyStandup: () => void;
  pinCount: number;
  maxPins: number;
  pinnedOnly: boolean;
  onTogglePinned: () => void;

  answers: CcAnswer[];
  activeKey: string | null;
  onAsk: (key: string) => void;
  onClearAsk: () => void;

  onFilter: (t: FlagType) => void;
  onShowTaskList: (filter: string) => void;
  onOpenCard: (c: CcCard) => void;
  onNudgeCard: (c: CcCard) => void;
  onOpenTask: (f: TaskFocus) => void;
  onAssignTask: (c: CcCard, employeeId: string) => void;
  onAssignSubtask: (id: number, employeeId: string) => void;
  onOpenSince: (it: SinceItem) => void;
  onShowFree: () => void;
  onPickPerson: (name: string) => void;
  onNavigate?: (tab: string) => void;
  onOpenProject?: (projectId: string) => void;
  subtaskSummary: { total:number; completed:number; remaining:number; progress:number };
}

export default function TodayCommandCenter(p: CommandCenterProps) {
  const { counts } = p;
  const noOwner = counts.unassigned + p.unassignedSubtasks.length;
  const attention = counts.overdue + counts.blocked + counts.due_today + counts.subtasks_incomplete + noOwner;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

  const overdue = p.cards.filter((c) => hasFlag(c, 'overdue'));
  const blocked = p.cards.filter((c) => hasFlag(c, 'blocked'));
  const dueToday = p.cards.filter((c) => hasFlag(c, 'due_today'));
  const unverified = p.cards.filter((c) => hasFlag(c, 'unverified'));

  const openTasks = p.workload.reduce((n, w) => n + w.open, 0);
  const weekHours = p.workload.reduce((n, w) => n + (w.week_hours ?? 0), 0);
  const free = p.workload.filter((w) => w.open === 0);
  const over = p.workload.filter((w) => levelOf(w, p.overloadAt) === 'over');
  const active = CHECKLIST.find((i) => i.key === p.activeKey);
  const [checklistOpen, setChecklistOpen] = useState(true);
  const activeAnswer = p.answers.find((a) => a.key === p.activeKey);

  useEffect(() => {
    if (!p.showDigest) return;
    requestAnimationFrame(() => {
      document.getElementById('morning-digest')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, [p.showDigest]);

  const goTo = (item: CheckItem) => {
    if (item.go?.tab) p.onNavigate?.(item.go.tab);
    else if (item.go?.section) jump(item.go.section);
  };

  const KPIS: { key: FlagType; label: string; hint: string; tone: Tone; value: number }[] = [
    { key: 'overdue', label: 'Overdue', hint: 'Past the due date', tone: 'red', value: counts.overdue },
    { key: 'blocked', label: 'Blocked', hint: 'Waiting on a decision', tone: 'orange', value: counts.blocked },
    { key: 'due_today', label: 'Due today', hint: 'Finish by end of day', tone: 'blue', value: counts.due_today },
    { key: 'stuck', label: 'Stuck 3+ days', hint: 'No movement', tone: 'amber', value: counts.stuck },
    { key: 'unassigned', label: 'No owner', hint: 'Nobody assigned', tone: 'violet', value: noOwner },
    { key: 'unverified', label: 'To verify', hint: 'Done, not yet checked', tone: 'teal', value: counts.unverified },
    { key: 'subtasks_incomplete', label: 'Incomplete subtasks', hint: 'Parent task marked done', tone: 'rose', value: counts.subtasks_incomplete },
  ];

  const links: { label: string; tab: string }[] = [
    { label: 'Projects', tab: 'projects' },
    { label: 'Meeting minutes', tab: 'minutes' },
    { label: 'Brief to tickets', tab: 'brief' },
    { label: 'Reports', tab: 'reports' },
    { label: 'Scope check', tab: 'scope' },
    { label: 'Git', tab: 'git' },
  ];

  return (
    <div className="space-y-6 rounded-[2rem] bg-slate-50/80 p-1 sm:p-2">
      {/* ===== 1. Hero ===== */}
      <section className="relative isolate overflow-hidden rounded-[2rem] border border-white/10 bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 p-7 text-white shadow-xl shadow-slate-900/10 sm:p-9">
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-indigo-500/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-28 left-1/3 h-64 w-64 rounded-full bg-cyan-400/10 blur-3xl" />
        <div className="relative">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="max-w-3xl">
            <div className="text-xs font-semibold uppercase tracking-widest text-indigo-200">Command center · {today}</div>
            <h2 className="mt-2 text-3xl font-bold leading-tight sm:text-4xl">
              {greeting}.{' '}
              {attention
                ? `${plural(attention, 'thing')} need${attention === 1 ? 's' : ''} you first.`
                : 'The board is under control.'}
            </h2>
            <p className="mt-2 text-sm text-slate-300">
              {attention
                ? `${counts.overdue} overdue · ${counts.blocked} blocked · ${counts.due_today} due today · ${noOwner} without an owner. Work the checklist below from 1 down.`
                : 'Nothing is overdue, blocked or unowned. Use the time to check capacity and upcoming work.'}
            </p>
          </div>
          <div className="flex flex-col items-start gap-2 sm:items-end">
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={p.onSync} disabled={p.syncing} className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-slate-900 shadow hover:bg-slate-100 disabled:opacity-60">
                {p.syncing ? 'Syncing…' : 'Sync now'}
              </button>
              <button onClick={p.onCopyStandup} className="rounded-xl border border-white/30 px-4 py-2 text-sm font-medium text-white hover:bg-white/10">
                Copy stand-up
              </button>
              <button onClick={p.onToggleDigest} className={`rounded-xl border px-4 py-2 text-sm font-medium ${p.showDigest ? 'border-white bg-white text-slate-900' : 'border-white/30 text-white hover:bg-white/10'}`}>
                Morning digest
              </button>
              {p.pinCount > 0 && (
                <button onClick={p.onTogglePinned} className={`rounded-xl border px-4 py-2 text-sm font-medium ${p.pinnedOnly ? 'border-amber-300 bg-amber-300 text-slate-900' : 'border-white/30 text-white hover:bg-white/10'}`}>
                  ★ Focus ({p.pinCount}/{p.maxPins})
                </button>
              )}
            </div>
            <div className={`text-xs ${p.stale ? 'font-semibold text-amber-300' : 'text-slate-300'}`}>
              {p.syncNotice && p.syncing && <div className="mb-1 text-xs font-medium text-amber-200">Sync is taking longer than usual…</div>}
              {p.lastSynced ? `Last synced ${agoText(p.lastSynced)}` : 'Not synced from this app yet'}
              {p.stale && ' — data may be out of date'}
            </div>
          </div>
        </div>

        <div className="mt-6 border-t border-white/10 pt-5">
          <div className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-400">Board snapshot</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {[
              { label: 'Open tasks', value: String(openTasks), sub: `across ${plural(p.workload.length, 'person', 'people')}`, filter: 'open' },
              { label: 'Planned this week', value: `${Math.round(weekHours)}h`, sub: 'due by end of week', filter: 'due_soon' },
              { label: 'Free people', value: String(free.length), sub: free.length ? free.slice(0, 2).map((w) => w.name.split(' ')[0]).join(', ') : 'everyone has work', filter: 'free' },
              { label: 'Overloaded', value: String(over.length), sub: over.length ? over.slice(0, 2).map((w) => w.name.split(' ')[0]).join(', ') : 'nobody', filter: 'overloaded' },
              { label: p.since ? `Done since ${p.since.label}` : 'Done recently', value: String(p.since?.completed.count ?? 0), sub: p.since?.tracked ? `${p.since.created.count} new tasks` : 'fills in after 2nd sync', filter: 'done_since' },
            ].map((m) => (
              <button key={m.label} type="button" onClick={() => p.onShowTaskList(m.filter)} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left transition hover:bg-white/10">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{m.label}</div>
                <div className="mt-0.5 text-2xl font-bold tabular-nums text-white">{m.value}</div>
                <div className="truncate text-[11px] text-slate-400">{m.sub}</div>
                <div className="mt-1 text-[10px] font-semibold text-indigo-200">View filtered tasks →</div>
              </button>
            ))}
          </div>
        </div>

        {/* Redirect buttons */}
        <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-white/10 pt-5">
          <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Go to</span>
          {links.map((l) => (
            <button key={l.tab} onClick={() => p.onNavigate?.(l.tab)} className="rounded-full bg-white/10 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-white/20">
              {l.label} →
            </button>
          ))}
        </div>
        </div>
      </section>

      {/* ===== 2. Big numbers ===== */}
      <CollapsibleSection title="Today at a glance" sub="Click any metric to open its relevant task list.">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
          {KPIS.map((k) => {
            const t = TONES[k.tone];
            return (
              <button key={k.key} onClick={() => p.onShowTaskList(k.key)} className={`rounded-3xl border p-5 text-left transition duration-200 hover:-translate-y-0.5 ${k.value ? `${t.tile} shadow-md` : 'border-slate-200 bg-white/90 shadow-sm'} ${k.value && (k.key === 'overdue' || k.key === 'blocked') ? 'ring-1 ring-red-200 shadow-lg' : ''}`}>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                    {k.label}
                    {k.value > 0 && (k.key === 'overdue' || k.key === 'blocked') && <span className="rounded-full bg-red-100 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-red-700">Action</span>}
                  </span>
                  <span className={`h-2.5 w-2.5 rounded-full ${k.value ? t.dot : 'bg-emerald-400'}`} />
                </div>
                <div className={`mt-3 text-5xl font-bold tabular-nums sm:text-6xl ${k.value ? t.num : 'text-slate-300'}`}>{k.value}</div>
                <div className="mt-2 text-xs text-slate-500">{k.value ? k.hint : 'All clear ✓'}</div>
                {k.value > 0 && <div className={`mt-0.5 text-xs font-semibold ${t.num}`}>View tasks →</div>}
              </button>
            );
          })}
        </div>
      </CollapsibleSection>

      {p.showDigest && (
        <section id="morning-digest" className="scroll-mt-20 rounded-3xl border border-indigo-200 bg-indigo-50 p-5 shadow-sm sm:p-6">
          <h3 className="text-xl font-semibold text-indigo-950">Morning digest</h3>
          <p className="mt-1 text-sm text-indigo-700">
            {p.digestLoading ? 'Generating your stand-up summary…' : 'Generated stand-up summary.'}
          </p>
          <div className="mt-4 min-h-20 rounded-2xl border border-indigo-100 bg-white/70 p-4">
            {p.digestLoading ? (
              <div className="flex items-center gap-3 text-sm font-medium text-indigo-700">
                <span className="h-5 w-5 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-600" aria-hidden="true" />
                Loading morning digest…
              </div>
            ) : p.digestText ? (
              <div className="whitespace-pre-wrap text-sm leading-6 text-slate-700">{p.digestText}</div>
            ) : (
              <div className="text-sm text-slate-500">No digest could be generated.</div>
            )}
          </div>
        </section>
      )}

      {/* ===== 3. Sub-task progress ===== */}
      {p.subtaskSummary.total > 0 && (
        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-xl font-semibold text-slate-900">Sub-task progress</h3>
              <p className="mt-0.5 text-sm text-slate-500">Completion is read directly from Taskmandu sub-task status.</p>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold text-slate-900">{p.subtaskSummary.completed}/{p.subtaskSummary.total}</div>
              <div className="text-xs text-slate-500">{p.subtaskSummary.progress}% complete · {p.subtaskSummary.remaining} remaining</div>
            </div>
          </div>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-emerald-500" style={{ width: p.subtaskSummary.progress + '%' }} />
          </div>
        </section>
      )}

      {/* ===== 4. PM checklist (ordered) ===== */}
      <section id="pm-checklist" className="scroll-mt-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-7">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <button type="button" onClick={() => setChecklistOpen((v) => !v)} className="text-left"><h3 className="text-xl font-semibold text-slate-900">Your checklist · work it from 1 down <span className="ml-1 text-sm text-slate-400">{checklistOpen ? "▾" : "▸"}</span></h3></button>
            <p className="mt-0.5 text-sm text-slate-500">Each line is a question. Press <b>Show tasks</b> to filter the list below to the answer.</p>
          </div>
          {p.activeKey && (
            <button onClick={p.onClearAsk} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
              Clear question ✕
            </button>
          )}
        </div>

        {checklistOpen && <ol className="space-y-3">
          {CHECKLIST.map((item, i) => {
            const a = p.answers.find((x) => x.key === item.key);
            if (!a) return null;
            const t = TONES[item.tone];
            const clear = !item.positive && a.count === 0;
            const isActive = p.activeKey === item.key;
            return (
              <li key={item.key} className={`flex flex-wrap items-center gap-4 rounded-2xl border p-4 transition ${isActive ? `bg-white ring-2 ${t.ring} ${t.panel}` : clear ? 'border-slate-100 bg-slate-50/60' : t.panel}`}>
                <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-lg font-bold ${clear ? 'bg-emerald-100 text-emerald-600' : `${t.chip}`}`}>{clear ? '✓' : i + 1}</div>
                <div className="min-w-0 flex-1 basis-64">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`text-base font-semibold ${clear ? 'text-slate-500' : 'text-slate-900'}`}>{item.title}</span>
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${clear ? 'bg-emerald-100 text-emerald-700' : t.chip}`}>
                      {clear ? 'All clear' : item.positive ? `${a.count} available` : a.count}
                    </span>
                  </div>
                  <div className="mt-0.5 text-sm text-slate-500">{clear ? a.text : `${item.why} ${a.text}`}</div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {item.go && (
                    <button onClick={() => p.onShowTaskList(item.key)} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
                      {item.go.label} →
                    </button>
                  )}
                  <button onClick={() => (isActive ? p.onClearAsk() : p.onShowTaskList(item.key))} className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold ${isActive ? 'bg-slate-900 text-white' : t.btn}`}>
                    {isActive ? 'Showing ✓' : 'Show tasks'}
                  </button>
                </div>
              </li>
            );
          })}
        </ol>}

        {checklistOpen && active && activeAnswer && (
          <div className={`mt-4 rounded-2xl border p-4 text-sm ${TONES[active.tone].panel}`}>
            <b className={TONES[active.tone].head}>{active.title}:</b> {activeAnswer.text}{' '}
            <button onClick={() => jump('task-list')} className="font-semibold text-slate-900 underline">
              Jump to the list ↓
            </button>
          </div>
        )}
      </section>

      {/* ===== 4. Act now ===== */}
      <CollapsibleSection id="act-now" title="Act now" sub="Open the task list with the correct filter.">
        <div className="grid gap-3 md:grid-cols-3">
          {[
            { title: 'Overdue', tone: 'red' as Tone, count: counts.overdue, text: 'Past the due date.', filter: 'overdue' },
            { title: 'Blocked', tone: 'orange' as Tone, count: counts.blocked, text: 'Waiting on something before it can move.', filter: 'blocked' },
            { title: 'Due today', tone: 'blue' as Tone, count: counts.due_today, text: 'Finish by end of day.', filter: 'due_today' },
          ].map((item) => {
            const t = TONES[item.tone];
            return <button key={item.title} onClick={() => p.onShowTaskList(item.filter)} className={`rounded-2xl border p-5 text-left transition hover:-translate-y-0.5 ${t.panel} hover:shadow-md`}>
              <div className={`text-sm font-semibold ${t.head}`}>{item.title}</div>
              <div className={`mt-1 text-4xl font-bold ${t.num}`}>{item.count}</div>
              <div className="mt-1 text-sm text-slate-500">{item.text}</div>
              <div className={`mt-3 text-xs font-semibold ${t.head}`}>View filtered tasks →</div>
            </button>;
          })}
        </div>
      </CollapsibleSection>

      {/* ===== 5. Stalled + waiting on client ===== */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel
          id="stalled"
          tone="amber"
          title="Stalled work"
          sub="Open tasks with no movement for 3+ days."
          badge={<Count n={p.agingCards.length} tone="amber" />}
          action={p.agingCards.length > 5 ? <LinkButton tone="amber" onClick={() => p.onFilter('stuck')}>View all →</LinkButton> : undefined}
        >
          <div className="space-y-2.5">
            {p.agingCards.length ? (
              p.agingCards.slice(0, 5).map((c) => <TaskRow key={c.card_id} c={c} extra={`${idleDays(c.task.last_activity_at) ?? '—'}d idle`} onOpen={() => p.onOpenCard(c)} onNudge={() => p.onNudgeCard(c)} />)
            ) : (
              <Empty>Nothing has stopped moving ✓</Empty>
            )}
          </div>
        </Panel>

        <Panel id="waiting" tone="blue" title="Waiting on client / approval" sub="Tasks whose text mentions waiting, feedback or approval." badge={<Count n={p.waitingCards.length} tone="blue" />}>
          <div className="space-y-2.5">
            {p.waitingCards.length ? p.waitingCards.slice(0, 5).map((c) => <TaskRow key={c.card_id} c={c} onOpen={() => p.onOpenCard(c)} />) : <Empty>Nothing looks client-blocked ✓</Empty>}
          </div>
        </Panel>
      </div>

      {/* ===== 6. No owner ===== */}
      <Panel
        id="no-owner"
        tone="violet"
        title="No owner"
        sub="Assign these right here — no hunting through lists."
        badge={<Count n={noOwner} tone="violet" />}
        action={p.unassignedTasks.length > 5 ? <LinkButton tone="violet" onClick={() => p.onFilter('unassigned')}>View all →</LinkButton> : undefined}
      >
        <div className="grid gap-2.5 lg:grid-cols-2">
          {p.unassignedTasks.slice(0, 6).map((c) => (
            <AssignRow
              key={c.card_id}
              title={c.task.title}
              meta={c.task.project_name ?? 'Standalone'}
              staff={p.staff}
              onOpen={() => p.onOpenCard(c)}
              onAssign={(id) => p.onAssignTask(c, id)}
            />
          ))}
          {p.unassignedSubtasks.slice(0, 6).map((s) => (
            <AssignRow
              key={`s${s.id}`}
              title={s.title}
              meta={`${s.project_name} · sub-task of ${s.parent_title}`}
              staff={p.staff}
              onOpen={() => p.onOpenTask({ projectId: s.project_id, taskId: s.task_id, subId: s.subtask_id })}
              onAssign={(id) => p.onAssignSubtask(s.id, id)}
            />
          ))}
        </div>
        {noOwner === 0 && <Empty>Everything has an owner ✓</Empty>}
      </Panel>

      {/* ===== 7. Capacity ===== */}
      <Panel
        id="capacity"
        tone="emerald"
        title="Team capacity"
        sub="Who is overloaded, and who can take more? Click a person to filter the list to them."
        action={<LinkButton tone="emerald" onClick={() => p.onNavigate?.('projects')}>Open Projects →</LinkButton>}
      >
        <div id="team-workload" className="scroll-mt-4">
          <div className="mb-4 flex flex-wrap gap-2">
            {free.map((w) => (
              <button key={w.name} onClick={() => p.onPickPerson(w.name)} className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-200">
                {w.name} · free
              </button>
            ))}
            {over.map((w) => (
              <button key={w.name} onClick={() => p.onPickPerson(w.name)} className="rounded-full bg-rose-100 px-3 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-200">
                {w.name} · overloaded ({w.open})
              </button>
            ))}
            {!free.length && !over.length && <span className="text-sm text-slate-500">Nobody is idle and nobody is over capacity.</span>}
          </div>
          <TeamWorkload workload={p.workload} selected="" onSelect={p.onPickPerson} />
        </div>
      </Panel>

      {/* ===== 8. Project risk + timeline ===== */}
      <Panel
        id="project-risk"
        tone="indigo"
        title="Project risk"
        sub="Score = 100 minus penalties for overdue, blocked and stuck tasks."
        action={<LinkButton tone="indigo" onClick={() => p.onNavigate?.('projects')}>All projects →</LinkButton>}
      >
        {p.riskProjects.length ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {p.riskProjects.slice(0, 6).map((r) => {
              const bar = r.score < 60 ? 'bg-red-500' : r.score < 80 ? 'bg-amber-500' : 'bg-emerald-500';
              const txt = r.score < 60 ? 'text-red-600' : r.score < 80 ? 'text-amber-600' : 'text-emerald-600';
              return (
                <div key={r.id} className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate text-[15px] font-semibold text-slate-900">{r.name}</span>
                    <span className={`text-lg font-bold tabular-nums ${txt}`}>{r.score}</span>
                  </div>
                  <div className="mt-2 h-2.5 rounded-full bg-slate-100">
                    <div className={`h-2.5 rounded-full ${bar}`} style={{ width: `${r.score}%` }} />
                  </div>
                  <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                    <span>
                      {r.flags} flagged · {r.overdue} overdue · {r.blocked} blocked · {r.stuck} stuck
                    </span>
                    {p.onOpenProject && (
                      <button onClick={() => p.onOpenProject!(r.id)} className="font-semibold text-indigo-700 hover:underline">
                        Open project →
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <Empty>No project has any warning signals ✓</Empty>
        )}

        {/* Timeline */}
        <div className="mt-6 border-t border-indigo-100 pt-5">
          <h4 className="mb-3 text-sm font-semibold text-slate-700">Timeline (project start → end, dashed line = today)</h4>
          {p.projectsLoading ? (
            <Empty>Loading projects…</Empty>
          ) : p.timelineProjects.length ? (
            <div className="space-y-3 overflow-x-auto">
              {p.timelineProjects.map((pr) => {
                const start = new Date(pr.startDate ?? pr.createdAt).getTime();
                const lastDue = pr.tasks.map((t) => t.dueDate).filter((d): d is string => Boolean(d)).sort().at(-1);
                const end = new Date(pr.endDate ?? lastDue ?? pr.createdAt).getTime();
                const span = Math.max(86_400_000, end - start);
                const pct = (v: number) => Math.max(0, Math.min(100, ((v - start) / span) * 100));
                const done = pr.tasks.filter((t) => t.status === 'Completed').length;
                return (
                  <button key={pr._id} onClick={() => p.onOpenProject?.(pr._id)} className="block w-full min-w-[640px] text-left">
                    <div className="mb-1 flex justify-between text-xs">
                      <span className="font-medium text-slate-800">{pr.name}</span>
                      <span className="text-slate-400">
                        {done}/{pr.tasks.length} done
                      </span>
                    </div>
                    <div className="relative h-7 rounded-lg bg-white">
                      <div className="absolute top-1/2 h-3 -translate-y-1/2 rounded bg-indigo-500/80" style={{ left: 0, width: `${Math.max(8, pr.tasks.length ? (done / pr.tasks.length) * 100 : 0)}%` }} />
                      <div className="absolute inset-y-0 border-l-2 border-dashed border-rose-400" style={{ left: `${pct(Date.now())}%` }} />
                    </div>
                    <div className="mt-1 flex justify-between text-[10px] text-slate-400">
                      <span>{new Date(start).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                      <span>{new Date(end).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <Empty>No project dates or tasks available.</Empty>
          )}
        </div>
      </Panel>

      {/* ===== 9. Verify ===== */}
      {unverified.length > 0 && (
        <Panel
          id="verify"
          tone="teal"
          title="Waiting for your check"
          sub="Marked done in Taskmandu — confirm the work, then snooze or verify below."
          badge={<Count n={unverified.length} tone="teal" />}
          action={unverified.length > 5 ? <LinkButton tone="teal" onClick={() => p.onFilter('unverified')}>View all →</LinkButton> : undefined}
        >
          <div className="grid gap-2.5 lg:grid-cols-2">
            {unverified.slice(0, 6).map((c) => (
              <TaskRow key={c.card_id} c={c} extra="Done · needs verify" onOpen={() => p.onOpenCard(c)} />
            ))}
          </div>
        </Panel>
      )}

      {/* ===== 10. What changed ===== */}
      <Panel id="since-strip" tone="slate" title="What changed" sub="Movement on the board since the last working day.">
        {p.since ? <SinceStrip since={p.since} onOpenItem={p.onOpenSince} onShowFree={p.onShowFree} /> : <Empty>No change data yet.</Empty>}
      </Panel>
    </div>
  );
}
