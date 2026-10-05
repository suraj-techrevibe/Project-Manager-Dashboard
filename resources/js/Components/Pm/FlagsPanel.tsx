import { Fragment, useEffect, useMemo, useState } from 'react';
import { pmApi } from '../../lib/pmApi';
import type { Employee, PmFlag, PmMetrics, PmTask, Project, Severity, SinceItem, SinceSummary, SubtaskFlag, TaskFocus, TodayData, WorkloadRow } from '../../types/pm';
import DigestPanel from './DigestPanel';
import EmailModal from './EmailModal';
import SubtaskInbox from './SubtaskInbox';
import { levelOf, overloadThreshold } from './TeamWorkload';
import TodayCommandCenter, { type CcAnswer } from './TodayCommandCenter';

const severityClasses: Record<Severity, string> = {
  danger: 'border-red-300 bg-red-50/60',
  warning: 'border-amber-300 bg-amber-50/60',
  neutral: 'border-slate-200 bg-white',
};

const badgeClasses: Record<Severity, string> = {
  danger: 'bg-red-100 text-red-700',
  warning: 'bg-amber-100 text-amber-700',
  neutral: 'bg-slate-100 text-slate-600',
};

const priorityClasses: Record<string, string> = {
  Low: 'bg-slate-100 text-slate-500',
  Medium: 'bg-blue-50 text-blue-600',
  High: 'bg-amber-50 text-amber-700',
  Critical: 'bg-red-50 text-red-700',
};

const statusClasses: Record<string, string> = {
  Assigned: 'bg-slate-100 text-slate-600',
  Pending: 'bg-slate-100 text-slate-600',
  'In Progress': 'bg-blue-50 text-blue-700',
  Blocked: 'bg-red-50 text-red-700',
  Completed: 'bg-green-50 text-green-700',
  Cancelled: 'bg-slate-100 text-slate-400',
};

type FlagType = PmFlag['type'];

const metricLabels: { key: keyof PmMetrics; label: string; color: string }[] = [
  { key: 'overdue', label: 'Overdue', color: 'text-red-600' },
  { key: 'due_today', label: 'Due today', color: 'text-amber-600' },
  { key: 'due_soon', label: 'Due in 3 days', color: 'text-slate-900' },
  { key: 'stuck', label: 'Stuck 3+ days', color: 'text-amber-600' },
  { key: 'blocked', label: 'Blocked', color: 'text-slate-900' },
  { key: 'unverified', label: 'Unverified done', color: 'text-slate-900' },
  { key: 'unassigned', label: 'Unassigned', color: 'text-amber-600' },
];

// The two tiles that matter most get a big, red, top-of-page treatment;
// everything else is still visible but a size down.
const CRITICAL_KEYS: (keyof PmMetrics)[] = ['overdue', 'blocked'];
const CRITICAL_METRICS = metricLabels.filter((m) => CRITICAL_KEYS.includes(m.key));
const SECONDARY_METRICS = metricLabels.filter((m) => !CRITICAL_KEYS.includes(m.key));

// Section anchors for the "Jump to" bar — click to scroll straight there.
const JUMP_TARGETS: { id: string; label: string }[] = [
  { id: 'critical-metrics', label: 'Critical' },
  { id: 'since-strip', label: 'Since yesterday' },
  { id: 'unassigned-work', label: 'Unassigned' },
  { id: 'team-workload', label: 'Team workload' },
  { id: 'task-list', label: 'Task list' },
];

function jumpTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

const UNASSIGNED = '__unassigned';
const STANDALONE = '__standalone';

const selectCls = 'rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm focus:border-slate-400 focus:outline-none';

const severityRank: Record<Severity, number> = { danger: 0, warning: 1, neutral: 2 };

interface TaskCard {
  card_id: number;
  task: PmFlag; // first flag — carries the shared task fields
  flags: PmFlag[];
  severity: Severity;
}

/* ------------------------------------------------------------------ */
/* Question buttons: each one filters the list AND answers in a line.   */
/* Computed from the synced cards in the browser — no AI call.          */
/* ------------------------------------------------------------------ */

type QuestionKey = 'overloaded' | 'free' | 'duesoon' | 'overdue' | 'blocking' | 'unverified' | 'stuck' | 'unowned' | 'worst';

interface QuestionCtx {
  all: TaskCard[];
  /** Open sub-tasks with nobody assigned (they aren't task cards, so counted separately). */
  unassignedSubtasks: number;
  workload: WorkloadRow[];
  overloadAt: number;
}

interface QuestionResult {
  text: string;
  match: (c: TaskCard) => boolean;
}

const hasFlag = (c: TaskCard, type: FlagType) => c.flags.some((f) => f.type === type);
const namesOf = (c: TaskCard) =>
  (c.task.assignee ?? '')
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean);
const projectOf = (c: TaskCard) => c.task.project_name ?? 'Standalone tasks';

function tally(items: string[]): [string, number][] {
  const m = new Map<string, number>();
  items.forEach((i) => m.set(i, (m.get(i) ?? 0) + 1));
  return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
}

