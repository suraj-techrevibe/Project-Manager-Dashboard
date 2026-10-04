import { Head } from '@inertiajs/react';
import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout';
import TodayDashboard from '@/Components/Pm/TodayDashboard';
import BriefDrafter from '@/Components/Pm/BriefDrafter';
import ReportsPanel from '@/Components/Pm/ReportsPanel';
import ScopeCheck from '@/Components/Pm/ScopeCheck';
import GitPanel from '@/Components/Pm/GitPanel';
import ProjectsPanel from '@/Components/Pm/ProjectsPanel';
import MeetingMinutesPanel from '@/Components/Pm/MeetingMinutesPanel';
import AutomationPanel from '@/Components/Pm/AutomationPanel';
import { setUrlParams, useUrlParam } from '@/lib/urlState';
import type { PmFlag, PmMetrics, SinceSummary, TaskFocus, WorkloadRow } from '@/types/pm';

type Tab = 'today' | 'brief' | 'reports' | 'scope' | 'git' | 'projects' | 'minutes' | 'automation';

const tabs: { key: Tab; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'projects', label: 'Projects' },
  { key: 'minutes', label: 'Meeting minutes' },
  { key: 'automation', label: 'Automation' },
  { key: 'brief', label: 'Brief to tickets' },
  { key: 'reports', label: 'Reports' },
  { key: 'scope', label: 'Scope check' },
  { key: 'git', label: 'Git' },
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
    <AuthenticatedLayout header={<h2 className="text-lg font-medium text-slate-800">PM agent</h2>}>
      <Head title="PM agent" />

      <div className="mx-auto max-w-6xl px-4 py-6">
        <div className="mb-4 flex flex-wrap gap-1.5">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`rounded-md px-3 py-1.5 text-sm ${
                tab === t.key
                  ? 'bg-slate-900 text-white'
                  : 'border border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Kept mounted (just hidden) so filters, pins and a fresh Sync survive a trip to another tab. */}
        <div hidden={tab !== 'today'}>
          <TodayDashboard
            flags={flags}
            workload={workload}
            since={since}
            lastSyncedAt={lastSyncedAt}
            onOpenTask={openTask}
          />
        </div>
        {tab === 'projects' && <ProjectsPanel />}
        {tab === 'minutes' && <MeetingMinutesPanel />}
        {tab === 'automation' && <AutomationPanel />}
        {tab === 'brief' && <BriefDrafter />}
        {tab === 'reports' && <ReportsPanel />}
        {tab === 'scope' && <ScopeCheck />}
        {tab === 'git' && <GitPanel />}
      </div>
    </AuthenticatedLayout>
  );
}
