import { useEffect, useState } from 'react';
import { pmApi } from '../../lib/pmApi';
import { setUrlParams, useUrlParam } from '../../lib/urlState';
import type { ActionItem, MeetingMinutesFull, MeetingMinutesSummary, MinutesDraft, Project } from '../../types/pm';
import {
  ErrorNote,
  Field,
  Modal,
  err,
  formatDate,
  formatTimestamp,
  ghostBtn,
  inputCls,
  primaryBtn,
  dangerBtn,
  today,
} from './Projects/ui';

/**
 * Meeting minutes — plain local records, no Taskmandu involved. The point
 * is you never have to know a syntax: paste rough notes and "Draft with AI"
 * fills the standard fields below (attendees, agenda, discussion, decisions,
 * action items), or just type into the form directly. Action items can be
 * pushed onto a Taskmandu project board from an expanded entry.
 */
export default function MeetingMinutesPanel() {
  const [minutes, setMinutes] = useState<MeetingMinutesSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Which entry is expanded lives in the URL (?minute=<id>), like the rest of /pm.
  const openId = useUrlParam('minute');
  const [expanded, setExpanded] = useState<MeetingMinutesFull | null>(null);
  const [expandLoading, setExpandLoading] = useState(false);
  const [editing, setEditing] = useState<MeetingMinutesFull | 'new' | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const { data } = await pmApi.minutesList();
      setMinutes(data.minutes);
    } catch (e) {
      setError(err(e, "Couldn't load meeting minutes."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!openId) {
      setExpanded(null);
      return;
    }
    setExpandLoading(true);
    pmApi
      .minutesShow(Number(openId))
      .then(({ data }) => setExpanded(data.minute))
      .catch((e) => setError(err(e, "Couldn't load that entry.")))
      .finally(() => setExpandLoading(false));
  }, [openId]);

  function toggle(id: number) {
    setUrlParams({ minute: String(openId) === String(id) ? null : String(id) });
  }

  async function remove(id: number) {
    if (!confirm("Delete these minutes? This can't be undone.")) return;
    try {
      await pmApi.minutesDelete(id);
      setMinutes((ms) => ms.filter((m) => m.id !== id));
      if (String(openId) === String(id)) setUrlParams({ minute: null });
    } catch (e) {
      setError(err(e, "Couldn't delete that entry."));
    }
  }

  function onSaved(minute: MeetingMinutesFull) {
    setEditing(null);
    setMinutes((ms) => {
      const summary: MeetingMinutesSummary = {
        id: minute.id,
        title: minute.title,
        meeting_date: minute.meeting_date,
        attendees: minute.attendees,
        action_items: minute.action_items,
      };
      const next = ms.some((m) => m.id === minute.id) ? ms.map((m) => (m.id === minute.id ? summary : m)) : [summary, ...ms];
      return next.sort((a, b) => (a.meeting_date < b.meeting_date ? 1 : a.meeting_date > b.meeting_date ? -1 : b.id - a.id));
    });
    if (String(openId) === String(minute.id)) setExpanded(minute);
    else setUrlParams({ minute: String(minute.id) });
  }

  if (editing) {
    return <MinutesForm initial={editing === 'new' ? null : editing} onCancel={() => setEditing(null)} onSaved={onSaved} />;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-slate-700">Meeting minutes</h3>
        <button onClick={() => setEditing('new')} className={primaryBtn}>New entry</button>
      </div>

      <ErrorNote message={error} />
      {loading && <p className="text-sm text-slate-500">Loading…</p>}
      {!loading && minutes.length === 0 && !error && (
        <p className="text-sm text-slate-500">No meeting minutes yet — click "New entry" to add one.</p>
      )}

      <div className="flex flex-col gap-2">
        {minutes.map((m) => {
          const isOpen = String(openId) === String(m.id);
          return (
            <div key={m.id} className="rounded-xl border border-slate-200 bg-white">
              <button onClick={() => toggle(m.id)} className="flex w-full items-center justify-between gap-3 p-4 text-left">
                <div className="min-w-0">
                  <div className="truncate font-medium text-slate-900">{m.title}</div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    {formatDate(m.meeting_date)}
                    {m.attendees.length > 0 && ` · ${m.attendees.join(', ')}`}
                    {m.action_items.length > 0 && ` · ${m.action_items.length} action item${m.action_items.length === 1 ? '' : 's'}`}
                  </div>
                </div>
                <span className="shrink-0 text-slate-400">{isOpen ? '▲' : '▼'}</span>
              </button>

              {isOpen && (
                <div className="border-t border-slate-100 p-4">
                  {expandLoading && <p className="text-sm text-slate-500">Loading…</p>}
                  {!expandLoading && expanded && expanded.id === m.id && (
                    <MinutesDetail minute={expanded} onEdit={() => setEditing(expanded)} onDelete={() => remove(m.id)} />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MinutesDetail({ minute, onEdit, onDelete }: { minute: MeetingMinutesFull; onEdit: () => void; onDelete: () => void }) {
  const [showPush, setShowPush] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <Section title="Agenda" items={minute.agenda_items} />
      {minute.discussion && (
        <div>
          <div className="mb-1 text-xs font-medium text-slate-500">Discussion</div>
          <p className="whitespace-pre-wrap text-sm text-slate-700">{minute.discussion}</p>
        </div>
      )}
      <Section title="Decisions" items={minute.decisions} />
      {minute.action_items.length > 0 && (
        <div>
          <div className="mb-1 text-xs font-medium text-slate-500">Action items</div>
          <ul className="flex flex-col gap-1">
            {minute.action_items.map((a, i) => (
              <li key={i} className="text-sm text-slate-700">
                {a.task}
                {a.owner && <span className="text-slate-400"> — {a.owner}</span>}
                {a.due_date && <span className="text-slate-400"> (due {formatDate(a.due_date)})</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-xs text-slate-400">
        Created {formatTimestamp(minute.created_at)}{minute.created_by && ` by ${minute.created_by}`}
        {minute.updated_at !== minute.created_at && ` · updated ${formatTimestamp(minute.updated_at)}`}
      </p>
      <div className="flex flex-wrap gap-2">
        <button onClick={onEdit} className={ghostBtn}>Edit</button>
        {minute.action_items.length > 0 && (
          <button onClick={() => setShowPush(true)} className={ghostBtn}>Push action items to a project</button>
        )}
        <button onClick={onDelete} className={dangerBtn}>Delete</button>
      </div>

      {showPush && <PushActionItemsModal items={minute.action_items} onClose={() => setShowPush(false)} />}
    </div>
  );
}

function Section({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-slate-500">{title}</div>
      <ul className="list-inside list-disc text-sm text-slate-700">
        {items.map((it, i) => <li key={i}>{it}</li>)}
      </ul>
    </div>
  );
}

/** Creates one Taskmandu task per action item, on a chosen project's board. */
function PushActionItemsModal({ items, onClose }: { items: ActionItem[]; onClose: () => void }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [projectId, setProjectId] = useState('');
  const [pushing, setPushing] = useState(false);
  const [results, setResults] = useState<{ task: string; ok: boolean; error?: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    pmApi.projects().then(({ data }) => {
      setProjects(data.projects);
      if (data.projects.length > 0) setProjectId(data.projects[0]._id);
    }).catch((e) => setError(err(e, "Couldn't load projects."))).finally(() => setLoading(false));
  }, []);

  async function push() {
    if (!projectId) return;
    setPushing(true);
    setError(null);
    const out: { task: string; ok: boolean; error?: string }[] = [];
    for (const item of items) {
      try {
        await pmApi.addProjectTask(projectId, {
          title: item.task,
          assignedByName: item.owner || undefined,
          dueDate: item.due_date || today(14),
        });
        out.push({ task: item.task, ok: true });
      } catch (e) {
        out.push({ task: item.task, ok: false, error: err(e, 'Failed') });
      }
    }
    setResults(out);
    setPushing(false);
  }

  return (
    <Modal title="Push action items to a project" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-slate-600">
          Creates one task on the chosen project's board for each action item below. Items with no due date get one two weeks out.
        </p>
        <ul className="list-inside list-disc text-sm text-slate-700">
          {items.map((a, i) => <li key={i}>{a.task}{a.owner && ` — ${a.owner}`}</li>)}
        </ul>
        <Field label="Project">
          {loading ? (
            <p className="text-sm text-slate-500">Loading projects…</p>
          ) : (
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className={inputCls}>
              {projects.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}
            </select>
          )}
        </Field>
        <ErrorNote message={error} />
        {results && (
          <ul className="flex flex-col gap-1 text-sm">
            {results.map((r, i) => (
              <li key={i} className={r.ok ? 'text-green-700' : 'text-red-600'}>
                {r.ok ? '✓' : '✗'} {r.task}{!r.ok && r.error && ` — ${r.error}`}
              </li>
            ))}
          </ul>
        )}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={ghostBtn}>{results ? 'Close' : 'Cancel'}</button>
          {!results && (
            <button onClick={push} disabled={pushing || loading || !projectId} className={primaryBtn}>
              {pushing ? 'Pushing…' : `Push ${items.length} item${items.length === 1 ? '' : 's'}`}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}

function MinutesForm({
  initial,
  onCancel,
  onSaved,
}: {
  initial: MeetingMinutesFull | null;
  onCancel: () => void;
  onSaved: (m: MeetingMinutesFull) => void;
}) {
  const [notes, setNotes] = useState('');
  const [drafting, setDrafting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState(initial?.title ?? '');
  const [meetingDate, setMeetingDate] = useState(initial?.meeting_date ?? today());
  const [attendees, setAttendees] = useState<string[]>(initial?.attendees ?? []);
  const [agendaItems, setAgendaItems] = useState<string[]>(initial?.agenda_items ?? []);
  const [discussion, setDiscussion] = useState(initial?.discussion ?? '');
  const [decisions, setDecisions] = useState<string[]>(initial?.decisions ?? []);
  const [actionItems, setActionItems] = useState<ActionItem[]>(initial?.action_items ?? []);

  function applyDraft(d: MinutesDraft) {
    if (d.title) setTitle(d.title);
    setAttendees(d.attendees);
    setAgendaItems(d.agenda_items);
    setDiscussion(d.discussion);
    setDecisions(d.decisions);
    setActionItems(d.action_items);
  }

  async function draft() {
    if (!notes.trim()) return;
    setDrafting(true);
    setError(null);
    try {
      const { data } = await pmApi.minutesDraft(notes);
      applyDraft(data.draft);
    } catch (e) {
      setError(err(e, "Couldn't draft from those notes."));
    } finally {
      setDrafting(false);
    }
  }

  async function save() {
    if (!title.trim() || !meetingDate) return;
    setSaving(true);
    setError(null);
    const payload = {
      title: title.trim(),
      meeting_date: meetingDate,
      attendees,
      agenda_items: agendaItems,
      discussion,
      decisions,
      action_items: actionItems.filter((a) => a.task.trim()),
      raw_notes: notes || initial?.raw_notes || undefined,
    };
    try {
      const { data } = initial
        ? await pmApi.minutesUpdate(initial.id, payload)
        : await pmApi.minutesCreate(payload);
      onSaved(data.minute);
    } catch (e) {
      setError(err(e, "Couldn't save these minutes."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <button onClick={onCancel} className="text-sm text-slate-500 hover:text-slate-700">← Back</button>

      {!initial && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-2 text-sm font-medium text-slate-700">
            Paste rough notes — bullet points, half-sentences, whatever you typed during the meeting
          </div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={5}
            maxLength={8000}
            placeholder="e.g. met with seo guy, discussed core web vitals dropping on listing pages, he'll check by friday, also agreed to hold off on the blog redesign until next sprint..."
            className={inputCls}
          />
          <button onClick={draft} disabled={drafting || !notes.trim()} className={`${primaryBtn} mt-2`}>
            {drafting ? 'Drafting…' : 'Draft with AI'}
          </button>
          <p className="mt-1 text-xs text-slate-400">Fills the fields below from your notes — nothing invented, review before saving.</p>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Title">
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} className={inputCls} />
          </Field>
          <Field label="Meeting date">
            <input type="date" value={meetingDate} onChange={(e) => setMeetingDate(e.target.value)} className={inputCls} />
          </Field>
        </div>

        <div className="mt-3">
          <ListField label="Attendees" placeholder="Add a name…" items={attendees} onChange={setAttendees} />
        </div>
        <div className="mt-3">
          <ListField label="Agenda items" placeholder="Add an agenda item…" items={agendaItems} onChange={setAgendaItems} />
        </div>

        <div className="mt-3">
          <Field label="Discussion">
            <textarea value={discussion} onChange={(e) => setDiscussion(e.target.value)} rows={4} maxLength={8000} className={inputCls} />
          </Field>
        </div>

        <div className="mt-3">
          <ListField label="Decisions" placeholder="Add a decision…" items={decisions} onChange={setDecisions} />
        </div>

        <div className="mt-3">
          <div className="mb-1 text-xs font-medium text-slate-500">Action items</div>
          <div className="flex flex-col gap-2">
            {actionItems.map((a, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <input
                  value={a.task}
                  onChange={(e) => setActionItems((ai) => ai.map((x, j) => (j === i ? { ...x, task: e.target.value } : x)))}
                  placeholder="Task"
                  maxLength={300}
                  className="min-w-[140px] flex-1 rounded-md border border-slate-300 px-2 py-1 text-sm"
                />
                <input
                  value={a.owner}
                  onChange={(e) => setActionItems((ai) => ai.map((x, j) => (j === i ? { ...x, owner: e.target.value } : x)))}
                  placeholder="Owner"
                  maxLength={100}
                  className="w-28 rounded-md border border-slate-300 px-2 py-1 text-sm"
                />
                <input
                  type="date"
                  value={a.due_date ?? ''}
                  onChange={(e) => setActionItems((ai) => ai.map((x, j) => (j === i ? { ...x, due_date: e.target.value || null } : x)))}
                  className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                />
                <button onClick={() => setActionItems((ai) => ai.filter((_, j) => j !== i))} className="text-slate-400 hover:text-red-600">✕</button>
              </div>
            ))}
            <button
              onClick={() => setActionItems((ai) => [...ai, { task: '', owner: '', due_date: null }])}
              className="self-start text-xs text-slate-500 hover:text-slate-700"
            >
              + Add action item
            </button>
          </div>
        </div>

        <div className="mt-3"><ErrorNote message={error} /></div>

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onCancel} className={ghostBtn}>Cancel</button>
          <button onClick={save} disabled={saving || !title.trim()} className={primaryBtn}>{saving ? 'Saving…' : 'Save minutes'}</button>
        </div>
      </div>
    </div>
  );
}

function ListField({
  label,
  placeholder,
  items,
  onChange,
}: {
  label: string;
  placeholder: string;
  items: string[];
  onChange: (items: string[]) => void;
}) {
  const [draft, setDraft] = useState('');

  function add() {
    if (!draft.trim()) return;
    onChange([...items, draft.trim()]);
    setDraft('');
  }

  return (
    <div>
      <div className="mb-1 text-xs font-medium text-slate-500">{label}</div>
      <div className="mb-1.5 flex flex-wrap gap-1.5">
        {items.map((it, i) => (
          <span key={i} className="flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700">
            {it}
            <button onClick={() => onChange(items.filter((_, j) => j !== i))} className="text-slate-400 hover:text-red-600">✕</button>
          </span>
        ))}
      </div>
      <div className="flex gap-1.5">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          placeholder={placeholder}
          className="flex-1 rounded-md border border-slate-300 px-2 py-1 text-sm"
        />
        <button onClick={add} className="rounded-md border border-slate-300 px-2.5 py-1 text-sm text-slate-600 hover:bg-slate-50">Add</button>
      </div>
    </div>
  );
}
