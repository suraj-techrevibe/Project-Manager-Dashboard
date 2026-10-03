import { Head } from '@inertiajs/react';
import { useState } from 'react';
import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout';
import FlagsPanel from '@/Components/Pm/FlagsPanel';
import BriefDrafter from '@/Components/Pm/BriefDrafter';
import ReportsPanel from '@/Components/Pm/ReportsPanel';
import ScopeCheck from '@/Components/Pm/ScopeCheck';
import GitPanel from '@/Components/Pm/GitPanel';
import ProjectsPanel from '@/Components/Pm/ProjectsPanel';
import type { PmFlag, PmMetrics, TaskFocus, WorkloadRow } from '@/types/pm';

type Tab = 'today' | 'brief' | 'reports' | 'scope' | 'git' | 'projects';

const tabs: { key: Tab; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'projects', label: 'Projects' },
  { key: 'brief', label: 'Brief to tickets' },
  { key: 'reports', label: 'Reports' },
  { key: 'scope', label: 'Scope check' },
  { key: 'git', label: 'Git' },
];

export default function PmIndex({
  flags,
  metrics,
  workload,
}: {
  flags: PmFlag[];
  metrics: PmMetrics;
  workload: WorkloadRow[];
}) {
  const [tab, setTab] = useState<Tab>('today');
  const [focus, setFocus] = useState<TaskFocus | null>(null);

  // Clicking a task on the Today tab jumps to Projects and opens that task's board.
  function openTask(f: TaskFocus) {
    setFocus(f);
    setTab('projects');
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

        {tab === 'today' && <FlagsPanel flags={flags} metrics={metrics} workload={workload} onOpenTask={openTask} />}
        {tab === 'projects' && <ProjectsPanel focus={focus} onFocusHandled={() => setFocus(null)} />}
        {tab === 'brief' && <BriefDrafter />}
        {tab === 'reports' && <ReportsPanel />}
        {tab === 'scope' && <ScopeCheck />}
        {tab === 'git' && <GitPanel />}
      </div>
    </AuthenticatedLayout>
  );
}
