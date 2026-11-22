import type { ActionItem, MeetingWorkItem, MinutesTopic } from '../../types/pm';
import { shortDate, topicsFor, workItemHasContent, workItemTitle } from '../../lib/minutesFormat';

export interface MeetingMinutesDocumentData {
  title: string;
  meeting_date?: string | null;
  status?: string | null;
  attendees?: string[] | null;
  topics?: MinutesTopic[] | null;
  agenda_items?: string[] | null;
  discussion?: string | null;
  decisions?: string[] | null;
  action_items?: ActionItem[] | null;
  work_items?: MeetingWorkItem[] | null;
}

interface Props {
  meeting: MeetingMinutesDocumentData;
  followUps?: ActionItem[];
  onToggleFollowUp?: (index: number) => void;
  className?: string;
}

const sectionTitle = 'text-xs font-semibold uppercase tracking-wider text-slate-500';

export default function MeetingMinutesDocument({ meeting, followUps, onToggleFollowUp, className = '' }: Props) {
  const topics = topicsFor(meeting).filter((topic) => topic.title.trim() || topic.notes.trim() || topic.decision.trim());
  const discussion = topics.filter((topic) => topic.notes.trim() || topic.decision.trim());
  const attendees = meeting.attendees ?? [];
  const allActions = followUps ?? meeting.action_items ?? [];
  const actions = allActions.map((action, index) => ({ action, index })).filter(({ action }) => action.task?.trim());
  const tasks = (meeting.work_items ?? []).map((work): MeetingWorkItem => ({
    owner: work.owner ?? '',
    project: work.project ?? '',
    project_id: work.project_id ?? null,
    requirement: work.requirement ?? '',
    discussion: work.discussion ?? '',
    due_date: work.due_date ?? null,
    action_items: (work.action_items ?? []).map((action) => ({ task: action.task ?? '', due_date: action.due_date ?? null })),
  })).filter(workItemHasContent);

  return (
    <article className={`flex flex-col gap-4 text-sm text-slate-700 ${className}`}>
      <header className="border-b border-slate-200 pb-3">
        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-indigo-600">Meeting minutes</div>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-2">
          <h3 className="text-base font-semibold text-slate-900">{meeting.title?.trim() || '(untitled meeting)'}</h3>
          {meeting.status && <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${meeting.status === 'final' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{meeting.status}</span>}
        </div>
        <p className="mt-1 text-xs text-slate-500">Date: {meeting.meeting_date ? shortDate(meeting.meeting_date) : 'Not recorded'}</p>
      </header>

      <section>
        <h4 className={sectionTitle}>Attendees</h4>
        <p className="mt-1 whitespace-pre-wrap">{attendees.length ? attendees.join(', ') : 'None recorded'}</p>
      </section>

      <section>
        <h4 className={sectionTitle}>Agenda</h4>
        {topics.length ? (
          <ol className="mt-1 list-decimal space-y-1 pl-5">
            {topics.map((topic, index) => <li key={index}>{topic.title}</li>)}
          </ol>
        ) : <p className="mt-1 text-slate-400">No agenda items recorded.</p>}
      </section>

      <section>
        <h4 className={sectionTitle}>Discussion &amp; decisions</h4>
        {discussion.length ? (
          <ol className="mt-1 list-decimal space-y-3 pl-5">
            {discussion.map((topic, index) => (
              <li key={index}>
                <div className="font-medium text-slate-800">{topic.title}</div>
                {topic.notes.trim() && <p className="mt-1 whitespace-pre-wrap">{topic.notes}</p>}
                {topic.decision.trim() && <p className="mt-1 whitespace-pre-wrap"><span className="font-medium text-slate-800">Decision:</span> {topic.decision}</p>}
              </li>
            ))}
          </ol>
        ) : <p className="mt-1 text-slate-400">No discussion or decisions recorded.</p>}
      </section>

      <section>
        <h4 className={sectionTitle}>Follow-ups</h4>
        {actions.length ? (
          <ol className="mt-1 list-decimal space-y-2 pl-5">
            {actions.map(({ action, index }) => {
              const details = [action.owner?.trim(), action.due_date ? `Due ${shortDate(action.due_date)}` : '', action.from ? `Carried from “${action.from}”` : '', action.done && !onToggleFollowUp ? 'Done' : ''].filter(Boolean).join(' · ');
              return (
                <li key={index} className="flex items-start gap-2">
                  {onToggleFollowUp && <input type="checkbox" checked={!!action.done} onChange={() => onToggleFollowUp(index)} aria-label={`Mark follow-up ${index + 1} ${action.done ? 'open' : 'done'}`} className="mt-1" />}
                  <div className="min-w-0">
                    <span className={action.done ? 'text-slate-400 line-through' : 'text-slate-800'}>{action.task}</span>
                    {details && <span className="ml-1 text-xs text-slate-500">— {details}</span>}
                  </div>
                </li>
              );
            })}
          </ol>
        ) : <p className="mt-1 text-slate-400">No follow-ups recorded.</p>}
      </section>

      <section>
        <h4 className={sectionTitle}>Tasks (Taskmandu)</h4>
        {tasks.length ? (
          <div className="mt-2 flex flex-col gap-3">
            {tasks.map((work, index) => (
              <div key={index} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="font-medium text-slate-900">{index + 1}. {workItemTitle(work)}</div>
                <div className="mt-1 text-xs text-slate-500">Owner: {work.owner.trim() || 'Unassigned'} · Project: {work.project.trim() || 'Not set'}</div>
                {work.requirement.trim() && work.requirement.trim() !== workItemTitle(work) && <p className="mt-2"><span className="font-medium">Requirement:</span> {work.requirement}</p>}
                {work.discussion.trim() && <p className="mt-2 whitespace-pre-wrap"><span className="font-medium">Discussion:</span> {work.discussion}</p>}
                {work.action_items.some((action) => action.task.trim()) && (
                  <div className="mt-2">
                    <div className="text-xs font-medium text-slate-600">Subtasks</div>
                    <ul className="mt-1 list-disc space-y-1 pl-5">
                      {work.action_items.filter((action) => action.task.trim()).map((action, actionIndex) => <li key={actionIndex}>{action.task}{action.due_date ? <span className="text-xs text-slate-500"> · due {shortDate(action.due_date)}</span> : null}</li>)}
                    </ul>
                  </div>
                )}
                <p className="mt-2 text-xs text-slate-500">Due date: {work.due_date ? shortDate(work.due_date) : 'Not set'}</p>
              </div>
            ))}
          </div>
        ) : <p className="mt-1 text-slate-400">No Taskmandu tasks recorded.</p>}
      </section>
    </article>
  );
}
