import { Fragment, useEffect, useMemo, useState } from 'react';
import { pmApi } from '../../lib/pmApi';
import { setUrlParams } from '../../lib/urlState';
import type { PmFlag, PmMetrics, Severity, SinceItem, SinceSummary, TaskFocus, TodayData, WorkloadRow } from '../../types/pm';
import DigestPanel from './DigestPanel';
import EmailModal from './EmailModal';
import SinceStrip from './SinceStrip';
import TeamWorkload, { levelOf, overloadThreshold } from './TeamWorkload';

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
        return { text: 'Nobody is over capacity this week. See Team workload above for the spread.', match: () => true };
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
    run: ({ all }) => {
      const m = all.filter((c) => hasFlag(c, 'unassigned'));
      return m.length
        ? { text: `${plural(m.length, 'task')} with nobody assigned.`, match: (c) => hasFlag(c, 'unassigned') }
        : { text: 'Every open task has an assignee.', match: () => false };
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

export default function TodayDashboard({
  active: tabActive = true,
  flags: initialFlags,
  workload: initialWorkload = [],
  since: initialSince,
  lastSyncedAt: initialSynced = null,
  onOpenTask,
}: {
  /** False while another tab is showing, so shortcut keys don't fire there. */
  active?: boolean;
  flags: PmFlag[];
  /** Kept optional so older callers that still pass `metrics` keep compiling; counts are derived from `flags` below. */
  metrics?: PmMetrics;
  workload?: WorkloadRow[];
  since?: SinceSummary;
  lastSyncedAt?: string | null;
  onOpenTask: (focus: TaskFocus) => void;
}) {
  const [flags, setFlags] = useState(initialFlags);
  const [workload, setWorkload] = useState(initialWorkload);
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
  const [filter, setFilter] = useState<FlagType | 'critical' | null>(null);
  const [search, setSearch] = useState('');
  const [assignee, setAssignee] = useState('');
  const [project, setProject] = useState('');
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [pins, setPins] = useState<number[]>(loadPins);
  const [sel, setSel] = useState<number | null>(null);
  const [workloadKey, setWorkloadKey] = useState(0);
  const [showDigest, setShowDigest] = useState(false);

  const [question, setQuestion] = useState<QuestionKey | null>(null);

  const todayGreeting = (() => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; })();

  // Keeps the "Last synced 12 min ago" label honest while the page stays open.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  function flashMsg(msg: string) {
    setFlash(msg);
    setTimeout(() => setFlash((cur) => (cur === msg ? null : cur)), 2500);
  }

  function apply(d: TodayData) {
    setFlags(d.flags);
    setWorkload(d.workload);
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
    flags.forEach((f) => f.assignee?.split(',').forEach((n) => n.trim() && names.add(n.trim())));
    return Array.from(names).sort();
  }, [workload, flags]);

  const projectNames = useMemo(
    () => Array.from(new Set(flags.map((f) => f.project_name).filter((n): n is string => Boolean(n)))).sort(),
    [flags]
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

  // The clicked question's one-line answer + which cards it keeps.
  const active = useMemo(() => {
    const q = QUESTIONS.find((x) => x.key === question);
    return q ? { label: q.label, ...q.run({ all: allCards, workload, overloadAt }) } : null;
  }, [question, allCards, workload, overloadAt]);

  const isPinned = (id: number) => pins.includes(id);

  const cards: TaskCard[] = useMemo(() => {
    const dueTs = (c: TaskCard) => (c.task.due_at ? new Date(`${c.task.due_at}T00:00:00`).getTime() : Infinity);

    return allCards
      .filter((c) => !filter || (filter === 'critical' ? c.flags.some((f) => f.severity === 'danger') : c.flags.some((f) => f.type === filter)))
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
          dueTs(a) - dueTs(b)
      );
  }, [allCards, filter, active, search, assignee, project, pinnedOnly, pins]);

  const totalTasks = useMemo(() => new Set(flags.map((f) => f.card_id)).size, [flags]);
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

  return (
    <div className="space-y-6">
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

      {/* 1. Today header */}
      <section className="rounded-2xl border border-slate-200 bg-white px-5 py-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-medium text-slate-500">
              {new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-950">{todayGreeting}</h1>
            <p className="mt-1 text-sm text-slate-500">Here is what needs your attention today.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-xs ${stale ? 'font-medium text-amber-600' : 'text-slate-400'}`}>
              {lastSynced ? `Last synced ${ago(lastSynced)}` : 'Not synced yet'}
              {stale && ' · may be out of date'}
            </span>
            <button
              type="button"
              onClick={syncNow}
              disabled={syncing}
              className="rounded-lg bg-slate-900 px-3.5 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {syncing ? 'Syncing…' : 'Sync now'}
            </button>
          </div>
        </div>
        {syncError && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{syncError}</div>}
        {flash && <div className="mt-3 rounded-lg bg-slate-900 px-3 py-2 text-xs text-white">{flash}</div>}
      </section>

      {/* 2. Four decision cards — all clickable */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { key: 'critical' as const, label: 'Critical', value: new Set(flags.filter((f) => f.severity === 'danger').map((f) => f.card_id)).size, note: 'needs action', tone: 'border-red-200 bg-red-50 text-red-700' },
          { key: 'overdue' as const, label: 'Overdue', value: counts.overdue, note: 'past due', tone: 'border-red-200 bg-white text-red-700' },
          { key: 'due_today' as const, label: 'Due today', value: counts.due_today, note: 'today', tone: 'border-amber-200 bg-amber-50 text-amber-700' },
          { key: 'blocked' as const, label: 'Blocked', value: counts.blocked, note: 'waiting to move', tone: 'border-amber-200 bg-white text-amber-700' },
        ].map((item) => (
          <button
            key={item.label}
            type="button"
            onClick={() => {
              setQuestion(null);
              setFilter((cur) => (cur === item.key ? null : item.key));
              document.getElementById('today-task-queue')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}
            className={`rounded-xl border p-4 text-left transition hover:-translate-y-0.5 hover:shadow-sm ${
              filter === item.key ? 'ring-2 ring-slate-900 ring-offset-1' : ''
            } ${item.tone}`}
          >
            <p className="text-xs font-semibold uppercase tracking-wide opacity-75">{item.label}</p>
            <div className="mt-1 flex items-end gap-2">
              <span className="text-3xl font-bold">{item.value}</span>
              <span className="pb-1 text-xs opacity-70">{item.note}</span>
            </div>
          </button>
        ))}
      </section>

      {/* 3. Needs your attention */}
      <section>
        <div className="mb-3 flex items-end justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900">Needs your attention</h2>
            <p className="text-xs text-slate-500">Critical work first — not the entire task list.</p>
          </div>
          <button
            type="button"
            onClick={() => {
              setQuestion(null);
              setFilter('critical');
              document.getElementById('today-task-queue')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}
            className="text-xs font-semibold text-slate-600 hover:text-slate-900"
          >
            View all
          </button>
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          {allCards.filter((c) => c.severity === 'danger').slice(0, 6).map((c) => (
            <button
              key={c.card_id}
              type="button"
              onClick={() => open(c)}
              className={`rounded-xl border p-4 text-left shadow-sm transition hover:shadow ${severityClasses[c.severity]}`}
            >
              <div className="flex items-start gap-3">
                <span className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full bg-red-500" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate font-semibold text-slate-900">{c.task.title}</h3>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${priorityClasses[c.task.priority ?? 'Medium'] ?? priorityClasses.Medium}`}>
                      {c.task.priority ?? 'Medium'}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-xs text-slate-500">
                    {c.task.project_name || 'Standalone'} · {c.task.assignee || 'Unassigned'} · {dueLabel(c.task.due_at).text}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {c.flags.slice(0, 3).map((f) => (
                      <span key={f.type} className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${badgeClasses[f.severity]}`}>
                        {f.type.replace('_', ' ')}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </button>
          ))}
          {!allCards.some((c) => c.severity === 'danger') && (
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500 lg:col-span-2">
              Nothing critical right now.
            </div>
          )}
        </div>
      </section>

      {/* 4. At risk + Team load */}
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="font-bold text-slate-900">At risk</h2>
              <p className="text-xs text-slate-500">Warning-level tasks that deserve monitoring.</p>
            </div>
            <button
              type="button"
              onClick={() => {
                setQuestion(null);
                setFilter(null);
                setQuestion('duesoon');
                document.getElementById('today-task-queue')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
              className="text-xs font-semibold text-slate-600 hover:text-slate-900"
            >
              View tasks
            </button>
          </div>
          <div className="space-y-2">
            {allCards.filter((c) => c.severity === 'warning').slice(0, 6).map((c) => (
              <button
                key={c.card_id}
                type="button"
                onClick={() => open(c)}
                className="flex w-full items-center gap-3 rounded-lg border border-slate-100 p-3 text-left hover:bg-slate-50"
              >
                <span className="h-2 w-2 shrink-0 rounded-full bg-amber-400" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">{c.task.title}</span>
                <span className="shrink-0 text-xs text-slate-500">{c.task.project_name || 'Standalone'}</span>
              </button>
            ))}
            {!allCards.some((c) => c.severity === 'warning') && <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-500">No at-risk tasks detected.</p>}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="font-bold text-slate-900">Team load</h2>
              <p className="text-xs text-slate-500">Capacity signals for this week.</p>
            </div>
            <button
              type="button"
              onClick={showFree}
              className="text-xs font-semibold text-slate-600 hover:text-slate-900"
            >
              View workload
            </button>
          </div>
          <div className="space-y-3">
            {workload.slice().sort((a, b) => (b.week_hours ?? b.hours ?? 0) - (a.week_hours ?? a.hours ?? 0)).slice(0, 5).map((row) => {
              const capacity = row.capacity || 40;
              const hours = row.week_hours ?? row.hours ?? 0;
              const pct = Math.min(100, Math.round((hours / capacity) * 100));
              const level = levelOf(row, overloadAt);
              return (
                <div key={row.name}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-slate-800">{row.name}</span>
                    <span className={level === 'over' || level === 'heavy' ? 'font-semibold text-red-600' : level === 'balanced' ? 'font-semibold text-amber-600' : 'text-slate-500'}>
                      {hours.toFixed(1)}h / {capacity}h
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100">
                    <div className={`h-full rounded-full ${level === 'over' || level === 'heavy' ? 'bg-red-500' : level === 'balanced' ? 'bg-amber-400' : 'bg-slate-400'}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
            {!workload.length && <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-500">No workload data yet. Sync first.</p>}
          </div>
        </section>
      </div>

      {/* 5. Since last workday */}
      {since && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="font-bold text-slate-900">Since last workday</h2>
              <p className="text-xs text-slate-500">{since.tracked ? `Changes since ${since.label}.` : 'Activity tracking starts after the first sync.'}</p>
            </div>
            <button
              type="button"
              onClick={copyStandup}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Copy stand-up
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              { label: 'Completed', value: since.completed.count, tone: 'text-emerald-700 bg-emerald-50' },
              { label: 'Created', value: since.created.count, tone: 'text-blue-700 bg-blue-50' },
              { label: 'Blocked', value: since.blocked.count, tone: 'text-red-700 bg-red-50' },
              { label: 'Became overdue', value: since.overdue.count, tone: 'text-amber-700 bg-amber-50' },
            ].map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => item.label === 'Blocked' ? setFilter('blocked') : undefined}
                className={`rounded-lg px-3 py-3 text-left ${item.tone}`}
              >
                <div className="text-2xl font-bold">{item.value}</div>
                <div className="mt-0.5 text-xs font-medium">{item.label}</div>
              </button>
            ))}
          </div>
          {since.idle.length > 0 && (
            <p className="mt-3 text-xs text-slate-500">{since.idle.length} task{since.idle.length === 1 ? '' : 's'} reported as idle since the last workday.</p>
          )}
        </section>
      )}

      {/* 6. Quick actions */}
      <section>
        <div className="mb-3">
          <h2 className="text-base font-bold text-slate-900">Quick actions</h2>
          <p className="text-xs text-slate-500">Jump straight to the work you normally do.</p>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: 'Projects', hint: 'Health & tasks', action: () => setUrlParams({ tab: 'projects', project: null, ptab: null, task: null, sub: null }) },
            { label: 'Meeting minutes', hint: 'Actions & follow-ups', action: () => setUrlParams({ tab: 'minutes', project: null, ptab: null, task: null, sub: null, minute: null }) },
            { label: 'Automation', hint: 'Nudges & rules', action: () => setUrlParams({ tab: 'automation', project: null, ptab: null, task: null, sub: null }) },
            { label: 'Brief to tickets', hint: 'Create new work', action: () => setUrlParams({ tab: 'brief', project: null, ptab: null, task: null, sub: null }) },
          ].map((item) => (
            <button key={item.label} type="button" onClick={item.action} className="rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm hover:border-slate-300 hover:bg-slate-50">
              <div className="text-sm font-semibold text-slate-900">{item.label}</div>
              <div className="mt-1 text-xs text-slate-500">{item.hint}</div>
            </button>
          ))}
        </div>
      </section>

      {/* 7. Deterministic questions + detailed filters */}
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <details>
          <summary className="cursor-pointer list-none px-5 py-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-bold text-slate-900">Ask / filter tasks</h2>
                <p className="text-xs text-slate-500">Predefined questions and exact filters — no AI involved.</p>
              </div>
              <span className="text-xs text-slate-400">Expand</span>
            </div>
          </summary>
          <div className="border-t border-slate-100 px-5 py-4">
            <div className="flex flex-wrap gap-1.5">
              {QUESTIONS.map((q) => (
                <button
                  key={q.key}
                  type="button"
                  onClick={() => {
                    if (question === q.key) return setQuestion(null);
                    clearFilters();
                    setQuestion(q.key);
                    setTimeout(() => document.getElementById('today-task-queue')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
                  }}
                  className={`rounded-md border px-2.5 py-1.5 text-xs transition ${
                    question === q.key ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {q.label}
                </button>
              ))}
            </div>
            {active && (
              <div className="mt-3 flex items-start justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                <div>
                  <div className="mb-0.5 text-xs text-slate-400">{active.label}</div>
                  {active.text}
                </div>
                <button type="button" onClick={() => setQuestion(null)} className="text-xs text-slate-400 hover:text-slate-700">Clear</button>
              </div>
            )}
            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              <input
                id="flag-search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search title, project, person, tag…"
                className={`${selectCls} w-full`}
              />
              <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className={selectCls}>
                <option value="">Everyone</option>
                <option value={UNASSIGNED}>Unassigned</option>
                {people.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
              <select value={project} onChange={(e) => setProject(e.target.value)} className={selectCls}>
                <option value="">All projects</option>
                <option value={STANDALONE}>Standalone tasks</option>
                {projectNames.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <button
                type="button"
                onClick={() => setPinnedOnly((v) => !v)}
                className={`rounded-md border px-2.5 py-1 ${pinnedOnly ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 hover:bg-slate-50'}`}
              >
                ★ Focus {pins.length ? `(${pins.length}/${MAX_PINS})` : ''}
              </button>
              {filtersActive && (
                <>
                  <span>Showing {cards.length} of {totalTasks} flagged tasks</span>
                  <button type="button" onClick={clearFilters} className="font-medium text-slate-700 underline">Clear filters</button>
                </>
              )}
            </div>
          </div>
        </details>
      </section>

      {/* 8. Full task queue keeps the old actions, but is separated from the Today summary. */}
      <section id="today-task-queue" className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-bold text-slate-900">Task queue</h2>
            <p className="text-xs text-slate-500">
              {filtersActive ? `Showing ${cards.length} of ${totalTasks} flagged tasks.` : `${totalTasks} flagged tasks need review.`}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {pins.length > 0 && (
              <button type="button" onClick={() => setPinnedOnly((v) => !v)} className={`rounded-md border px-2.5 py-1.5 text-xs ${pinnedOnly ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                ★ Focus ({pins.length}/{MAX_PINS})
              </button>
            )}
            <button type="button" onClick={() => setShowDigest((v) => !v)} className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50">
              Morning digest
            </button>
          </div>
        </div>

        {showDigest && <div className="border-b border-slate-100 px-5 py-4"><DigestPanel onClose={() => setShowDigest(false)} /></div>}

        {cards.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">{filtersActive ? 'Nothing matches those filters.' : 'No flags. Board looks healthy.'}</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {cards.map((c, idx) => {
              const t = c.task;
              const due = dueLabel(t.due_at);
              const canOpen = Boolean((t.project_id && t.task_id) || t.url);
              const needsVerify = c.flags.some((f) => f.type === 'unverified');
              const pinned = isPinned(c.card_id);
              const nudged = nudgedLabel(lastNudge(c));
              return (
                <div
                  key={c.card_id}
                  id={`flag-${c.card_id}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSel(c.card_id)}
                  className={`px-5 py-4 transition hover:bg-slate-50 ${sel === c.card_id ? 'bg-slate-50 ring-1 ring-inset ring-slate-300' : ''}`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${c.severity === 'danger' ? 'bg-red-500' : c.severity === 'warning' ? 'bg-amber-400' : 'bg-slate-300'}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <button type="button" onClick={(e) => { e.stopPropagation(); if (canOpen) open(c); }} className="text-left font-semibold text-slate-900 hover:underline">{t.title}</button>
                        {t.priority && <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${priorityClasses[t.priority] ?? priorityClasses.Medium}`}>{t.priority}</span>}
                        {t.status && <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${statusClasses[t.status] ?? statusClasses.Pending}`}>{t.status}</span>}
                        {pinned && <span className="text-[10px] font-semibold text-slate-500">★ pinned</span>}
                      </div>
                      <p className="mt-1 text-xs text-slate-500">{t.project_name || 'Standalone task'} · {t.assignee || 'Unassigned'} · {due.text} · {activityLabel(t.last_activity_at)}</p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {c.flags.map((f) => <span key={f.type} className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${badgeClasses[f.severity]}`}>{f.type.replace('_', ' ')}</span>)}
                        {nudged && <span className={`rounded-full px-2 py-0.5 text-[10px] ${nudged.recent ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>{nudged.text}</span>}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-1.5" onClick={(e) => e.stopPropagation()}>
                        <button type="button" disabled={!canOpen} onClick={() => open(c)} className="rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-white disabled:opacity-40">Open</button>
                        <button type="button" onClick={() => togglePin(c.card_id)} className="rounded-md border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:bg-white">{pinned ? 'Unpin' : 'Pin'}</button>
                        <button type="button" onClick={() => copyNudge(c)} disabled={!t.assignee} className="rounded-md border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:bg-white disabled:opacity-40">Copy nudge</button>
                        <button type="button" onClick={() => setEmailFor(c)} disabled={!t.assignee} className="rounded-md border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:bg-white disabled:opacity-40">Email</button>
                        {needsVerify && <button type="button" onClick={() => verify(c.card_id)} className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700">Verify</button>}
                        <button type="button" onClick={() => snooze(c.card_id)} className="rounded-md border border-slate-200 px-2.5 py-1 text-xs text-slate-500 hover:bg-white">Snooze 3d</button>
                      </div>
                      {nudges[c.card_id] && (
                        <div className="mt-2 rounded-lg bg-slate-50 p-2 text-xs text-slate-700" onClick={(e) => e.stopPropagation()}>
                          {nudges[c.card_id]}
                        </div>
                      )}
                    </div>
                    <span className="hidden text-[11px] text-slate-400 sm:block">{idx + 1}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Existing rich workload/detail view is still available, but no longer dominates Today. */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <details>
          <summary className="cursor-pointer list-none px-5 py-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-bold text-slate-900">Detailed workload</h2>
                <p className="text-xs text-slate-500">Open the full team workload breakdown when you need it.</p>
              </div>
              <span className="text-xs text-slate-400">Expand</span>
            </div>
          </summary>
          <div id="team-workload" className="border-t border-slate-100 px-5 py-4">
            <TeamWorkload workload={workload} selected={assignee} onSelect={setAssignee} forceOpen={workloadKey} />
          </div>
        </details>
      </div>

      {/* Keep the original Since strip available for individual change navigation. */}
      {since && <SinceStrip since={since} onOpenItem={openSinceItem} onShowFree={showFree} />}
    </div>
  );

}

function Detail({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-slate-400">{label}</dt>
      <dd className={`truncate ${warn ? 'font-medium text-red-600' : 'text-slate-700'}`}>{value}</dd>
    </div>
  );
}