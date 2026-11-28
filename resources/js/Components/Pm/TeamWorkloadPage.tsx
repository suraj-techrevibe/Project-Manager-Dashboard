import { useState } from 'react';
import type { WorkloadRow } from '../../types/pm';
import TeamWorkload from './TeamWorkload';

/**
 * Team workload tab: the full workload (categories, filters), plus the Investigation subtab.
 * The Command center only shows a short summary and links here.
 */
export default function TeamWorkloadPage({ workload }: { workload: WorkloadRow[] }) {
  const [assignee, setAssignee] = useState('');
  return (
    <div className="space-y-4">
      <TeamWorkload bare workload={workload} selected={assignee} onSelect={setAssignee} />
    </div>
  );
}
