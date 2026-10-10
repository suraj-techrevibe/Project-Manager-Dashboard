import { useState } from 'react';
import { pmApi } from '../../lib/pmApi';
import { localISO } from '../../lib/meetingNotes';
import type { MeetingMinutesFull, MeetingWorkItem, TaskmanduActivityDraft } from '../../types/pm';
import { EmptyState, PageHeader, StatTile } from './ui/kit';
import { ErrorNote, Field, err, ghostBtn, inputCls, primaryBtn } from './Projects/ui';

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
  const [items, setItems] = useState<MeetingWorkItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function build() {
    setLoading(true);
    setError(null);
    try {
      const { data } = await pmApi.minutesActivityDraft(from, to);
      setDraft(data);
      setTitle(data.title);
      setItems(data.work_items);
    } catch (e) {
      setError(err(e, "Couldn't collect Taskmandu activity. Run Sync now and try again."));
    } finally {
      setLoading(false);
    }
  }

  const updateItem = (index: number, patch: Partial<MeetingWorkItem>) =>
    setItems((current) => current.map((item, i) => i === index ? { ...item, ...patch } : item));

  async function save() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const { data } = await pmApi.minutesCreate({
        title: title.trim() || draft.title,
        status: 'draft',
        meeting_date: to,
        attendees: draft.attendees,
        topics: [],
        agenda_items: [],
        discussion: '',
        decisions: [],
        action_items: [],
        work_items: items,
        raw_notes: '',
      });
      onSaved(data.minute);
    } catch (e) {
      setError(err(e, "Couldn't save the activity-based meeting draft."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <button onClick={onCancel} className="self-start text-sm text-slate-500 hover:text-slate-700">← Back to meetings</button>
      <PageHeader icon="notes" title="Build minutes from Taskmandu" description="Collect status movements and subtask comments, then review before saving. Nothing is pushed back to Taskmandu." />
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
              {items.length === 0 && <EmptyState title="No activity found for this period">Run Sync now in PM Agent after the team has commented or changed statuses. Existing comments may be imported on sync; status history starts from deployment.</EmptyState>}
              {items.map((item, i) => (
                <div key={i} className="rounded-lg border border-slate-200 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2"><span className="text-sm font-semibold">Work Item {i + 1}</span><button onClick={() => setItems((all) => all.filter((_, j) => j !== i))} className="text-xs text-slate-500 hover:text-red-600">Remove</button></div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <Field label="Owner"><input value={item.owner} onChange={(e) => updateItem(i, { owner: e.target.value })} className={inputCls} /></Field>
                    <Field label="Project"><input value={item.project} onChange={(e) => updateItem(i, { project: e.target.value })} className={inputCls} /></Field>
                  </div>
                  <Field label="Requirement / task"><input value={item.requirement} onChange={(e) => updateItem(i, { requirement: e.target.value })} className={inputCls} /></Field>
                  <Field label="Discussion — comments and status changes"><textarea value={item.discussion} onChange={(e) => updateItem(i, { discussion: e.target.value })} rows={Math.min(10, Math.max(4, item.discussion.split('\n').length))} className={inputCls} /></Field>
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
