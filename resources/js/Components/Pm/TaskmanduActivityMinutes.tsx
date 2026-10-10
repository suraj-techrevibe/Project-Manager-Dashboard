import { useState } from 'react';
import { pmApi } from '../../lib/pmApi';
import { localISO } from '../../lib/meetingNotes';
import type { ActivityDraftSection, MeetingMinutesFull, MeetingWorkItem, TaskmanduActivityDraft } from '../../types/pm';
import { EmptyState, PageHeader, StatTile } from './ui/kit';
import { ErrorNote, Field, err, ghostBtn, inputCls, primaryBtn } from './Projects/ui';

type Row = { item: MeetingWorkItem; section: ActivityDraftSection | 'carried_over' };

const SECTION_ORDER: ActivityDraftSection[] = ['blocked', 'due', 'progress', 'in_progress', 'new_work'];
const SECTION_LABEL: Record<ActivityDraftSection | 'carried_over', string> = {
  blocked: 'Blocked / at risk', due: 'Due today / overdue', progress: 'Progress updates',
  in_progress: 'Still in progress', new_work: 'New on the board', completed: 'Completed since last meeting',
  carried_over: 'Carried over from last meeting',
};
const SECTION_HINT: Record<ActivityDraftSection | 'carried_over', string> = {
  blocked: 'Blocked status, or no movement for 3+ days — worth discussing even though the deadline hasn’t passed.',
  due: 'Due today or already overdue.', progress: 'Still open, with new comments or status changes since the window opened.',
  in_progress: 'Still open, no new activity — shown so nothing goes quiet without you noticing, not flagged as a problem.',
  new_work: 'First appeared on the board in this window.', completed: '', carried_over: 'Unfinished last time, plus board items not already covered above.',
};

