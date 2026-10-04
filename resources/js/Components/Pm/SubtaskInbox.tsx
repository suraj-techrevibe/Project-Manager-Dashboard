import { useState } from 'react';
import { pmApi } from '../../lib/pmApi';
import type { Employee, SubtaskFlag, TaskFocus, WorkloadRow } from '../../types/pm';

function errMsg(e: unknown, fallback: string): string {
  const data = (e as { response?: { data?: { error?: string; message?: string } } })?.response?.data;
  return data?.error ?? data?.message ?? fallback;
}

/**
 * Sub-tasks that need a decision. They sit inside a task, so nothing else on Today shows them —
 * an unassigned one used to stay invisible until someone happened to open the task.
 */
export default function SubtaskInbox({
  subtasks,
  staff,
  workload,
  onOpen,
  onResolved,
}: {
  subtasks: SubtaskFlag[];
  staff: Employee[];
  workload: WorkloadRow[];
  onOpen: (focus: TaskFocus) => void;
  /** Called with the sub-task id once it's been assigned or snoozed, so the parent can drop it from its list. */
  onResolved: (id: number, assignee?: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (subtasks.length === 0) return null;

  const unassigned = subtasks.filter((s) => s.issues.includes('unassigned')).length;
  const blocked = subtasks.filter((s) => s.issues.includes('blocked')).length;
  const load = new Map(workload.map((w) => [w.name, w]));

  // Lightest-loaded first, so the dropdown's top choices are the people with room.
  const people = [...staff].sort((a, b) => {
    const wa = load.get(a.name);
    const wb = load.get(b.name);
    return (wa?.week_hours ?? 0) - (wb?.week_hours ?? 0) || (wa?.open ?? 0) - (wb?.open ?? 0) || a.name.localeCompare(b.name);
  });

  async function assign(s: SubtaskFlag, employeeId: string) {
    if (!employeeId) return;
    setBusy(s.id);
    setError(null);
    try {
      const { data } = await pmApi.assignSubtask(s.id, employeeId);
      onResolved(s.id, data.assignee);
    } catch (e) {
      setError(errMsg(e, "Couldn't assign that sub-task."));
    } finally {
      setBusy(null);
    }
  }

  async function snooze(s: SubtaskFlag) {
    setBusy(s.id);
    setError(null);
    try {
      await pmApi.snoozeSubtask(s.id);
      onResolved(s.id);
    } catch (e) {
      setError(errMsg(e, "Couldn't snooze that sub-task."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50/50">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full flex-wrap items-center justify-between gap-2 px-3 py-2 text-left">
        <span className="text-sm font-medium text-slate-800">Sub-tasks to sort out</span>
        <span className="flex flex-wrap items-center gap-1.5 text-xs">
          {unassigned > 0 && <span className="rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-800">{unassigned} unassigned</span>}
          {blocked > 0 && <span className="rounded bg-red-100 px-1.5 py-0.5 font-medium text-red-700">{blocked} blocked</span>}
          <span className="text-slate-400">{open ? '▾' : '▸'}</span>
        </span>
      </button>

      {open && (
        <div className="border-t border-amber-200 px-3 pb-3 pt-2">
          {error && <div className="mb-2 rounded-md bg-red-50 px-2.5 py-1.5 text-xs text-red-700">{error}</div>}

          <ul className="flex flex-col gap-2">
            {subtasks.map((s) => (
              <li key={s.id} className="rounded-md border border-slate-200 bg-white p-2.5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <button
                    onClick={() => onOpen({ projectId: s.project_id, taskId: s.task_id, subId: s.subtask_id })}
                    className="min-w-0 flex-1 text-left"
                    title="Open this sub-task"
                  >
                    <span className="block text-xs text-slate-400">
                      {s.project_name} › {s.parent_title}
                    </span>
                    <span className="block text-sm font-medium text-slate-900 hover:underline">{s.title}</span>
                  </button>

                  <div className="flex shrink-0 flex-wrap items-center gap-1.5 text-xs">
                    {s.issues.includes('unassigned') && <span className="rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-800">Unassigned</span>}
                    {s.issues.includes('blocked') && <span className="rounded bg-red-100 px-1.5 py-0.5 font-medium text-red-700">Blocked</span>}
                    {s.parent_overdue && <span className="rounded bg-red-50 px-1.5 py-0.5 text-red-600">Parent task overdue</span>}
                  </div>
                </div>

                <div className="mt-1 text-xs text-slate-400">
                  Parent task: {s.parent_assignee ?? 'unassigned'}
                  {s.age_days !== null && s.age_days >= 1 && <> · added {s.age_days}d ago</>}
                  {s.assignee && <> · sub-task owner: {s.assignee}</>}
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {s.issues.includes('unassigned') && (
                    <select
                      defaultValue=""
                      disabled={busy === s.id || people.length === 0}
                      onChange={(e) => assign(s, e.target.value)}
                      className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                    >
                      <option value="">{people.length === 0 ? 'Staff list not loaded — sync first' : 'Assign to… (lightest first)'}</option>
                      {people.map((p) => {
                        const w = load.get(p.name);
                        return (
                          <option key={p.employeeId} value={p.employeeId}>
                            {p.name} — {w?.open ?? 0} open{w?.week_hours ? `, ${w.week_hours}h this week` : ''}
                          </option>
                        );
                      })}
                    </select>
                  )}
                  <button
                    onClick={() => onOpen({ projectId: s.project_id, taskId: s.task_id, subId: s.subtask_id })}
                    className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                  >
                    Open
                  </button>
                  <button onClick={() => snooze(s)} disabled={busy === s.id} className="px-2 py-1 text-xs text-slate-500 hover:text-slate-800 disabled:opacity-50">
                    Snooze 3d
                  </button>
                  {busy === s.id && <span className="text-xs text-slate-400">Saving…</span>}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
