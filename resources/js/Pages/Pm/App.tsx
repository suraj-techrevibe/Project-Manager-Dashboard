import { Head } from '@inertiajs/react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import PmShell from '@/Components/Pm/PmShell';
import QuickSearch from '@/Components/Pm/QuickSearch';
import { ask } from '@/lib/assistantStore';
import MeetingFollowUpCard from '@/Components/Pm/MeetingFollowUpCard';
import type { AllTask } from '@/Components/Pm/AllTasksPanel';
import TasksPage from '@/Components/Pm/TasksPage';
import TodayCommandCenter, { type CcCard, type CcAnswer, type RiskProject } from '@/Components/Pm/TodayCommandCenter';
import BriefDrafter from '@/Components/Pm/BriefDrafter';
import GitPanel from '@/Components/Pm/GitPanel';
import MeetingMinutesPanel from '@/Components/Pm/StructuredMeetingMinutesPanel';
import ProjectsPanel from '@/Components/Pm/ProjectsPanel';
import ReportsPanel from '@/Components/Pm/ReportsPanel';
import ScopeCheck from '@/Components/Pm/ScopeCheck';
import RequestsIdeasPanel from '@/Components/Pm/RequestsIdeasPanel';
import OperationsTodayPanel from '@/Components/Pm/OperationsTodayPanel';
import QACenter from '@/Components/Pm/QACenter';
import { pmApi } from '@/lib/pmApi';
import { PM_PAGES, usePmPage, visitPm, type PmPage } from '@/lib/pmNav';
import type { PmFlag, TaskFocus, TodayData, Project } from '@/types/pm';

/** Tabs whose data is loaded on mount; they are re-mounted every time you come back so they never show stale data. Their place (open project / meeting) lives in the URL, so nothing is lost. */
const REFETCH_ON_OPEN: PmPage[] = ['operations', 'projects', 'minutes', 'reports'];

/** A tab's panel, mounted the first time you open it and then only hidden — so coming back is instant. */
function Pane({ show, children }: { show: boolean; children: ReactNode }) {
  return <div hidden={!show}>{children}</div>;
}

/**
 * The whole PM dashboard as ONE Inertia page. Tabs switch in the browser (see lib/pmNav);
 * Laravel is only asked for data, never for a new page. Today's data comes with the first
 * page load when you open /pm, otherwise it is fetched the first time you open Today.
 */