const fmt = (t: [string, number][], n = 3) => t.slice(0, n).map(([k, v]) => `${k} (${v})`).join(', ');
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const QUESTIONS: { key: QuestionKey; label: string; run: (x: QuestionCtx) => QuestionResult }[] = [
  {
    key: 'overloaded',
    label: 'Who’s overloaded?',
    run: ({ workload, overloadAt }) => {
      if (!workload.length) return { text: 'No workload data yet — press Sync now first.', match: () => false };
      const heavy = workload.filter((w) => ['over', 'heavy'].includes(levelOf(w, overloadAt)));
      if (!heavy.length) {
        return { text: 'Nobody is over capacity this week. See Team capacity below for the spread.', match: () => true };
      }
      const names = new Set(heavy.map((w) => w.name));
      return {
        text:
          heavy
            .map(
              (w) =>
                `${w.name}: ${w.open} open${w.week_hours ? `, ${w.week_hours}h of ${w.capacity ?? 40}h this week` : ''}${
                  w.overdue ? `, ${w.overdue} overdue` : ''
                }${w.blocked ? `, ${w.blocked} blocked` : ''}`
            )
            .join(' · ') + '. Showing their flagged tasks.',
        match: (c) => namesOf(c).some((n) => names.has(n)),
      };
    },
  },
  {
    key: 'free',
    label: 'Who has free capacity?',
    run: ({ workload, overloadAt }) => {
      if (!workload.length) return { text: 'No workload data yet — press Sync now first.', match: () => false };
      const none = workload.filter((w) => w.open === 0).map((w) => w.name);
      const light = workload.filter((w) => levelOf(w, overloadAt) === 'light').map((w) => `${w.name} (${w.week_hours ?? 0}h)`);
      if (!none.length && !light.length) return { text: 'Everyone has a full plate this week.', match: () => true };
      return {
        text: [none.length ? `No tasks: ${none.join(', ')}.` : '', light.length ? `Light week: ${light.join(', ')}.` : ''].filter(Boolean).join(' '),
        match: () => true,
      };
    },
  },
  {
    key: 'duesoon',
    label: 'What’s due soon?',
    run: ({ all }) => {
      const m = all.filter((c) => hasFlag(c, 'due_today') || hasFlag(c, 'due_soon'));
      if (!m.length) return { text: 'Nothing is due in the next 3 days.', match: () => false };
      const today = all.filter((c) => hasFlag(c, 'due_today')).length;
      return {
        text: `${plural(m.length, 'task')} due in the next 3 days${today ? `, ${today} of them today` : ''}.`,
        match: (c) => hasFlag(c, 'due_today') || hasFlag(c, 'due_soon'),
      };
    },
  },
  {
    key: 'overdue',
    label: 'What’s overdue?',
    run: ({ all }) => {
      const m = all.filter((c) => hasFlag(c, 'overdue'));
      if (!m.length) return { text: 'Nothing is overdue.', match: () => false };
      const who = tally(m.flatMap((c) => (namesOf(c).length ? namesOf(c) : ['Unassigned'])));
      return { text: `${plural(m.length, 'task')} overdue. Most with: ${fmt(who)}.`, match: (c) => hasFlag(c, 'overdue') };
    },
  },
  {
    key: 'blocking',
    label: 'What’s blocking the most?',
    run: ({ all }) => {
      const m = all.filter((c) => hasFlag(c, 'blocked'));
      if (!m.length) return { text: 'Nothing is blocked.', match: () => false };
      return {
        text: `${plural(m.length, 'task')} blocked. By project: ${fmt(tally(m.map(projectOf)))}. By person: ${fmt(
          tally(m.flatMap((c) => (namesOf(c).length ? namesOf(c) : ['Unassigned'])))
        )}.`,
        match: (c) => hasFlag(c, 'blocked'),
      };
    },
  },
  {
    key: 'stuck',
    label: 'What hasn’t moved in 3+ days?',
    run: ({ all }) => {
      const m = all.filter((c) => hasFlag(c, 'stuck'));
      if (!m.length) return { text: 'Nothing has been sitting still for 3+ days.', match: () => false };
      const oldest = [...m].sort(
        (a, b) => new Date(a.task.last_activity_at ?? 0).getTime() - new Date(b.task.last_activity_at ?? 0).getTime()
      )[0];
      const days = daysAgo(oldest.task.last_activity_at);
      return {
        text: `${plural(m.length, 'task')} with no movement for 3+ days. Longest: “${oldest.task.title}”${days !== null ? ` (${days}d)` : ''}.`,
        match: (c) => hasFlag(c, 'stuck'),
      };
    },
  },
  {
    key: 'unverified',
    label: 'Which done tasks are unverified?',
    run: ({ all }) => {
      const m = all.filter((c) => hasFlag(c, 'unverified'));
      return m.length
        ? { text: `${plural(m.length, 'completed task')} still waiting for you to verify them.`, match: (c) => hasFlag(c, 'unverified') }
        : { text: 'Every recently completed task is verified.', match: () => false };
    },
  },
  {
    key: 'unowned',
    label: 'What has no owner?',
    run: ({ all, unassignedSubtasks }) => {
      const m = all.filter((c) => hasFlag(c, 'unassigned'));
      if (!m.length && !unassignedSubtasks) return { text: 'Every open task and sub-task has an owner.', match: () => false };
      const parts = [m.length > 0 && plural(m.length, 'task'), unassignedSubtasks > 0 && plural(unassignedSubtasks, 'sub-task')].filter(Boolean);
      return { text: `${parts.join(' and ')} with nobody assigned.`, match: (c) => hasFlag(c, 'unassigned') };
    },
  },
  {
    key: 'worst',
    label: 'Which project is in the worst shape?',
    run: ({ all }) => {
      if (!all.length) return { text: 'No flagged tasks — nothing to compare.', match: () => false };
      const t = tally(all.map(projectOf));
      const [name, n] = t[0];
      return {
        text: `${name} has the most flagged tasks: ${n} of ${all.length}${t[1] ? `. Next: ${fmt(t.slice(1), 2)}` : ''}.`,
        match: (c) => projectOf(c) === name,
      };
    },
  },
];

function ago(iso: string | null): string {
  if (!iso) return 'never';
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const d = Math.floor(hrs / 24);
  return `${d}d ago`;
}

function nudgedLabel(iso: string | null | undefined): { text: string; recent: boolean } | null {
  if (!iso) return null;
  const hrs = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (hrs < 24) return { text: 'Nudged today', recent: true };
  const d = Math.floor(hrs / 24);
  return { text: `Nudged ${d}d ago`, recent: d < 2 };
}

function daysUntil(date: string | null): number | null {
  if (!date) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((new Date(`${date}T00:00:00`).getTime() - today.getTime()) / 86_400_000);
}

function errMsg(e: unknown, fallback: string): string {
  const data = (e as { response?: { data?: { error?: string; message?: string } } })?.response?.data;
  return data?.error ?? data?.message ?? fallback;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  }
}

