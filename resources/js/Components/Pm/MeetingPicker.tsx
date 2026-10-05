import { useState } from 'react';
import { pmApi } from '../../lib/pmApi';
import { MAX_TICKETS, blankTicket, type EditableTicket } from '../../lib/briefHeuristics';
import { localISO, matchEmployee } from '../../lib/meetingNotes';
import { shortDate } from '../../lib/minutesFormat';
import type { Employee, MeetingMinutesSummary, MeetingWorkItem } from '../../types/pm';

function workItemDescription(m: MeetingMinutesSummary, w: MeetingWorkItem): string {
  const lines = [`From meeting: ${m.title} (${shortDate(m.meeting_date)})`];
  if (w.project.trim()) lines.push(`Project: ${w.project.trim()}`);
  if (w.discussion.trim()) lines.push(`\n${w.discussion.trim()}`);
  if (w.action_items.length) {
    lines.push('\nAction items:');
    w.action_items.filter((a) => a.task.trim()).forEach((a) => lines.push(`- ${a.task.trim()}`));
  }
  return lines.join('\n');
}

export default function MeetingPicker({ employees, disabled, onLoad, onError }: { employees: Employee[]; disabled?: boolean; onLoad: (tickets: EditableTicket[], notice: string, meeting: { id: number; title: string; meeting_date: string; minutes: string }) => void; onError: (message: string) => void }) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<MeetingMinutesSummary[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (open) return setOpen(false);
    setOpen(true);
    setBusy(true);
    try {
      const { data } = await pmApi.minutesList();
      setList(data.minutes.filter((m) => (m.work_items?.length ?? 0) > 0 || m.action_items.length > 0));
    } catch {
      onError("Couldn't load your saved meetings.");
      setOpen(false);
    } finally { setBusy(false); }
  }

  async function pick(id: number) {
    setBusy(true);
    try {
      const { data } = await pmApi.minutesShow(id);
      const m = data.minute;
      const now = localISO(new Date());
      const unmatched: string[] = [];
      let past = 0;
      let tickets: EditableTicket[] = [];
      const workItems = (m.work_items ?? []).filter((w) => w.requirement.trim());

      if (workItems.length) {
        tickets = workItems.slice(0, MAX_TICKETS).map((w) => {
          const owner = w.owner?.trim() ?? '';
          const hit = owner ? matchEmployee(owner, employees) ?? matchEmployee(owner.replace(/\s*\(.*\)\s*$/, ''), employees) : null;
          if (owner && (!hit || hit === 'ambiguous')) unmatched.push(owner);
          let dueDate = w.due_date ?? '';
          if (dueDate && dueDate < now) { dueDate = ''; past++; }
          return blankTicket({ title: w.requirement.trim(), description: workItemDescription(m, w), assigneeId: hit && hit !== 'ambiguous' ? hit.employeeId : '', dueDate });
        });
      } else {
        const items = m.action_items.filter((a) => a.task.trim());
        tickets = items.slice(0, MAX_TICKETS).map((a) => {
          const owner = a.owner?.trim() ?? '';
          const hit = owner ? matchEmployee(owner, employees) ?? matchEmployee(owner.replace(/\s*\(.*\)\s*$/, ''), employees) : null;
          if (owner && (!hit || hit === 'ambiguous')) unmatched.push(owner);
          let dueDate = a.due_date ?? '';
          if (dueDate && dueDate < now) { dueDate = ''; past++; }
          return blankTicket({ title: a.task.trim(), description: `From meeting: ${m.title} (${shortDate(m.meeting_date)})${owner && (!hit || hit === 'ambiguous') ? `\nOwner in the minutes: ${owner}` : ''}`, assigneeId: hit && hit !== 'ambiguous' ? hit.employeeId : '', dueDate });
        });
      }

      const sourceCount = workItems.length || m.action_items.filter((a) => a.task.trim()).length;
      const bits = [`Loaded ${tickets.length} work item${tickets.length === 1 ? '' : 's'} from "${m.title}".`];
      if (unmatched.length) bits.push(`No team match for ${Array.from(new Set(unmatched)).join(', ')}, so pick those yourself.`);
      if (past) bits.push(`${past} due date${past === 1 ? ' was' : 's were'} in the past, so I left ${past === 1 ? 'it' : 'them'} blank.`);
      if (sourceCount > MAX_TICKETS) bits.push(`${sourceCount - MAX_TICKETS} more beyond ${MAX_TICKETS} were dropped.`);
      bits.push(workItems.length ? 'Each Work Item becomes one parent ticket; its Action Items are included as subtasks data for the next push step.' : 'This is a legacy meeting, so its action items are loaded as individual tickets.');
      bits.push('Hours and level are defaults, so review them.');
      setOpen(false);
      onLoad(tickets, bits.join(' '), { id: m.id, title: m.title, meeting_date: m.meeting_date, minutes: JSON.stringify(m.work_items ?? m.action_items ?? []) });
    } catch { onError("Couldn't load that meeting."); }
    finally { setBusy(false); }
  }

  return <div className="relative"><button onClick={toggle} disabled={disabled} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50" title="Pick a saved meeting and turn its Work Items into tickets.">From saved meeting</button>{open && <div className="absolute right-0 z-10 mt-1 max-h-72 w-80 overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 shadow-lg">{busy && <p className="p-2 text-xs text-slate-500">Loading…</p>}{!busy && list && list.length === 0 && <p className="p-2 text-xs text-slate-500">No saved meetings with Work Items yet.</p>}{!busy && list?.map((m) => { const count = m.work_items?.length ?? m.action_items.length; return <button key={m.id} onClick={() => pick(m.id)} disabled={busy} className="flex w-full flex-col rounded-md px-2 py-1.5 text-left hover:bg-slate-50 disabled:opacity-50"><span className="truncate text-sm text-slate-800">{m.title}</span><span className="text-xs text-slate-500">{shortDate(m.meeting_date)} · {count} work item{count === 1 ? '' : 's'}{m.status === 'draft' && ' · draft'}</span></button>; })}</div>}</div>;
}
