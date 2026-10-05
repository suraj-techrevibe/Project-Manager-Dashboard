import PmLayout from '@/Layouts/PmLayout';
import FlagsPanel from '@/Components/Pm/FlagsPanel';
import { isPmPage, visitPm } from '@/lib/pmNav';
import type { Employee, PmFlag, PmMetrics, PmTask, SinceSummary, SubtaskFlag, TaskFocus, WorkloadRow } from '@/types/pm';

export default function PmIndex({
  flags,
  tasks,
  metrics,
  workload,
  subtasks,
  staff,
  since,
  lastSyncedAt,
}: {
  flags: PmFlag[];
  /** Every synced task, flagged or not — powers the "All tasks" view. */
  tasks: PmTask[];
  metrics: PmMetrics;
  workload: WorkloadRow[];
  subtasks: SubtaskFlag[];
  staff: Employee[];
  since: SinceSummary;
  lastSyncedAt: string | null;
}) {
  // Today is its own page now. These callbacks jump to another page — or straight into
  // one project / task / sub-task on the Projects page.
  const goTab = (t: string) => isPmPage(t) && visitPm(t);
  const openProject = (id: string) => visitPm('projects', { project: id });
  const openTask = (f: TaskFocus) => visitPm('projects', { project: f.projectId, ptab: 'tasks', task: f.taskId, sub: f.subId });

  return (
    <PmLayout page="today">
      <FlagsPanel
        flags={flags}
        tasks={tasks}
        metrics={metrics}
        workload={workload}
        subtasks={subtasks}
        staff={staff}
        since={since}
        lastSyncedAt={lastSyncedAt}
        onOpenTask={openTask}
        onNavigate={goTab}
        onOpenProject={openProject}
      />
    </PmLayout>
  );
}
