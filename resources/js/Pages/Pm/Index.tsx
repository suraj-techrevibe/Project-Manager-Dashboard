import { Head } from '@inertiajs/react';
import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout';
import FlagsPanel from '@/Components/Pm/FlagsPanel';
import BriefDrafter from '@/Components/Pm/BriefDrafter';
import ReportsPanel from '@/Components/Pm/ReportsPanel';
import ScopeCheck from '@/Components/Pm/ScopeCheck';
import GitPanel from '@/Components/Pm/GitPanel';
import ProjectsPanel from '@/Components/Pm/ProjectsPanel';
import MeetingMinutesPanel from '@/Components/Pm/MeetingMinutesPanel';
import { Icon } from '@/Components/Pm/ui/kit';
import { setUrlParams, useUrlParam } from '@/lib/urlState';
import type { PmFlag, PmMetrics, SinceSummary, TaskFocus, WorkloadRow } from '@/types/pm';

type Tab = 'today' | 'brief' | 'reports' | 'scope' | 'git' | 'projects' | 'minutes';

const tabs: { key: Tab; label: string; short: string; icon: string }[] = [
  { key: 'today', label: 'Today', short: 'Today', icon: 'sun' },
  { key: 'projects', label: 'Projects', short: 'Projects', icon: 'folder' },
  { key: 'minutes', label: 'Meeting minutes', short: 'Minutes', icon: 'notes' },
  { key: 'brief', label: 'Brief to tickets', short: 'Brief', icon: 'list' },
  { key: 'reports', label: 'Reports', short: 'Reports', icon: 'chart' },
  { key: 'scope', label: 'Scope check', short: 'Scope', icon: 'target' },
  { key: 'git', label: 'Git', short: 'Git', icon: 'branch' },
];

export default function PmIndex({
  flags,
  metrics,
  workload,
  since,
  lastSyncedAt,
}: {
  flags: PmFlag[];
  metrics: PmMetrics;
  workload: WorkloadRow[];
  since: SinceSummary;
  lastSyncedAt: string | null;
}) {
  // The tab lives in the URL (?tab=projects) like the rest of the /pm navigation,
  // so Back/Forward and reload keep your place.
  const tabParam = useUrlParam('tab');
  const tab: Tab = tabs.some((t) => t.key === tabParam) ? (tabParam as Tab) : 'today';
  const setTab = (t: Tab) => setUrlParams({ tab: t === 'today' ? null : t, project: null, ptab: null, task: null, sub: null, minute: null });

  // Clicking a task on Today jumps to Projects -> that project -> Tasks -> the task itself.
  function openTask(f: TaskFocus) {
    setUrlParams({ tab: 'projects', project: f.projectId, ptab: 'tasks', task: f.taskId, sub: null });
  }

  return (
    <AuthenticatedLayout header={<h2 className="text-lg font-semibold text-slate-800">PM agent</h2>}>
      <Head title="PM agent" />

      <div className="mx-auto max-w-6xl px-3 py-4 sm:px-6 sm:py-6">
        {/* Main tabs: one scrollable row on phones, icons + labels everywhere. */}
        <nav aria-label="PM agent sections" className="mb-4 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {tabs.map((t) => {
              const on = tab === t.key;
              const attention = t.key === 'today' ? (metrics?.overdue ?? 0) + (metrics?.blocked ?? 0) : 0;
              return (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  aria-current={on ? 'page' : undefined}
                  className={`relative flex shrink-0 items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition ${
                    on
                      ? 'border-indigo-600 bg-indigo-50/60 text-indigo-700'
                      : 'border-transparent text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                  }`}
                >
                  <Icon name={t.icon} className="h-4 w-4" />
                  <span className="hidden sm:inline">{t.label}</span>
                  <span className="sm:hidden">{t.short}</span>
                  {attention > 0 && (
                    <span className="rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white" title="Overdue + blocked">
                      {attention}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </nav>

        {/* Kept mounted (just hidden) so filters, pins and a fresh Sync survive a trip to another tab. */}
        <div hidden={tab !== 'today'} className="flex flex-col gap-4">
          <FlagsPanel
            active={tab === 'today'}
            flags={flags}
            metrics={metrics}
            workload={workload}
            since={since}
            lastSyncedAt={lastSyncedAt}
            onOpenTask={openTask}
          />
        </div>
        {tab === 'projects' && <ProjectsPanel />}
        {tab === 'minutes' && <MeetingMinutesPanel />}
        {tab === 'brief' && <BriefDrafter />}
        {tab === 'reports' && <ReportsPanel />}
        {tab === 'scope' && <ScopeCheck />}
        {tab === 'git' && <GitPanel />}
      </div>
    </AuthenticatedLayout>
  );
}
