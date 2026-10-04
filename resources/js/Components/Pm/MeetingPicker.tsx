import { useState } from 'react';
import { pmApi } from '../../lib/pmApi';
import { MAX_TICKETS, blankTicket, type EditableTicket } from '../../lib/briefHeuristics';
import { localISO, matchEmployee } from '../../lib/meetingNotes';
import { shortDate } from '../../lib/minutesFormat';
import type { Employee, MeetingMinutesSummary } from '../../types/pm';

/**
 * "From saved meeting" — pick a meeting from the Meeting minutes tab and turn its action
 * items into tickets. Owner names are matched to employees; due dates carry over
 * (dates already in the past are left blank).
 */
export default function MeetingPicker({
  employees,
  disabled,
  onLoad,
  onError,
}: {
  employees: Employee[];
  disabled?: boolean;
  onLoad: (tickets: EditableTicket[], notice: string) => void;
  onError: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<MeetingMinutesSummary[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (open) return setOpen(false);
    setOpen(true);
    if (list) return;
    setBusy(true);
    try {
      const { data } = await pmApi.minutesList();
      setList(data.minutes.filter((m) => m.action_items.length > 0));
    } catch {
      onError("Couldn't load your saved meetings.");
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  async function pick(id: number) {
    setBusy(true);
    try {
      const { data } = await pmApi.minutesShow(id);
      const m = data.minute;
      const now = localISO(new Date());
      const unmatched: string[] = [];
      let past = 0;

      const items = m.action_items.filter((a) => a.task.trim());
      const tickets = items.slice(0, MAX_TICKETS).map((a) => {
        // Custom attendees are saved as "Name (Company)" — try the bare name too.
        const owner = a.owner?.trim() ?? '';
        const hit = owner ? matchEmployee(owner, employees) ?? matchEmployee(owner.replace(/\s*\(.*\)\s*$/, ''), employees) : null;
        if (owner && (!hit || hit === 'ambiguous')) unmatched.push(owner);
        let dueDate = a.due_date ?? '';
        if (dueDate && dueDate < now) {
          dueDate = '';
          past++;
        }
        return blankTicket({
          title: a.task.trim(),
          description: `From meeting: ${m.title} (${shortDate(m.meeting_date)})${owner && (!hit || hit === 'ambiguous') ? `\nOwner in the minutes: ${owner}` : ''}`,
          assigneeId: hit && hit !== 'ambiguous' ? hit.employeeId : '',
          dueDate,
        });
      });

      const bits = [`Loaded ${tickets.length} action item${tickets.length === 1 ? '' : 's'} from "${m.title}".`];
      if (unmatched.length) bits.push(`No team match for ${Array.from(new Set(unmatched)).join(', ')}, so pick those yourself.`);
      if (past) bits.push(`${past} due date${past === 1 ? ' was' : 's were'} in the past, so I left ${past === 1 ? 'it' : 'them'} blank.`);
      if (items.length > MAX_TICKETS) bits.push(`${items.length - MAX_TICKETS} more beyond ${MAX_TICKETS} were dropped.`);
      bits.push('Hours and level are defaults, so review them.');

      setOpen(false);
      onLoad(tickets, bits.join(' '));
    } catch {
      onError("Couldn't load that meeting.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative">
      <button
        onClick={toggle}
        disabled={disabled}
        className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        title="Pick a meeting you saved in the Meeting minutes tab and turn its action items into tickets."
      >
        From saved meeting
      </button>
      {open && (
        <div className="absolute right-0 z-10 mt-1 max-h-72 w-80 overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
          {busy && !list && <p className="p-2 text-xs text-slate-500">Loading…</p>}
          {list && list.length === 0 && <p className="p-2 text-xs text-slate-500">No saved meetings with action items yet.</p>}
          {list?.map((m) => (
            <button key={m.id} onClick={() => pick(m.id)} disabled={busy} className="flex w-full flex-col rounded-md px-2 py-1.5 text-left hover:bg-slate-50 disabled:opacity-50">
              <span className="truncate text-sm text-slate-800">{m.title}</span>
              <span className="text-xs text-slate-500">
                {shortDate(m.meeting_date)} · {m.action_items.length} action item{m.action_items.length === 1 ? '' : 's'}
                {m.status === 'draft' && ' · draft'}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
