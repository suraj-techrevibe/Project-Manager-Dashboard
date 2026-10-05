import PmLayout from '@/Layouts/PmLayout';
import FlagsPanel from '@/Components/Pm/FlagsPanel';
import { visitPm } from '@/lib/pmNav';
import type { PmFlag, PmMetrics, SinceSummary, TaskFocus, WorkloadRow } from '@/types/pm';

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
  // Clicking a task on Today opens Projects -> that project -> Tasks -> the task itself.
  const openTask = (f: TaskFocus) => visitPm('projects', { project: f.projectId, ptab: 'tasks', task: f.taskId, sub: f.subId });

  return (
    <PmLayout page="today" attention={(metrics?.overdue ?? 0) + (metrics?.blocked ?? 0)}>
      <div className="flex flex-col gap-4">
        <FlagsPanel flags={flags} metrics={metrics} workload={workload} since={since} lastSyncedAt={lastSyncedAt} onOpenTask={openTask} />
      </div>
    </PmLayout>
  );
}
