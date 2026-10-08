import { useState } from 'react';
import type { FollowUpItem, FollowUpState, MeetingFollowUp } from '../../types/pm';
import { shortDate } from '../../lib/minutesFormat';

const TONE: Record<FollowUpState, string> = {
  blocked: 'bg-red-50 text-red-700',
  overdue: 'bg-red-50 text-red-700',
  subtasks_incomplete: 'bg-amber-50 text-amber-700',
  stuck: 'bg-amber-50 text-amber-700',
  not_pushed: 'bg-slate-100 text-slate-600',
  not_started: 'bg-slate-100 text-slate-600',
  in_progress: 'bg-indigo-50 text-indigo-700',
  done: 'bg-green-50 text-green-700',
  cancelled: 'bg-slate-100 text-slate-400',
};

const LABEL: Record<FollowUpState, string> = {
  blocked: 'Blocked',
  overdue: 'Overdue',
  subtasks_incomplete: 'Sub-task still open',
  stuck: 'Stuck',
  not_pushed: 'Not pushed',
  not_started: 'Not started',
  in_progress: 'In progress',
  done: 'Done',
  cancelled: 'Cancelled',
};

/** Where last meeting's Work Items stand now. Closed when everything is done, so it only asks for attention when it matters. */
export default function MeetingFollowUpCard({ data }: { data: MeetingFollowUp | null | undefined }) {
  const [showDone, setShowDone] = useState(false);
  if (!data) return null;

  const { meeting, items, counts } = data;
  const open = items.filter((i) => i.state !== 'done' && i.state !== 'cancelled');
  const finished = items.filter((i) => i.state === 'done' || i.state === 'cancelled');
  const when = meeting.meeting_date ? ` · ${shortDate(meeting.meeting_date)}` : '';
  const chips = (['blocked', 'overdue', 'subtasks_incomplete', 'stuck', 'not_pushed', 'not_started', 'in_progress'] as FollowUpState[]).filter((k) => counts[k] > 0);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-xs font-medium uppercase tracking-wide text-slate-500">Last meeting follow-up</h4>
          <p className="mt-0.5 text-sm font-medium text-slate-900">
            {meeting.title}
            <span className="font-normal text-slate-400">{when}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="rounded bg-green-50 px-1.5 py-0.5 text-green-700">{counts.done} of {counts.total} done</span>
          {chips.map((k) => (
            <span key={k} className={`rounded px-1.5 py-0.5 ${TONE[k]}`}>{counts[k]} {LABEL[k].toLowerCase()}</span>
          ))}
        </div>
      </div>

      {open.length === 0 ? (
        <p className="mt-3 text-sm text-green-700">Everything from that meeting is done.</p>
      ) : (
        <ul className="mt-3 flex flex-col divide-y divide-slate-100">
          {open.map((i, n) => <Row key={`${i.requirement}-${n}`} item={i} />)}
        </ul>
      )}

      {finished.length > 0 && (
        <div className="mt-2">
          <button onClick={() => setShowDone((v) => !v)} className="text-xs text-slate-500 hover:text-slate-800">
            {showDone ? '▾' : '▸'} {finished.length} finished
          </button>
          {showDone && (
            <ul className="mt-1 flex flex-col divide-y divide-slate-100">
              {finished.map((i, n) => <Row key={`${i.requirement}-d${n}`} item={i} />)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ item }: { item: FollowUpItem }) {
  const who = item.assignee || item.owner || 'Unassigned';
  const meta = [item.project, who, item.due ? `due ${shortDate(item.due)}` : null, item.subtasks ? `${item.subtasks.done}/${item.subtasks.total} sub-tasks` : null].filter(Boolean).join(' · ');

  return (
    <li className="flex items-start gap-2 py-2">
      <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${TONE[item.state]}`}>{LABEL[item.state]}</span>
      <div className="min-w-0 flex-1">
        <div className="text-sm text-slate-800">
          {item.url ? <a href={item.url} target="_blank" rel="noreferrer" className="hover:underline">{item.requirement}</a> : item.requirement}
        </div>
        <div className="text-xs text-slate-400">{meta}{item.detail && item.state !== 'done' ? ` — ${item.detail}` : ''}</div>
      </div>
    </li>
  );
}