export default function TaskmanduActivityMinutes({ onCancel, onSaved, lastMeetingDate }: {
  onCancel: () => void;
  onSaved: (m: MeetingMinutesFull) => void;
  lastMeetingDate: string | null;
}) {
  const today = localISO(new Date());
  const shiftDay = (date: string, amount: number) => {
    const d = new Date(date + 'T12:00:00');
    d.setDate(d.getDate() + amount);
    return localISO(d);
  };
  const defaultFrom = lastMeetingDate && lastMeetingDate < today ? shiftDay(lastMeetingDate, 1) : shiftDay(today, -1);
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(today);
  const [draft, setDraft] = useState<TaskmanduActivityDraft | null>(null);
  const [title, setTitle] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  // Existing Taskmandu activity is context, not new work, unless explicitly promoted.
  const [createTask, setCreateTask] = useState<Record<number, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [carryBusy, setCarryBusy] = useState(false);
  const [carryMsg, setCarryMsg] = useState<string | null>(null);

  async function build() {
    setLoading(true);
    setError(null);
    try {
      const { data } = await pmApi.minutesActivityDraft(from, to);
      setDraft(data);
      setTitle(data.title);
      setRows(SECTION_ORDER.flatMap((section) => data.sections[section].map((item) => ({ item, section }))));
      setCreateTask({});
    } catch (e) {
      setError(err(e, "Couldn't collect Taskmandu activity. Run Sync now and try again."));
    } finally {
      setLoading(false);
    }
  }

  const updateItem = (index: number, patch: Partial<MeetingWorkItem>) =>
    setRows((current) => current.map((r, i) => i === index ? { ...r, item: { ...r.item, ...patch } } : r));

  const normName = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

  /** Same list the manual Work Items step offers — unfinished items from the last meeting plus overdue /
   *  blocked / stuck board tasks. Added here too so you don't have to leave this screen to get them. */
  async function carryOver() {
    setCarryBusy(true);
    setCarryMsg(null);
    try {
      const { data } = await pmApi.minutesCarryOver();
      const have = new Set(rows.map(({ item: w }) => `${normName(w.requirement)}|${normName(w.project)}`));
      const fresh = data.work_items.filter((w) => !have.has(`${normName(w.requirement)}|${normName(w.project)}`));
      if (!fresh.length) {
        setCarryMsg(data.work_items.length ? 'Those items are already in this meeting.' : 'Nothing to carry over: the last meeting is finished and nothing on the board is overdue, blocked or stuck.');
        return;
      }
      const start = rows.length;
      setRows((current) => [...current, ...fresh.map((item) => ({ item, section: 'carried_over' as const }))]);
      // Carried-over work is real follow-up, not just background context, so default it to "create task".
      setCreateTask((current) => { const next = { ...current }; fresh.forEach((_, j) => { next[start + j] = true; }); return next; });
      setCarryMsg(`Added ${fresh.length} Work Item${fresh.length === 1 ? '' : 's'}${data.from ? ` (${data.from_meeting} unfinished from “${data.from.title}”, ${data.from_board} from the board)` : ' from the board'}.`);
    } catch (e) {
      setCarryMsg(err(e, "Couldn't load carry-over items."));
    } finally {
      setCarryBusy(false);
    }
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const allItems = [...draft.sections.completed, ...rows.map((r) => r.item)];
      const { data } = await pmApi.minutesCreate({
        title: title.trim() || draft.title,
        status: 'draft',
        meeting_date: to,
        attendees: draft.attendees,
        topics: [],
        agenda_items: [],
        discussion: allItems.map((item) => `${item.project || 'Project not specified'} — ${item.requirement || 'Taskmandu activity'}${item.note ? ` (${item.note})` : ''}\n${item.discussion}`).join('\n\n'),
        decisions: [],
        action_items: [],
        // Existing task activity is saved as minutes context by default, not recreated as tickets.
        work_items: rows.filter((_, i) => createTask[i]).map((r) => r.item),
        raw_notes: '',
      });
      onSaved(data.minute);
    } catch (e) {
      setError(err(e, "Couldn't save the activity-based meeting draft."));
    } finally {
      setSaving(false);
    }
  }

  const completed = draft?.sections.completed ?? [];
  const groups: { section: ActivityDraftSection | 'carried_over'; rows: { i: number; item: MeetingWorkItem; section: ActivityDraftSection | 'carried_over' }[] }[] = [
    ...SECTION_ORDER.map((s) => ({ section: s, rows: rows.map((r, i) => ({ ...r, i })).filter((r) => r.section === s) })),
    { section: 'carried_over' as const, rows: rows.map((r, i) => ({ ...r, i })).filter((r) => r.section === 'carried_over') },
  ];

  return (
    <div className="flex flex-col gap-4">
      <button onClick={onCancel} className="self-start text-sm text-slate-500 hover:text-slate-700">← Back to meetings</button>
      <PageHeader icon="notes" title="Build minutes from Taskmandu" description="Collect status movements and subtask comments, grouped like a daily standup, then review before saving. Nothing is pushed back to Taskmandu." />
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Activity from"><input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className={inputCls} /></Field>
          <Field label="Activity to"><input type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} className={inputCls} /></Field>
          <div className="flex items-end"><button onClick={build} disabled={loading || !from || !to || from > to} className={primaryBtn}>{loading ? 'Collecting activity…' : 'Collect Taskmandu activity'}</button></div>
        </div>
        <ErrorNote message={error} />
      </div>
      {draft && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="Events collected" value={draft.activity_count} />
            <StatTile label="Comments" value={draft.summary.comments} />
            <StatTile label="Task status changes" value={draft.summary.task_status_changes} />
            <StatTile label="Subtask status changes" value={draft.summary.subtask_status_changes} />
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex flex-col gap-3">
              <Field label="Meeting title"><input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} className={inputCls} /></Field>
              <p className="text-sm text-slate-500">Detected team members: {draft.attendees.length ? draft.attendees.join(', ') : 'No comment authors found in this period'}.</p>
              {rows.length === 0 && completed.length === 0 && <EmptyState title="No activity found for this period">Run Sync now in PM Agent after the team has commented or changed statuses. Existing comments may be imported on sync; status history starts from deployment.</EmptyState>}
              <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-900">These are updates to tasks that already exist on the Taskmandu board. They will be saved into the meeting discussion, not recreated as new tasks. Select “Create new task” only when the activity reveals genuinely new work.</div>

              {completed.length > 0 && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3">
                  <div className="text-sm font-semibold text-emerald-900">{SECTION_LABEL.completed} ({completed.length})</div>
                  <p className="mt-0.5 text-xs text-emerald-700">Reported, not carried forward — nothing to do here.</p>
                  <ul className="mt-2 flex flex-col gap-1">
                    {completed.map((w, i) => (
                      <li key={i} className="text-sm text-emerald-900">✓ {w.requirement || 'Taskmandu activity'} <span className="text-emerald-600">— {w.project || 'no project'}{w.note ? ` · ${w.note}` : ''}</span></li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-medium text-slate-500">Still missing anything unfinished from last time?</span>
                <button onClick={carryOver} disabled={carryBusy} title="Unfinished items from the last meeting, plus overdue, blocked and stuck tasks from the board" className={ghostBtn}>{carryBusy ? 'Loading…' : '↩ Carry over from last meeting'}</button>
              </div>
              {carryMsg && <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-800">{carryMsg}</div>}

              {groups.filter((g) => g.rows.length > 0).map((g) => (
                <div key={g.section} className="flex flex-col gap-2">
                  <div>
                    <div className="text-sm font-semibold text-slate-800">{SECTION_LABEL[g.section]} ({g.rows.length})</div>
                    {SECTION_HINT[g.section] && <p className="text-xs text-slate-500">{SECTION_HINT[g.section]}</p>}
                  </div>
                  {g.rows.map(({ item, i }) => (
                    <div key={i} className={`rounded-lg border p-3 ${createTask[i] ? 'border-amber-300 bg-amber-50/40' : 'border-slate-200'}`}>
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold">{item.requirement || 'Taskmandu activity'}</span>
                          {item.note && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">{item.note}</span>}
                          {createTask[i] && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-700">Will push to Taskmandu</span>}
                        </div>
                        <button onClick={() => { setRows((all) => all.filter((_, j) => j !== i)); setCreateTask((all) => Object.fromEntries(Object.entries(all).filter(([k]) => Number(k) !== i).map(([k, v]) => [Number(k) > i ? Number(k) - 1 : Number(k), v]))); }} className="text-xs text-slate-500 hover:text-red-600">Remove</button>
                      </div>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <Field label="Owner"><input value={item.owner} onChange={(e) => updateItem(i, { owner: e.target.value })} className={inputCls} /></Field>
                        <Field label="Project"><input value={item.project} onChange={(e) => updateItem(i, { project: e.target.value })} className={inputCls} /></Field>
                      </div>
                      <Field label="Requirement / task"><input value={item.requirement} onChange={(e) => updateItem(i, { requirement: e.target.value })} className={inputCls} /></Field>
                      <Field label="Activity evidence — comments and status changes"><textarea value={item.discussion} onChange={(e) => updateItem(i, { discussion: e.target.value })} rows={Math.min(10, Math.max(3, item.discussion.split('\n').length))} className={inputCls} /></Field>
                      <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-md border border-slate-200 bg-white p-3 text-sm"><input type="checkbox" checked={!!createTask[i]} onChange={(e) => setCreateTask((all) => ({ ...all, [i]: e.target.checked }))} className="mt-0.5" /><span><b>Push to Taskmandu</b><span className="mt-0.5 block text-xs text-slate-500">This updates the existing task (same title/project) rather than duplicating it. Leave unchecked if there's nothing new to push.</span></span></label>
                    </div>
                  ))}
                </div>
              ))}

              <div className="flex flex-wrap justify-end gap-2"><button onClick={onCancel} className={ghostBtn}>Cancel</button><button onClick={save} disabled={saving || !title.trim()} className={primaryBtn}>{saving ? 'Saving draft…' : 'Save as meeting draft'}</button></div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
