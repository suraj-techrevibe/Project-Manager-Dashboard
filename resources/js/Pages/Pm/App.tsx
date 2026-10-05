import { Head } from '@inertiajs/react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout';
import FlagsPanel from '@/Components/Pm/FlagsPanel';
import AllTasksPanel, { type AllTask } from '@/Components/Pm/AllTasksPanel';
import BriefDrafter from '@/Components/Pm/BriefDrafter';
import GitPanel from '@/Components/Pm/GitPanel';
import MeetingMinutesPanel from '@/Components/Pm/MeetingMinutesPanel';
import ProjectsPanel from '@/Components/Pm/ProjectsPanel';
import ReportsPanel from '@/Components/Pm/ReportsPanel';
import ScopeCheck from '@/Components/Pm/ScopeCheck';
import { Icon } from '@/Components/Pm/ui/kit';
import { pmApi } from '@/lib/pmApi';
import { PM_PAGES, usePmPage, visitPm, type PmPage } from '@/lib/pmNav';
import type { TaskFocus, TodayData } from '@/types/pm';

const LOOK: Record<PmPage, { icon: string; short: string }> = {
  today: { icon: 'sun', short: 'Today' },
  projects: { icon: 'folder', short: 'Projects' },
  minutes: { icon: 'notes', short: 'Minutes' },
  brief: { icon: 'list', short: 'Brief' },
  reports: { icon: 'chart', short: 'Reports' },
  scope: { icon: 'target', short: 'Scope' },
  git: { icon: 'branch', short: 'Git' },
};

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
  const [showAllTasks, setShowAllTasks] = useState(false);

  useEffect(() => {
    setVisited((v) => (v.has(page) ? v : new Set(v).add(page)));
    window.scrollTo({ top: 0 });
  }, [page]);

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

  useEffect(() => {
    if (page === 'today' && !today && !todayLoading && !todayError) void loadToday();
  }, [page, today, todayLoading, todayError, loadToday]);

  // Clicking a task on Today opens Projects -> that project -> Tasks -> the task itself.
  const openTask = (f: TaskFocus) => visitPm('projects', { project: f.projectId, ptab: 'tasks', task: f.taskId, sub: f.subId });

  const attention = (today?.metrics?.overdue ?? 0) + (today?.metrics?.blocked ?? 0);
  const current = PM_PAGES.find((p) => p.key === page)!;
  const mounted = (key: PmPage) => visited.has(key) || page === key;
  const allTasks = ((today as (TodayData & { tasks?: AllTask[] }) | null)?.tasks ?? []);

  return (
    <AuthenticatedLayout header={<h2 className="text-lg font-semibold text-slate-800">PM agent</h2>}>
      <Head title={`${current.label} · PM agent`} />

      <div className="mx-auto max-w-6xl px-3 py-4 sm:px-6 sm:py-6">
        <nav aria-label="PM agent sections" className="mb-4 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {PM_PAGES.map((p) => {
              const on = p.key === page;
              const badge = p.key === 'today' ? attention : 0;
              return (
                <a
                  key={p.key}
                  href={p.href}
                  aria-current={on ? 'page' : undefined}
                  onClick={(e) => {
                    // Let ctrl/cmd/middle-click open a new browser tab as usual.
                    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                    e.preventDefault();
                    // Clicking the tab you're already on resets it to its start screen.
                    visitPm(p.key, on ? {} : undefined);
                  }}
                  className={`relative flex shrink-0 items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition ${
                    on
                      ? 'border-indigo-600 bg-indigo-50/60 text-indigo-700'
                      : 'border-transparent text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                  }`}
                >
                  <Icon name={LOOK[p.key].icon} className="h-4 w-4" />
                  <span className="hidden sm:inline">{p.label}</span>
                  <span className="sm:hidden">{LOOK[p.key].short}</span>
                  {badge > 0 && (
                    <span className="rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white" title="Overdue + blocked">
                      {badge}
                    </span>
                  )}
                </a>
              );
            })}
          </div>
        </nav>

        {mounted('today') && (
          <Pane show={page === 'today'}>
            {today ? (
              <div className="flex flex-col gap-3">
                <div className="flex justify-end">
                  <button
                    onClick={() => setShowAllTasks((v) => !v)}
                    className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 shadow-sm hover:bg-slate-50"
                  >
                    {showAllTasks ? 'Back to flags' : `All tasks${allTasks.length ? ` (${allTasks.length})` : ''}`}
                  </button>
                </div>
                {showAllTasks ? (
                  <AllTasksPanel tasks={allTasks} onOpenTask={openTask} onBack={() => setShowAllTasks(false)} />
                ) : (
                  <FlagsPanel
                    active={page === 'today'}
                    flags={today.flags}
                    metrics={today.metrics}
                    workload={today.workload}
                    since={today.since}
                    lastSyncedAt={today.lastSyncedAt}
                    onOpenTask={openTask}
                  />
                )}
              </div>
            ) : (
              <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
                {todayError ? (
                  <>
                    {todayError}{' '}
                    <button onClick={() => void loadToday()} className="underline">
                      Try again
                    </button>
                  </>
                ) : (
                  'Loading Today…'
                )}
              </div>
            )}
          </Pane>
        )}
        {mounted('projects') && <Pane show={page === 'projects'}><ProjectsPanel /></Pane>}
        {mounted('minutes') && <Pane show={page === 'minutes'}><MeetingMinutesPanel /></Pane>}
        {mounted('brief') && <Pane show={page === 'brief'}><BriefDrafter /></Pane>}
        {mounted('reports') && <Pane show={page === 'reports'}><ReportsPanel /></Pane>}
        {mounted('scope') && <Pane show={page === 'scope'}><ScopeCheck /></Pane>}
        {mounted('git') && <Pane show={page === 'git'}><GitPanel /></Pane>}
      </div>
    </AuthenticatedLayout>
  );
}