/** A ready-to-send check-in message — no AI, no waiting. */
function templateNudge(c: TaskCard): string {
  const t = c.task;
  const who = namesOf(c).map((n) => n.split(' ')[0]);
  const greeting = who.length ? `Hi ${who.join(' & ')}` : 'Hi';
  const proj = t.project_name ? ` (${t.project_name})` : '';
  const d = daysUntil(t.due_at);
  const idle = daysAgo(t.last_activity_at);

  let line = 'could you give me a quick status update?';
  if (hasFlag(c, 'overdue') && d !== null) line = `it was due ${Math.abs(d)} day${Math.abs(d) === 1 ? '' : 's'} ago. Where is it at, and is there anything I can unblock?`;
  else if (hasFlag(c, 'blocked')) line = 'it’s marked Blocked. What do you need to get it moving?';
  else if (hasFlag(c, 'stuck') && idle !== null) line = `there’s been no movement for ${idle} days. Can you share a quick status?`;
  else if (hasFlag(c, 'due_today')) line = 'it’s due today. Are you on track to finish it?';
  else if (hasFlag(c, 'due_soon') && d !== null) line = `it’s due in ${d} day${d === 1 ? '' : 's'}. Are you on track?`;

  return `${greeting} — quick check-in on “${t.title}”${proj}: ${line} Thanks!`;
}

function daysAgo(iso: string | null): number | null {
  if (!iso) return null;
  const diff = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.floor(diff / 86_400_000));
}

function activityLabel(iso: string | null): string {
  const d = daysAgo(iso);
  if (d === null) return 'No activity recorded';
  if (d === 0) return 'Active today';
  return `Last activity ${d}d ago`;
}

const PINS_KEY = 'pm.pins';
const MAX_PINS = 3;

