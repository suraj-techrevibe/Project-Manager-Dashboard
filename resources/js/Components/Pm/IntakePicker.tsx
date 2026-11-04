import { useMemo, useState } from 'react';
import { pmApi } from '../../lib/pmApi';
import { blankTicket, type EditableTicket } from '../../lib/briefHeuristics';
import { localISO } from '../../lib/meetingNotes';
import type { PmIntake, Project, TaskPriority } from '../../types/pm';

type IntakeKindFilter = 'all' | 'request' | 'idea';

const PRIORITIES: Record<PmIntake['priority'], TaskPriority> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
};

export function buildTicketFromIntake(intake: PmIntake, projects: Project[]): EditableTicket {
  const project = projects.find((candidate) => candidate._id === intake.linked_project_id);
  const today = localISO(new Date());
  const dueDate = intake.requested_due_at && intake.requested_due_at >= today
    ? intake.requested_due_at
    : '';
  const description = [
    intake.description?.trim(),
    intake.clarification?.trim() ? `Clarification: ${intake.clarification.trim()}` : null,
    intake.decision_notes?.trim() ? `Decision: ${intake.decision_notes.trim()}` : null,
  ].filter(Boolean).join('\n\n');

  return blankTicket({
    title: intake.title,
    description,
    priority: PRIORITIES[intake.priority],
    dueDate,
    projectId: project?._id ?? intake.linked_project_id ?? '',
    projectName: project?.name ?? intake.linked_project_name ?? '',
    projectNeedsConfirmation: Boolean(intake.linked_project_id && !project),
    projectConfirmed: Boolean(project),
  });
}

function readinessReason(intake: PmIntake, projects: Project[]): string | null {
  const accepted = intake.kind === 'request'
    ? intake.status === 'approved' || intake.status === 'planned'
    : intake.status === 'accepted' || intake.status === 'planned';

  if (!accepted) {
    return intake.kind === 'request' ? 'Approve this request first' : 'Accept this idea first';
  }
  if (!intake.linked_project_id) return 'Match a Taskmandu project first';
  if (!projects.some((project) => project._id === intake.linked_project_id)) {
    return 'Matched project is not available';
  }
  return null;
}

export default function IntakePicker({
  projects,
  disabled,
  onLoad,
  onError,
}: {
  projects: Project[];
  disabled?: boolean;
  onLoad: (ticket: EditableTicket, intake: PmIntake) => void;
  onError: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState<PmIntake[] | null>(null);
  const [kind, setKind] = useState<IntakeKindFilter>('all');
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (items ?? []).filter((item) => {
      if (kind !== 'all' && item.kind !== kind) return false;
      if (!query) return true;
      return [item.title, item.description, item.linked_project_name, item.source_name]
        .filter(Boolean).join(' ').toLowerCase().includes(query);
    });
  }, [items, kind, search]);

  async function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    setBusy(true);
    try {
      const { data } = await pmApi.intakes();
      setItems(data.intakes.sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? '')));
    } catch {
      setOpen(false);
      onError("Couldn't load Requests & Ideas. Refresh Operations and try again.");
    } finally {
      setBusy(false);
    }
  }

  function choose(intake: PmIntake) {
    const reason = readinessReason(intake, projects);
    if (reason) return;
    onLoad(buildTicketFromIntake(intake, projects), intake);
    setOpen(false);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => void toggle()}
        disabled={disabled}
        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        title="Choose an approved request or accepted idea and load it as a Task."
      >
        From request / idea
      </button>

      {open && (
        <div className="absolute bottom-full right-0 z-[99999] mb-2 w-[min(92vw,26rem)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
          <div className="border-b border-slate-100 p-3">
            <div className="font-semibold text-sm text-slate-800">Choose a request or idea</div>
            <p className="mt-0.5 text-xs text-slate-500">Approved requests and accepted ideas become one editable parent Task. The matched Taskmandu project stays fixed.</p>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search title or project…"
              className="mt-2 w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm"
            />
            <div className="mt-2 flex gap-1">
              {(['all', 'request', 'idea'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setKind(value)}
                  className={`rounded-full px-2.5 py-1 text-xs font-medium capitalize ${kind === value ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                >
                  {value === 'all' ? 'All' : value === 'request' ? 'Requests' : 'Ideas'}
                </button>
              ))}
            </div>
          </div>

          <div className="max-h-80 overflow-y-auto p-1.5">
            {busy && <p className="p-3 text-xs text-slate-500">Loading requests and ideas…</p>}
            {!busy && filtered.length === 0 && (
              <p className="p-3 text-xs text-slate-500">No matching requests or ideas.</p>
            )}
            {!busy && filtered.map((item) => {
              const reason = readinessReason(item, projects);
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => choose(item)}
                  disabled={Boolean(reason)}
                  className="flex w-full flex-col gap-1 rounded-lg px-3 py-2 text-left hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-55"
                  title={reason ?? 'Load as a Task'}
                >
                  <span className="flex w-full items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-sm font-medium text-slate-800">{item.title}</span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${item.kind === 'request' ? 'bg-blue-50 text-blue-700' : 'bg-violet-50 text-violet-700'}`}>{item.kind}</span>
                  </span>
                  <span className="text-xs text-slate-500">{item.linked_project_name ?? 'No Taskmandu project'} · {item.status.replace(/_/g, ' ')}</span>
                  {reason
                    ? <span className="text-[11px] text-amber-700">{reason}</span>
                    : <span className="text-[11px] text-emerald-700">{item.task_links?.length ? `${item.task_links.length} Task(s) already linked · add more` : 'Ready to load as a Task'}</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