export default function PmApp(props: Partial<TodayData> & { page?: PmPage }) {
  const page = usePmPage(props.page);
  const [visited, setVisited] = useState<Set<PmPage>>(() => new Set<PmPage>([page]));

  const [today, setToday] = useState<TodayData | null>(props.flags ? (props as TodayData) : null);
  const [todayError, setTodayError] = useState<string | null>(null);
  const [todayLoading, setTodayLoading] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncNotice, setSyncNotice] = useState(false);
  const [showDigest, setShowDigest] = useState(false);
  const [digestLoading, setDigestLoading] = useState(false);
  const [digestText, setDigestText] = useState<string | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [quickSearch, setQuickSearch] = useState('');
  const [quickSearchOpen, setQuickSearchOpen] = useState(false);

  const seen = useRef<Set<PmPage>>(new Set());
  const [gen, setGen] = useState<Partial<Record<PmPage, number>>>({});

  const loadToday = useCallback(async () => {
    setTodayLoading(true);
    setTodayError(null);
    try {
      const { data } = await pmApi.today();
      setToday(data);
    } catch {
      setTodayError("Couldn't load Today.");
    } finally {
      setTodayLoading(false);
    }
  }, []);

  // Every panel stays mounted once opened, so a panel only loads its data when it first mounts.
  // Without this, tasks pushed from Brief, minutes saved, or edits in Projects would not show
  // up in the other tabs until a full page reload. Refresh whenever a tab is (re)opened.
  useEffect(() => {
    setVisited((v) => (v.has(page) ? v : new Set(v).add(page)));
    window.scrollTo({ top: 0 });

    if (seen.current.has(page)) {
      if (REFETCH_ON_OPEN.includes(page)) setGen((g) => ({ ...g, [page]: (g[page] ?? 0) + 1 }));
      if (page === 'today' || page === 'tasks') void loadToday();
    } else if ((page === 'today' || page === 'tasks') && !props.flags) {
      void loadToday(); // /pm/projects etc. load without Today's payload
    }
    seen.current.add(page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  // Clicking a task on Today opens Projects -> that project -> Tasks -> the task itself.
  const openTask = (f: TaskFocus) => visitPm('projects', { project: f.projectId, ptab: 'tasks', task: f.taskId, sub: f.subId });

  // A failed refresh must never wipe projects we already have, and an empty (or failed)
  // result must never trigger an automatic re-fetch — that loop used to burn the
  // /pm/api throttle and blank the Today timeline / Tasks views.
  const projectsLoaded = useRef(false);
  const projectsInFlight = useRef(false);

  const loadProjects = useCallback(async () => {
    if (projectsInFlight.current) return;
    projectsInFlight.current = true;
    setProjectsLoading(true);
    try {
      const { data } = await pmApi.projects();
      setProjects(data.projects);
      projectsLoaded.current = true;
    } catch {
      // Keep whatever projects are already on screen; the next tab visit or Sync now retries.
    } finally {
      projectsInFlight.current = false;
      setProjectsLoading(false);
    }
  }, []);

  // Load once per tab visit (and only until the first success) — keyed on `page` alone.
  useEffect(() => {
    if ((page === 'today' || page === 'tasks') && !projectsLoaded.current) void loadProjects();
  }, [page, loadProjects]);

  const handleSync = async () => {
    setSyncing(true);
    setSyncNotice(false);
    const noticeTimer = window.setTimeout(() => setSyncNotice(true), 10_000);
    try {
      await pmApi.sync();
      await loadToday();
      await loadProjects();
    } catch (e) {
      const message = (e as { response?: { data?: { error?: string; message?: string } } })?.response?.data?.error
        ?? (e as { response?: { data?: { message?: string } } })?.response?.data?.message
        ?? (e instanceof Error ? e.message : null);
      setTodayError(message ? `Sync failed: ${message}` : "Couldn't sync Today.");
    } finally {
      window.clearTimeout(noticeTimer);
      setSyncing(false);
      setSyncNotice(false);
    }
  };

  const handleNudge = async (card: CcCard) => {
    try {
      await pmApi.nudge(card.card_id);
      await pmApi.nudged(card.card_id);
      await loadToday();
    } catch {
      // Keep the dashboard usable if the nudge endpoint fails.
    }
  };

  const handleDigest = async () => {
    const next = !showDigest;
    setShowDigest(next);

    if (!next) return;

    // Render the digest shell first, then jump to it immediately.
    requestAnimationFrame(() => {
      document.getElementById('morning-digest')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    if (digestText) return;

    setDigestLoading(true);
    try {
      const { data } = await pmApi.digest();
      setDigestText(data.text);
    } catch {
      setDigestText(null);
    } finally {
      setDigestLoading(false);
    }
  };

  const copyStandup = async () => {
    const m = today?.metrics;
    const text = [
      'PM stand-up',
      m ? `Overdue: ${m.overdue} · Blocked: ${m.blocked} · Due today: ${m.due_today} · No owner: ${m.unassigned}` : '',
      today?.since ? `Since ${today.since.label}: ${today.since.completed.count} completed · ${today.since.created.count} created · ${today.since.blocked.count} blocked` : '',
    ].filter(Boolean).join('\n');
    try { await navigator.clipboard.writeText(text); } catch {}
  };

  const attention = (today?.metrics?.overdue ?? 0) + (today?.metrics?.blocked ?? 0);

  const commandCards: CcCard[] = today
    ? Object.values(today.flags.reduce<Record<number, CcCard>>((acc, flag) => {
        const existing = acc[flag.card_id];
        if (existing) {
          existing.flags.push(flag);
          if (flag.severity === 'danger' || (flag.severity === 'warning' && existing.severity === 'neutral')) existing.severity = flag.severity;
        } else {
          acc[flag.card_id] = { card_id: flag.card_id, task: flag, flags: [flag], severity: flag.severity };
        }
        return acc;
      }, {}))
    : [];

  const counts = today
    ? {
        overdue: today.metrics.overdue,
        blocked: today.metrics.blocked,
        due_today: today.metrics.due_today,
        stuck: today.metrics.stuck,
        unassigned: today.metrics.unassigned,
        unverified: today.metrics.unverified,
        due_soon: today.metrics.due_soon,
        subtasks_incomplete: today.metrics.subtasks_incomplete,
      }
    : { overdue: 0, blocked: 0, due_today: 0, stuck: 0, unassigned: 0, unverified: 0, due_soon: 0, subtasks_incomplete: 0 };

  const cardByFlag = (type: PmFlag['type']) => commandCards.filter((c) => c.flags.some((f) => f.type === type));
  const agingCards = cardByFlag('stuck');
  const unassignedTasks = cardByFlag('unassigned');
  const waitingCards = commandCards.filter((c) => {
    const text = [c.task.title, c.task.detail, c.task.description].filter(Boolean).join(' ').toLowerCase();
    return /\\b(waiting|awaiting|feedback|approval|client)\\b/.test(text);
  });

  const riskProjects: RiskProject[] = Object.values(commandCards.reduce<Record<string, RiskProject>>((acc, c) => {
    const id = c.task.project_id;
    if (!id) return acc;
    const r = acc[id] ?? { id, name: c.task.project_name ?? 'Project', score: 100, overdue: 0, blocked: 0, stuck: 0, flags: 0 };
    r.flags += c.flags.length;
    if (c.flags.some((f) => f.type === 'overdue')) r.overdue++;
    if (c.flags.some((f) => f.type === 'blocked')) r.blocked++;
    if (c.flags.some((f) => f.type === 'stuck')) r.stuck++;
    acc[id] = r;
    return acc;
  }, {})).map((r) => ({ ...r, score: Math.max(0, 100 - r.overdue * 15 - r.blocked * 20 - r.stuck * 10) }))
    .sort((a, b) => a.score - b.score);

  const answers: CcAnswer[] = [
    { key: 'overdue', label: 'Overdue', text: counts.overdue ? `${counts.overdue} task(s) are already late.` : 'Nothing is late.', count: counts.overdue },
    { key: 'blocking', label: 'Blocked', text: counts.blocked ? `${counts.blocked} task(s) are blocked.` : 'Nothing is blocked.', count: counts.blocked },
    { key: 'duesoon', label: 'Due soon', text: counts.due_today + counts.due_soon ? `${counts.due_today + counts.due_soon} task(s) are due today or within 3 days.` : 'No near-term due dates.', count: counts.due_today + counts.due_soon },
    { key: 'unowned', label: 'No owner', text: unassignedTasks.length + (today?.subtasks.length ?? 0) ? `${unassignedTasks.length + (today?.subtasks.length ?? 0)} item(s) need an owner.` : 'Everything has an owner.', count: unassignedTasks.length + (today?.subtasks.length ?? 0) },
    { key: 'stuck', label: 'Stuck', text: agingCards.length ? `${agingCards.length} task(s) have had no movement for 3+ days.` : 'No task is stalled.', count: agingCards.length },
    { key: 'unverified', label: 'Verify', text: counts.unverified ? `${counts.unverified} completed task(s) still need checking.` : 'Nothing is waiting for verification.', count: counts.unverified },
    { key: 'overloaded', label: 'Capacity', text: `${(today?.workload ?? []).filter((w) => (w.week_hours ?? 0) > (w.capacity ?? 40)).length} people are over weekly capacity.`, count: (today?.workload ?? []).filter((w) => (w.week_hours ?? 0) > (w.capacity ?? 40)).length },
    { key: 'free', label: 'Free capacity', text: `${(today?.workload ?? []).filter((w) => w.open === 0).length} people have no open work.`, count: (today?.workload ?? []).filter((w) => w.open === 0).length },
    { key: 'worst', label: 'Project risk', text: riskProjects.length ? `${riskProjects[0].name} has the most warning signals.` : 'No project warning signals.', count: riskProjects.length },
  ];
  const current = PM_PAGES.find((p) => p.key === page)!;
  const allTasks = ((today as (TodayData & { tasks?: AllTask[] }) | null)?.tasks ?? []);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setQuickSearchOpen(true);
      }
      if (e.key === 'Escape') setQuickSearchOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
  const mounted = (key: PmPage) => visited.has(key) || page === key;

  return (
    <PmShell page={page} attention={attention} onOpenSearch={() => setQuickSearchOpen(true)}>
      <Head title={`${current.label} · Company Operations`} />
      <QuickSearch
        open={quickSearchOpen}
        query={quickSearch}
        onQuery={setQuickSearch}
        onClose={() => setQuickSearchOpen(false)}
        tasks={allTasks}
        projects={projects}
        onOpenTask={openTask}
        onAsk={ask}
      />

      <div>
        {mounted('today') && (
          <Pane show={page === 'today'}>
            {today ? (
              <div className="flex flex-col gap-4">
                <OperationsTodayPanel
                  summary={today.operations_summary}
                  onNavigate={(tab) => visitPm(tab as PmPage)}
                  onCapture={(kind) => visitPm('operations', { new: kind })}
                />
                <details open className="group rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
                  <summary className="cursor-pointer list-none px-4 py-3 marker:hidden [&::-webkit-details-marker]:hidden">
                    <span className="flex items-center justify-between gap-3">
                      <span>
                        <span className="block text-sm font-semibold tracking-tight text-slate-900">Daily PM monitoring</span>
                        <span className="block text-xs text-slate-500">Workload, task flags, blockers, verification and team activity</span>
                      </span>
                      <span className="text-slate-400 transition group-open:rotate-180">⌄</span>
                    </span>
                  </summary>
                  <div className="border-t border-slate-100 bg-slate-50/60 p-3 sm:p-4">
                <TodayCommandCenter
                  counts={counts}
                  workload={today.workload}
                  overloadAt={40}
                  cards={commandCards}
                  riskProjects={riskProjects}
                  waitingCards={waitingCards}
                  agingCards={agingCards}
                  unassignedTasks={unassignedTasks}
                  unassignedSubtasks={today.subtasks}
                  subtaskSummary={today.subtask_summary}
                  staff={today.staff}
                  since={today.since}
                  timelineProjects={projects}
                  projectsLoading={projectsLoading}
                  lastSynced={today.lastSyncedAt}
                  stale={today.lastSyncedAt ? Date.now() - new Date(today.lastSyncedAt).getTime() > 86_400_000 : true}
                  syncing={syncing}
                  syncNotice={syncNotice}
                  onSync={() => void handleSync()}
                  showDigest={showDigest}
                  digestText={digestText}
                  digestLoading={digestLoading}
                  onToggleDigest={() => void handleDigest()}
                  onCopyStandup={() => void copyStandup()}
                  pinCount={0}
                  maxPins={6}
                  pinnedOnly={pinnedOnly}
                  onTogglePinned={() => setPinnedOnly((v) => !v)}
                  answers={answers}
                  activeKey={activeKey}
                  onAsk={setActiveKey}
                  onClearAsk={() => setActiveKey(null)}
                  onShowTaskList={(filter) => {
                    if (filter === 'free' || filter === 'overloaded') {
                      requestAnimationFrame(() => document.getElementById('team-workload')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
                      return;
                    }
                    // The full task list lives on the All tasks tab — open it with the matching quick filter.
                    const quick: Record<string, string> = {
                      blocking: 'blocked', blocked: 'blocked', duesoon: 'week', due_soon: 'week', due_today: 'week',
                      unowned: 'unassigned', unassigned: 'unassigned', overdue: 'overdue', open: 'open', done_since: 'done',
                    };
                    visitPm('tasks', { tq: quick[filter] ?? 'open' });
                  }}
                  onFilter={(type) => {
                    setActiveKey(type === 'blocked' ? 'blocking' : type === 'due_today' ? 'duesoon' : type);
                    document.getElementById(type === 'stuck' ? 'stalled' : type === 'unassigned' ? 'no-owner' : 'act-now')?.scrollIntoView({ behavior: 'smooth' });
                  }}
                  onOpenCard={(card) => card.task.project_id && card.task.task_id ? openTask({ projectId: card.task.project_id, taskId: card.task.task_id }) : undefined}
                  onNudgeCard={(card) => void handleNudge(card)}
                  onOpenTask={openTask}
                  onAssignTask={(card, employeeId) => {
                    if (!card.task.project_id || !card.task.task_id) return;
                    void pmApi.updateProjectTask(card.task.project_id, card.task.task_id, { assignedToId: [employeeId] }).then(() => loadToday());
                  }}
                  onAssignSubtask={(id, employeeId) => void pmApi.assignSubtask(id, employeeId).then(() => loadToday())}
                  onOpenSince={(item) => item.project_id && item.task_id ? openTask({ projectId: item.project_id, taskId: item.task_id }) : undefined}
                  onShowFree={() => document.getElementById('capacity')?.scrollIntoView({ behavior: 'smooth' })}
                  onPickPerson={() => document.getElementById('team-workload')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                  onNavigate={(tab) => visitPm(tab as PmPage)}
                  onOpenProject={(id) => visitPm('projects', { project: id })}
                />
                  </div>
                </details>
                <details className="rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
                  <summary className="cursor-pointer px-4 py-3 text-sm font-semibold tracking-tight text-slate-900">Meeting follow-ups</summary>
                  <div className="border-t border-slate-100 p-3"><MeetingFollowUpCard data={today.meeting_followup} /></div>
                </details>
              </div>
            ) : (
              <div className="rounded-xl border border-slate-200/80 bg-white p-6 text-sm text-slate-500">
                {todayError ? <>{todayError}{' '}<button onClick={() => void loadToday()} className="underline">Try again</button></> : 'Loading Today…'}
              </div>
            )}
          </Pane>
        )}

        {mounted('tasks') && (
          <Pane show={page === 'tasks'}>
            <TasksPage
              tasks={today ? allTasks : null}
              loading={todayLoading}
              error={todayError}
              onRetry={() => void loadToday()}
              projects={projects}
              projectsLoading={projectsLoading}
              onOpenTask={openTask}
            />
          </Pane>
        )}

        {mounted('operations') && <Pane show={page === 'operations'}><RequestsIdeasPanel key={gen.operations ?? 0} /></Pane>}
        {mounted('projects') && <Pane show={page === 'projects'}><ProjectsPanel key={gen.projects ?? 0} seedProjects={projects} onProjectsChange={setProjects} /></Pane>}
        {mounted('minutes') && <Pane show={page === 'minutes'}><MeetingMinutesPanel key={gen.minutes ?? 0} /></Pane>}
        {mounted('brief') && <Pane show={page === 'brief'}><BriefDrafter /></Pane>}
        {mounted('reports') && <Pane show={page === 'reports'}><ReportsPanel key={gen.reports ?? 0} /></Pane>}
        {mounted('scope') && <Pane show={page === 'scope'}><ScopeCheck /></Pane>}
        {mounted('git') && <Pane show={page === 'git'}><GitPanel /></Pane>}
        {mounted('qa') && <Pane show={page === 'qa'}><QACenter /></Pane>}
      </div>
    </PmShell>
  );
}