function loadPins(): number[] {
  try {
    const v = JSON.parse(localStorage.getItem(PINS_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((n) => typeof n === 'number').slice(0, MAX_PINS) : [];
  } catch {
    return [];
  }
}

function dueLabel(date: string | null): { text: string; overdue: boolean } {
  if (!date) return { text: 'No due date', overdue: false };
  const due = new Date(`${date}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((due.getTime() - today.getTime()) / 86_400_000);
  const pretty = due.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  if (diff < 0) return { text: `${pretty} (${-diff}d overdue)`, overdue: true };
  if (diff === 0) return { text: `${pretty} (today)`, overdue: false };
  if (diff === 1) return { text: `${pretty} (tomorrow)`, overdue: false };
  return { text: `${pretty} (in ${diff}d)`, overdue: false };
}

export default function FlagsPanel({
  active: tabActive = true,
  flags: initialFlags,
  tasks: initialTasks = [],
  workload: initialWorkload = [],
  subtasks: initialSubtasks = [],
  staff: initialStaff = [],
  since: initialSince,
  lastSyncedAt: initialSynced = null,
  onOpenTask,
  onNavigate,
  onOpenProject,
}: {
  /** False while another tab is showing, so shortcut keys don't fire there. */
  active?: boolean;
  flags: PmFlag[];
  /** Every synced task (flagged or not) for the "All tasks" view. */
  tasks?: PmTask[];
  /** Kept optional so older callers that still pass `metrics` keep compiling; counts are derived from `flags` below. */
  metrics?: PmMetrics;
  workload?: WorkloadRow[];
  subtasks?: SubtaskFlag[];
  staff?: Employee[];
  since?: SinceSummary;
  lastSyncedAt?: string | null;
  onOpenTask: (focus: TaskFocus) => void;
  /** Switch to another tab (projects, minutes, brief, reports, scope, git). */
  onNavigate?: (tab: string) => void;
  /** Open one project in the Projects tab. */
  onOpenProject?: (projectId: string) => void;
}) {
  const [flags, setFlags] = useState(initialFlags);
  const [tasks, setTasks] = useState(initialTasks);
  // Today lists only what the board flagged; "All tasks" lists everything that was created.
  const [scope, setScope] = useState<'flagged' | 'all'>('flagged');
  const [workload, setWorkload] = useState(initialWorkload);
  const [subtasks, setSubtasks] = useState(initialSubtasks);
  const [staff, setStaff] = useState(initialStaff);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [since, setSince] = useState<SinceSummary | undefined>(initialSince);
  const [lastSynced, setLastSynced] = useState<string | null>(initialSynced);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [, setTick] = useState(0);

  const [nudges, setNudges] = useState<Record<number, string>>({});
  const [nudgedAt, setNudgedAt] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [emailFor, setEmailFor] = useState<TaskCard | null>(null);
  const [filter, setFilter] = useState<FlagType | null>(null);
  const [search, setSearch] = useState('');
  const [assignee, setAssignee] = useState('');
  const [project, setProject] = useState('');
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [pins, setPins] = useState<number[]>(loadPins);
  const [sel, setSel] = useState<number | null>(null);
  const [workloadKey, setWorkloadKey] = useState(0);
  const [showDigest, setShowDigest] = useState(false);

  const [question, setQuestion] = useState<QuestionKey | null>(null);

  // Keeps the "Last synced 12 min ago" label honest while the page stays open.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!tabActive) return;
    let cancelled = false;
    setProjectsLoading(true);
    pmApi.projects().then(({ data }) => {
      if (!cancelled) setProjects(data.projects ?? []);
    }).catch(() => {
      if (!cancelled) setProjects([]);
    }).finally(() => {
      if (!cancelled) setProjectsLoading(false);
    });
    return () => { cancelled = true; };
  }, [tabActive]);

  function flashMsg(msg: string) {
    setFlash(msg);
    setTimeout(() => setFlash((cur) => (cur === msg ? null : cur)), 2500);
  }

  function apply(d: TodayData) {
    setFlags(d.flags);
    setTasks(d.tasks ?? []);
    setWorkload(d.workload);
    setSubtasks(d.subtasks ?? []);
    setStaff(d.staff ?? []);
    setSince(d.since);
    setLastSynced(d.lastSyncedAt);
  }

  async function syncNow() {
    setSyncing(true);
    setSyncError(null);
    try {
      const { data } = await pmApi.sync();
      apply(data);
      flashMsg(`Synced ${data.synced} tasks from Taskmandu`);
    } catch (e) {
      setSyncError(errMsg(e, "Couldn't sync from Taskmandu."));
    } finally {
      setSyncing(false);
    }
  }

  const syncAgeHours = lastSynced ? (Date.now() - new Date(lastSynced).getTime()) / 3_600_000 : null;
  const stale = syncAgeHours === null || syncAgeHours > 3;

  // Tile counts follow the list, so snoozing or verifying a card updates them immediately.
  const counts = useMemo(() => {
    const c: Record<FlagType, number> = { overdue: 0, stuck: 0, blocked: 0, unverified: 0, unassigned: 0, due_today: 0, due_soon: 0 };
    flags.forEach((f) => (c[f.type] += 1));
    return c;
  }, [flags]);

  const people = useMemo(() => {
    const names = new Set(workload.map((w) => w.name));
    [...flags, ...(scope === 'all' ? tasks : [])].forEach((f) => f.assignee?.split(',').forEach((n) => n.trim() && names.add(n.trim())));
    return Array.from(names).sort();
  }, [workload, flags, tasks, scope]);

  const projectNames = useMemo(
    () => Array.from(new Set([...flags, ...(scope === 'all' ? tasks : [])].map((f) => f.project_name).filter((n): n is string => Boolean(n)))).sort(),
    [flags, tasks, scope]
  );

  const overloadAt = useMemo(() => overloadThreshold(workload), [workload]);

  const filtersActive = Boolean(filter || question || search || assignee || project || pinnedOnly);

  function clearFilters() {
    setFilter(null);
    setQuestion(null);
    setSearch('');
    setAssignee('');
    setProject('');
    setPinnedOnly(false);
  }

  // One card per task, with every flag it has shown as a badge.
  const allCards: TaskCard[] = useMemo(() => {
    const byCard = new Map<number, PmFlag[]>();
    flags.forEach((f) => byCard.set(f.card_id, [...(byCard.get(f.card_id) ?? []), f]));

    return Array.from(byCard.entries()).map(([card_id, fs]) => ({
      card_id,
      task: fs[0],
      flags: fs,
      severity: fs.reduce<Severity>(
        (worst, f) => (severityRank[f.severity] < severityRank[worst] ? f.severity : worst),
        'neutral'
      ),
    }));
  }, [flags]);

  // The list's source: only flagged tasks, or every task (flagged ones keep their badges).
  const baseCards: TaskCard[] = useMemo(() => {
    if (scope === 'flagged') return allCards;

    const flagged = new Map(allCards.map((c) => [c.card_id, c]));
    const all: TaskCard[] = tasks.map(
      (t) =>
        flagged.get(t.card_id) ?? {
          card_id: t.card_id,
          // Not flagged: no badges. The placeholder type/detail only satisfy the shared task shape.
          task: { ...t, type: 'unverified', severity: 'neutral', detail: '' },
          flags: [],
          severity: 'neutral' as Severity,
        }
    );
    // A flagged card is always shown, even if the task list was capped before reaching it.
    const have = new Set(all.map((c) => c.card_id));
    return [...all, ...allCards.filter((c) => !have.has(c.card_id))];
  }, [scope, allCards, tasks]);

  const riskProjects = useMemo(() => {
    const byProject = new Map<string, TaskCard[]>();
    allCards.forEach((c) => {
      if (!c.task.project_id || !c.task.project_name) return;
      byProject.set(c.task.project_id, [...(byProject.get(c.task.project_id) ?? []), c]);
    });
    return Array.from(byProject.entries()).map(([id, cards]) => {
      const overdue = cards.filter((c) => hasFlag(c, 'overdue')).length;
      const blocked = cards.filter((c) => hasFlag(c, 'blocked')).length;
      const stuck = cards.filter((c) => hasFlag(c, 'stuck')).length;
      const score = Math.max(0, 100 - overdue * 18 - blocked * 15 - stuck * 8);
      return { id, name: cards[0].task.project_name!, score, overdue, blocked, stuck, flags: cards.length };
    }).sort((a, b) => a.score - b.score);
  }, [allCards]);

  const agingCards = useMemo(
    () => allCards
      .filter((c) => hasFlag(c, 'stuck'))
      .sort((a, b) => (daysAgo(b.task.last_activity_at) ?? 0) - (daysAgo(a.task.last_activity_at) ?? 0)),
    [allCards]
  );

  const waitingCards = useMemo(() => allCards.filter((c) => {
    const t = c.task;
    const text = [t.title, t.description, ...(t.tags ?? [])].join(' ').toLowerCase();
    return /waiting|client|approval|feedback|content needed|awaiting/.test(text);
  }), [allCards]);

  const timelineProjects = useMemo(
    () => projects
      .filter((p) => p.startDate || p.endDate || p.tasks.length)
      .sort((a, b) => (a.startDate ?? a.createdAt).localeCompare(b.startDate ?? b.createdAt))
      .slice(0, 8),
    [projects]
  );

  const unassignedTasks = useMemo(() => allCards.filter((c) => !c.task.assignee), [allCards]);
  const unassignedSubtasks = useMemo(() => subtasks.filter((s) => s.issues.includes('unassigned')), [subtasks]);
  const unassignedTotal = unassignedTasks.length + unassignedSubtasks.length;

  // The clicked question's one-line answer + which cards it keeps.
  const active = useMemo(() => {
    const q = QUESTIONS.find((x) => x.key === question);
    return q ? { label: q.label, ...q.run({ all: allCards, unassignedSubtasks: unassignedSubtasks.length, workload, overloadAt }) } : null;
  }, [question, allCards, unassignedSubtasks, workload, overloadAt]);

  // One answer per predefined question, for the ordered checklist at the top of the page.
  const answers: CcAnswer[] = useMemo(
    () =>
      QUESTIONS.map((q) => {
        const r = q.run({ all: allCards, unassignedSubtasks: unassignedSubtasks.length, workload, overloadAt });
        let count = allCards.filter((c) => r.match(c)).length;
        if (q.key === 'unowned') count += unassignedSubtasks.length;
        if (q.key === 'overloaded') count = workload.filter((w) => ['over', 'heavy'].includes(levelOf(w, overloadAt))).length;
        else if (q.key === 'free') count = workload.filter((w) => w.open === 0 || levelOf(w, overloadAt) === 'light').length;
        else if (q.key === 'worst') count = tally(allCards.map(projectOf))[0]?.[1] ?? 0;
        return { key: q.key, label: q.label, text: r.text, count };
      }),
    [allCards, unassignedSubtasks, workload, overloadAt]
  );

  const isPinned = (id: number) => pins.includes(id);

  const cards: TaskCard[] = useMemo(() => {
    const dueTs = (c: TaskCard) => (c.task.due_at ? new Date(`${c.task.due_at}T00:00:00`).getTime() : Infinity);

    return baseCards
      .filter((c) => !filter || c.flags.some((f) => f.type === filter))
      .filter((c) => !active || active.match(c))
      .filter((c) => !pinnedOnly || pins.includes(c.card_id))
      .filter((c) => {
        const t = c.task;
        if (assignee === UNASSIGNED) return !t.assignee;
        if (assignee) return (t.assignee ?? '').split(',').some((n) => n.trim() === assignee);
        return true;
      })
      .filter((c) => {
        if (project === STANDALONE) return !c.task.project_id;
        return !project || c.task.project_name === project;
      })
      .filter((c) => {
        const q = search.trim().toLowerCase();
        if (!q) return true;
        const t = c.task;
        return [t.title, t.project_name, t.assignee, t.description, ...t.tags].some((v) => v?.toLowerCase().includes(q));
      })
      .sort(
        (a, b) =>
          Number(pins.includes(b.card_id)) - Number(pins.includes(a.card_id)) ||
          severityRank[a.severity] - severityRank[b.severity] ||
          // Among equally urgent tasks, open work comes before finished work.
          Number(a.task.status === 'Completed') - Number(b.task.status === 'Completed') ||
          dueTs(a) - dueTs(b)
      );
  }, [baseCards, filter, active, search, assignee, project, pinnedOnly, pins]);

  // Sub-tasks are not task cards, so the filters above can't see them — which left "No owner: 1"
  // opening an empty list. Sub-tasks only carry two issues (no owner / blocked): the No-owner
  // tile and question show the unowned ones, any other flag or question has none to show, and
  // with no filter the list shows every flagged sub-task, like it does every flagged task.
  const listSubtasks = useMemo(() => {
    if (pinnedOnly) return [];
    const unowned = filter === 'unassigned' || question === 'unowned';
    if ((filter || question) && !unowned) return [];
    const q = search.trim().toLowerCase();

    return subtasks
      .filter((s) => !unowned || s.issues.includes('unassigned'))
      .filter((s) => {
        if (assignee === UNASSIGNED) return !s.assignee;
        if (assignee) return (s.assignee ?? '').split(',').some((n) => n.trim() === assignee);
        return true;
      })
      .filter((s) => (project === STANDALONE ? false : !project || s.project_name === project))
      .filter((s) => !q || [s.title, s.parent_title, s.project_name, s.assignee].some((v) => v?.toLowerCase().includes(q)));
  }, [subtasks, filter, question, pinnedOnly, assignee, project, search]);

  const totalTasks = useMemo(() => (scope === 'all' ? baseCards.length : new Set(flags.map((f) => f.card_id)).size), [scope, baseCards, flags]);
  const pinnedVisible = cards.filter((c) => isPinned(c.card_id)).length;

  const lastNudge = (c: TaskCard) => nudgedAt[c.card_id] ?? c.task.last_nudged_at;

  async function nudge(cardId: number) {
    setBusy(cardId);
    try {
      const { data } = await pmApi.nudge(cardId);
      setNudges((n) => ({ ...n, [cardId]: data.message }));
      setNudgedAt((n) => ({ ...n, [cardId]: new Date().toISOString() }));
    } finally {
      setBusy(null);
    }
  }

  /** Instant, no-AI nudge: builds the message, copies it, and records that you nudged. */
  async function copyNudge(c: TaskCard) {
    if (namesOf(c).length === 0) return flashMsg('Nobody is assigned yet — assign an owner first');
    const text = templateNudge(c);
    setNudges((n) => ({ ...n, [c.card_id]: text }));
    if (await copyText(text)) flashMsg('Nudge copied — paste it to them');
    try {
      await pmApi.nudged(c.card_id);
      setNudgedAt((n) => ({ ...n, [c.card_id]: new Date().toISOString() }));
    } catch {
      /* the copy still worked; only the "nudged 2d ago" tracking missed */
    }
  }

  async function snooze(cardId: number) {
    await pmApi.snooze(cardId);
    setFlags((f) => f.filter((x) => x.card_id !== cardId));
  }

  async function verify(cardId: number) {
    await pmApi.verify(cardId);
    setFlags((f) => f.filter((x) => x.card_id !== cardId));
  }

  function togglePin(cardId: number) {
    setPins((cur) => {
      if (cur.includes(cardId)) {
        const next = cur.filter((x) => x !== cardId);
        savePins(next);
        return next;
      }
      if (cur.length >= MAX_PINS) {
        flashMsg(`You can pin ${MAX_PINS} tasks — unpin one first`);
        return cur;
      }
      const next = [...cur, cardId];
      savePins(next);
      return next;
    });
  }

  function savePins(next: number[]) {
    try {
      localStorage.setItem(PINS_KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable — pins last for this visit only */
    }
  }

  function openTarget(t: { project_id: string | null; task_id: string | null; url: string | null }) {
    if (t.project_id && t.task_id) {
      onOpenTask({ projectId: t.project_id, taskId: t.task_id });
    } else if (t.url) {
      // Standalone Taskmandu task — it has no project board, so open it in Taskmandu.
      window.open(t.url, '_blank', 'noopener');
    }
  }

  const open = (card: TaskCard) => openTarget(card.task);
  const openSinceItem = (it: SinceItem) => openTarget(it);

  function showFree() {
    setWorkloadKey((k) => k + 1);
    setTimeout(() => document.getElementById('team-workload')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }

  /** Plain-text stand-up you can paste into Slack / a message. */
  async function copyStandup() {
    const lines: string[] = [];
    const day = new Date().toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
    lines.push(`Stand-up — ${day}`);

    if (since?.tracked) {
      lines.push(
        `Since ${since.label}: ${since.completed.count} completed, ${since.blocked.count} newly blocked, ${since.overdue.count} went overdue, ${since.created.count} new`
      );
    }

    const section = (title: string, list: TaskCard[]) => {
      if (!list.length) return;
      lines.push('', `${title} (${list.length})`);
      list.slice(0, 8).forEach((c) => {
        const bits = [c.task.project_name, c.task.assignee ?? 'Unassigned'].filter(Boolean).join(' · ');
        lines.push(`• ${c.task.title} — ${bits}`);
      });
      if (list.length > 8) lines.push(`  …and ${list.length - 8} more`);
    };

    const has = (type: FlagType) => allCards.filter((c) => hasFlag(c, type));
    const pinned = allCards.filter((c) => pins.includes(c.card_id));
    section('Focus today', pinned);
    section('Overdue', has('overdue'));
    section('Due today', has('due_today'));
    section('Blocked', has('blocked'));

    const idle = workload.filter((w) => w.open === 0).map((w) => w.name);
    const over = workload.filter((w) => ['over', 'heavy'].includes(levelOf(w, overloadAt))).map((w) => w.name);
    if (idle.length || over.length) lines.push('');
    if (idle.length) lines.push(`No tasks: ${idle.join(', ')}`);
    if (over.length) lines.push(`Over capacity: ${over.join(', ')}`);

    flashMsg((await copyText(lines.join('\n'))) ? 'Stand-up copied' : "Couldn't copy — select it manually");
  }

  // Keyboard: j/k move · o open · p pin · n nudge · s snooze · v verify · / search
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!tabActive) return;
      const el = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (el && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return;
      if (!cards.length && e.key !== '/') return;

      const idx = cards.findIndex((c) => c.card_id === sel);
      const cur = idx >= 0 ? cards[idx] : null;
      const move = (to: number) => {
        const next = cards[Math.max(0, Math.min(cards.length - 1, to))];
        setSel(next.card_id);
        document.getElementById(`flag-${next.card_id}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      };

      switch (e.key) {
        case 'j':
          return move(idx + 1);
        case 'k':
          return move(idx < 0 ? 0 : idx - 1);
        case 'o':
        case 'Enter':
          if (cur) open(cur);
          return;
        case 'p':
          if (cur) togglePin(cur.card_id);
          return;
        case 'n':
          if (cur) copyNudge(cur);
          return;
        case 's':
          if (cur) {
            snooze(cur.card_id);
            setSel(cards[idx + 1]?.card_id ?? cards[idx - 1]?.card_id ?? null);
          }
          return;
        case 'v':
          if (cur && hasFlag(cur, 'unverified')) {
            verify(cur.card_id);
            setSel(cards[idx + 1]?.card_id ?? cards[idx - 1]?.card_id ?? null);
          }
          return;
        case '/':
          e.preventDefault();
          document.getElementById('flag-search')?.focus();
          return;
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  async function assignParentTask(card: TaskCard, employeeId: string) {
    if (!card.task.project_id || !card.task.task_id) return;
    try {
      await pmApi.updateProjectTask(card.task.project_id, card.task.task_id, {
        assignedToId: [employeeId],
        assignedByName: 'PM',
        title: card.task.title,
        dueDate: card.task.due_at ?? new Date().toISOString().slice(0, 10),
      });
      const employee = staff.find((e) => e.employeeId === employeeId);
      flashMsg("Assigned to " + (employee?.name ?? "owner"));
      await syncNow();
    } catch (e) {
      flashMsg(errMsg(e, "Couldn't assign the task."));
    }
  }

  return (
    <div>
      {emailFor && (
        <EmailModal
          title="Email nudge"
          names={namesOf(emailFor)}
          subject={`Quick check-in: ${emailFor.task.title}`}
          body={templateNudge(emailFor)}
          cardId={emailFor.card_id}
          onClose={() => setEmailFor(null)}
          onSent={(n) => {
            setNudgedAt((m) => ({ ...m, [emailFor.card_id]: new Date().toISOString() }));
            setEmailFor(null);
            flashMsg(`Nudge emailed to ${n} ${n === 1 ? 'person' : 'people'}`);
          }}
        />
      )}
      {syncError && <div className="mb-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{syncError}</div>}
      {flash && <div className="mb-3 rounded-xl bg-slate-900 px-4 py-3 text-sm text-white">{flash}</div>}

      {showDigest && <DigestPanel onClose={() => setShowDigest(false)} />}

      <TodayCommandCenter
        counts={counts}
        workload={workload}
        overloadAt={overloadAt}
        cards={allCards}
        riskProjects={riskProjects}
        waitingCards={waitingCards}
        agingCards={agingCards}
        unassignedTasks={unassignedTasks}
        unassignedSubtasks={unassignedSubtasks}
        staff={staff}
        since={since}
        timelineProjects={timelineProjects}
        projectsLoading={projectsLoading}
        lastSynced={lastSynced}
        stale={stale}
        syncing={syncing}
        onSync={syncNow}
        showDigest={showDigest}
        onToggleDigest={() => setShowDigest((v) => !v)}
        onCopyStandup={copyStandup}
        pinCount={pins.length}
        maxPins={MAX_PINS}
        pinnedOnly={pinnedOnly}
        onTogglePinned={() => setPinnedOnly((v) => !v)}
        answers={answers}
        activeKey={question}
        onAsk={(key) => {
          setFilter(null);
          setQuestion(key as QuestionKey);
          jumpTo('task-list');
        }}
        onClearAsk={() => setQuestion(null)}
        onFilter={(type) => {
          setQuestion(null);
          setFilter((cur) => (cur === type ? null : type));
          jumpTo('task-list');
        }}
        onOpenCard={open}
        onNudgeCard={copyNudge}
        onOpenTask={onOpenTask}
        onAssignTask={assignParentTask}
        onAssignSubtask={async (id, employeeId) => {
          try {
            const { data } = await pmApi.assignSubtask(id, employeeId);
            setSubtasks((list) => list.filter((s) => s.id !== id));
            flashMsg('Assigned to ' + data.assignee);
            await syncNow();
          } catch (e) {
            flashMsg(errMsg(e, "Couldn't assign the sub-task."));
          }
        }}
        onOpenSince={openSinceItem}
        onShowFree={showFree}
        onPickPerson={(name) => {
          setQuestion(null);
          setFilter(null);
          setAssignee(name);
          jumpTo('task-list');
        }}
        onNavigate={onNavigate}
        onOpenProject={onOpenProject}
      />

      {/* ===== Task list ===== */}
      <div id="task-list" className="mt-8 scroll-mt-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="mb-1 text-xl font-semibold text-slate-900">{scope === 'all' ? 'All tasks' : 'All flagged tasks'}</h3>
          <p className="text-sm text-slate-500">
            {scope === 'all'
              ? 'Every task that was created — flagged or not, open or done. Flagged ones first, most urgent first.'
              : 'Everything the board flagged, most urgent first. Filter, search, nudge, snooze or verify from here.'}
          </p>
        </div>
        <div role="group" aria-label="Which tasks to list" className="flex shrink-0 overflow-hidden rounded-lg border border-slate-200 text-sm">
          {(
            [
              ['flagged', `Flagged only (${new Set(flags.map((f) => f.card_id)).size})`],
              ['all', `All tasks (${Math.max(tasks.length, new Set(flags.map((f) => f.card_id)).size)})`],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setScope(key)}
              aria-pressed={scope === key}
              className={`px-3 py-1.5 ${scope === key ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {/* Filters */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <input
          id="flag-search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search title, project, person, tag…  ( / )"
          className={`${selectCls} min-w-[12rem] flex-1`}
        />
        <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className={selectCls}>
          <option value="">Everyone</option>
          <option value={UNASSIGNED}>Unassigned</option>
          {people.map((n) => {
            const w = workload.find((x) => x.name === n);
            return (
              <option key={n} value={n}>
                {n}
                {w ? ` — ${w.open} open${w.week_hours ? `, ${w.week_hours}h this week` : ''}` : ''}
              </option>
            );
          })}
        </select>
        <select value={project} onChange={(e) => setProject(e.target.value)} className={selectCls}>
          <option value="">All projects</option>
          <option value={STANDALONE}>Standalone tasks</option>
          {projectNames.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>
      <p className="mb-3 text-[11px] text-slate-400">
        Keys: <b>j</b>/<b>k</b> move · <b>o</b> open · <b>p</b> pin · <b>n</b> copy nudge · <b>s</b> snooze · <b>v</b> verify · <b>/</b> search
      </p>

      {filtersActive && (
        <div className="mb-3 flex items-center gap-2 text-xs text-slate-500">
          Showing {cards.length} of {totalTasks} {scope === 'all' ? '' : 'flagged '}task{totalTasks === 1 ? '' : 's'}
          {listSubtasks.length > 0 && <> + {plural(listSubtasks.length, 'sub-task')}</>}
          {filter && <> · “{filter.replace('_', ' ')}”</>}
          {active && <> · {active.label}</>}
          {pinnedOnly && <> · focus list</>}
          <button onClick={clearFilters} className="text-slate-700 underline">
            Clear filters
          </button>
        </div>
      )}

      {cards.length === 0 && listSubtasks.length === 0 ? (
        <p className="text-sm text-slate-500">{filtersActive ? 'Nothing matches those filters.' : scope === 'all' ? 'No tasks synced yet — press Sync now.' : 'No flags. Board looks healthy.'}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {/* Sub-tasks needing a decision — click one to land on it inside Projects → project → task */}
          {listSubtasks.length > 0 && (
            <div className="rounded-2xl border border-violet-200 bg-violet-50/60 p-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-violet-700">
                Sub-tasks needing a decision · {listSubtasks.length}
              </div>
              <div className="flex flex-col gap-1.5">
                {listSubtasks.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => onOpenTask({ projectId: s.project_id, taskId: s.task_id, subId: s.subtask_id })}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-violet-200 bg-white px-3 py-2 text-left transition hover:bg-violet-50"
                  >
                    <span aria-hidden className="text-violet-400">↳</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-slate-900">{s.title || 'Untitled sub-task'}</span>
                      <span className="block truncate text-xs text-slate-500">
                        {s.project_name} · sub-task of {s.parent_title}
                        {s.parent_assignee ? ` (${s.parent_assignee})` : ''}
                      </span>
                    </span>
                    {s.issues.map((i) => (
                      <span
                        key={i}
                        className={`rounded px-1.5 py-0.5 text-xs font-medium ${i === 'unassigned' ? 'bg-violet-100 text-violet-700' : 'bg-orange-100 text-orange-700'}`}
                      >
                        {i === 'unassigned' ? 'No owner' : 'Blocked'}
                      </span>
                    ))}
                    {s.parent_overdue && <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-700">Parent overdue</span>}
                    <span className="shrink-0 text-xs text-slate-500">Open →</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {cards.map((c, idx) => {
            const t = c.task;
            const due = dueLabel(t.due_at);
            const canOpen = Boolean((t.project_id && t.task_id) || t.url);
            const needsVerify = c.flags.some((f) => f.type === 'unverified');
            const pinned = isPinned(c.card_id);
            const nudged = nudgedLabel(lastNudge(c));

            return (
              <Fragment key={c.card_id}>
                {idx === 0 && pinnedVisible > 0 && (
                  <div className="-mb-1 text-xs font-medium text-slate-500">★ Must unblock today ({pinnedVisible}/{MAX_PINS})</div>
                )}
                {idx === pinnedVisible && pinnedVisible > 0 && (
                  <div className="-mb-1 mt-1 text-xs font-medium text-slate-500">Everything else</div>
                )}

                <div
                  id={`flag-${c.card_id}`}
                  role={canOpen ? 'button' : undefined}
                  tabIndex={canOpen ? 0 : undefined}
                  onClick={() => {
                    setSel(c.card_id);
                    open(c);
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && open(c)}
                  className={`rounded-lg border p-3 ${severityClasses[c.severity]} ${
                    canOpen ? 'cursor-pointer transition hover:shadow-sm' : ''
                  } ${sel === c.card_id ? 'ring-2 ring-slate-900/40' : ''}`}
                >
                  {/* Row 1: project, title, priority, status */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="mb-0.5 text-xs text-slate-500">
                        {t.project_name ? (
                          <span className="font-medium text-slate-600">{t.project_name}</span>
                        ) : (
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-500">Standalone task</span>
                        )}
                      </div>
                      <div className="text-sm font-medium text-slate-900">{t.title}</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => togglePin(c.card_id)}
                        title={pinned ? 'Remove from today’s focus' : 'Add to today’s focus (max 3)'}
                        className={`text-base leading-none ${pinned ? 'text-amber-500' : 'text-slate-300 hover:text-slate-500'}`}
                        aria-label={pinned ? 'Unpin' : 'Pin'}
                      >
                        {pinned ? '★' : '☆'}
                      </button>
                      {t.priority && (
                        <span className={`rounded px-1.5 py-0.5 text-xs ${priorityClasses[t.priority] ?? priorityClasses.Low}`}>
                          {t.priority}
                        </span>
                      )}
                      <span className={`rounded px-1.5 py-0.5 text-xs ${statusClasses[t.status] ?? statusClasses.Pending}`}>
                        {t.status}
                      </span>
                    </div>
                  </div>

                  {/* Row 2: why it's flagged */}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {c.flags.map((f) => (
                      <span key={f.type} className={`rounded px-1.5 py-0.5 text-xs font-medium ${badgeClasses[f.severity]}`}>
                        {f.detail}
                      </span>
                    ))}
                    {nudged && (
                      <span
                        className={`rounded px-1.5 py-0.5 text-xs ${nudged.recent ? 'bg-violet-100 text-violet-700' : 'bg-slate-100 text-slate-500'}`}
                        title={nudged.recent ? 'You nudged recently — give them time before pinging again' : 'Last time you nudged this task'}
                      >
                        {nudged.text}
                      </span>
                    )}
                  </div>

                  {t.description && <p className="mt-2 line-clamp-2 text-xs text-slate-600">{t.description}</p>}

                  {/* Row 3: details */}
                  <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
                    <Detail label="Assignee" value={t.assignee ?? 'Unassigned'} warn={!t.assignee} />
                    <Detail label="Due" value={due.text} warn={due.overdue} />
                    <Detail label="Estimate" value={t.estimated_hours ? `${t.estimated_hours}h` : '—'} />
                    <Detail label="Assigned by" value={t.assigned_by ?? '—'} />
                  </dl>

                  {/* Row 4: counts, tags, activity */}
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
                    <span>{t.subtasks_count} subtask{t.subtasks_count === 1 ? '' : 's'}</span>
                    <span>{t.comments_count} comment{t.comments_count === 1 ? '' : 's'}</span>
                    <span>{activityLabel(t.last_activity_at)}</span>
                    {t.tags.map((tag) => (
                      <span key={tag} className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-500">
                        {tag}
                      </span>
                    ))}
                  </div>

                  {/* Footer: actions */}
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <span className="text-xs text-slate-400">
                      {t.project_id && t.task_id ? 'Open in Projects →' : t.url ? 'Open in Taskmandu ↗' : ''}
                    </span>
                    <div className="flex flex-wrap justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
                      {needsVerify ? (
                        <button
                          onClick={() => verify(c.card_id)}
                          className="rounded-md bg-white px-2 py-1 text-xs font-medium shadow-sm hover:bg-slate-50"
                        >
                          Mark verified
                        </button>
                      ) : (
                        <>
                          <button
                            onClick={() => copyNudge(c)}
                            className="rounded-md bg-white px-2 py-1 text-xs font-medium shadow-sm hover:bg-slate-50"
                            title="Copies a ready-made check-in message and logs that you nudged"
                          >
                            Copy nudge
                          </button>
                          <button
                            onClick={() => (namesOf(c).length ? setEmailFor(c) : flashMsg('Nobody is assigned yet — assign an owner first'))}
                            className="rounded-md bg-white px-2 py-1 text-xs font-medium shadow-sm hover:bg-slate-50"
                            title="Review the check-in and email it to the assignee"
                          >
                            Email nudge
                          </button>
                          <button
                            onClick={() => nudge(c.card_id)}
                            disabled={busy === c.card_id}
                            className="rounded-md bg-white px-2 py-1 text-xs text-slate-600 shadow-sm hover:bg-slate-50 disabled:opacity-50"
                          >
                            {busy === c.card_id ? 'Drafting…' : 'Draft with AI'}
                          </button>
                        </>
                      )}
                      <button
                        onClick={() => snooze(c.card_id)}
                        className="rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-white/60"
                      >
                        Snooze 3d
                      </button>
                    </div>
                  </div>

                  {nudges[c.card_id] && (
                    <div
                      className="mt-2 flex items-start justify-between gap-2 rounded-md bg-white p-2 text-xs text-slate-700"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span>{nudges[c.card_id]}</span>
                      <button
                        onClick={async () => flashMsg((await copyText(nudges[c.card_id])) ? 'Copied' : "Couldn't copy")}
                        className="shrink-0 text-slate-400 hover:text-slate-700"
                      >
                        Copy
                      </button>
                    </div>
                  )}
                </div>
              </Fragment>
            );
          })}
        </div>
      )}
      </div>
    </div>
  );
}


type RiskProject = { id: string; name: string; score: number; overdue: number; blocked: number; stuck: number; flags: number };

function Detail({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-slate-400">{label}</dt>
      <dd className={`truncate ${warn ? 'font-medium text-red-600' : 'text-slate-700'}`}>{value}</dd>
    </div>
  );
}
