import { useEffect, useMemo, useState } from 'react';
import { pmApi } from '../../lib/pmApi';
import { setUrlParams, useUrlParam } from '../../lib/urlState';
import { localISO } from '../../lib/meetingNotes';
import {
  MEETING_TYPES,
  TOPIC_SUGGESTIONS,
  autoTitle,
  blankTopic,
  deriveFields,
  minutesToText,
  minutesWarnings,
  monthLabel,
  quickDates,
  shortDate,
  topicsFor,
} from '../../lib/minutesFormat';
import EmailModal from './EmailModal';
import { EmptyState, JumpNav, PageHeader, Section, StatTile, btnChip, btnPrimary } from './ui/kit';
import type { ActionItem, MeetingMinutesFull, MeetingMinutesSummary, MinutesStatus, MinutesTopic, Project } from '../../types/pm';
import {
  ErrorNote,
  Field,
  Modal,
  err,
  ghostBtn,
  inputCls,
  primaryBtn,
  dangerBtn,
  formatTimestamp,
  useEmployees,
} from './Projects/ui';

/**
 * Meeting minutes — local records, no Taskmandu involved (except pushing action items to a board).
 * No syntax to learn: a short guided form (basics -> attendees -> topics -> actions) and the
 * standard layout is produced automatically. Entries can be saved as drafts and finished later.
 */

type EditTarget = { minute: MeetingMinutesFull | null; copy: boolean };

const badge = (s: MinutesStatus) =>
  s === 'draft' ? 'bg-amber-100 text-amber-800' : 'bg-green-100 text-green-800';

export default function MeetingMinutesPanel() {
  const [minutes, setMinutes] = useState<MeetingMinutesSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const openId = useUrlParam('minute');
  const [expanded, setExpanded] = useState<MeetingMinutesFull | null>(null);
  const [expandLoading, setExpandLoading] = useState(false);
  const [editing, setEditing] = useState<EditTarget | null>(null);
  const [filter, setFilter] = useState<'all' | MinutesStatus>('all');
  const [query, setQuery] = useState('');

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

  async function markFinal(m: MeetingMinutesFull) {
    try {
      const { data } = await pmApi.minutesUpdate(m.id, { status: 'final' });
      onSaved(data.minute);
    } catch (e) {
      setError(err(e, "Couldn't update that entry."));
    }
  }

  function onSaved(minute: MeetingMinutesFull) {
    setEditing(null);
    setMinutes((ms) => {
      const summary: MeetingMinutesSummary = {
        id: minute.id,
        title: minute.title,
        status: minute.status,
        meeting_date: minute.meeting_date,
        attendees: minute.attendees,
        action_items: minute.action_items,
      };
      const next = ms.some((m) => m.id === minute.id) ? ms.map((m) => (m.id === minute.id ? summary : m)) : [summary, ...ms];
      return next.sort((a, b) => (a.meeting_date < b.meeting_date ? 1 : a.meeting_date > b.meeting_date ? -1 : b.id - a.id));
    });
    setExpanded(minute);
    setUrlParams({ minute: String(minute.id) });
  }

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return minutes.filter(
      (m) =>
        (filter === 'all' || m.status === filter) &&
        (!q || m.title.toLowerCase().includes(q) || m.attendees.some((a) => a.toLowerCase().includes(q))),
    );
  }, [minutes, filter, query]);

  const groups = useMemo(() => {
    const out: { label: string; items: MeetingMinutesSummary[] }[] = [];
    for (const m of visible) {
      const label = monthLabel(m.meeting_date);
      const last = out[out.length - 1];
      if (last && last.label === label) last.items.push(m);
      else out.push({ label, items: [m] });
    }
    return out;
  }, [visible]);

  if (editing) {
    return (
      <MinutesWizard
        initial={editing.minute}
        copy={editing.copy}
        onCancel={() => setEditing(null)}
        onSaved={onSaved}
      />
    );
  }

  const jumpToList = () => document.getElementById('minutes-list')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const drafts = minutes.filter((m) => m.status === 'draft').length;
  const finals = minutes.filter((m) => m.status === 'final').length;
  const openActions = minutes.reduce((n, m) => n + (m.status === 'final' ? 0 : m.action_items.length), 0);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        icon="notes"
        title="Meeting minutes"
        description="Record decisions and action items, then turn them into tasks."
        status={minutes.length ? `${minutes.length} meeting${minutes.length === 1 ? '' : 's'} · ${drafts} draft${drafts === 1 ? '' : 's'}` : undefined}
        actions={
          <button onClick={() => setEditing({ minute: null, copy: false })} className={btnPrimary}>
            + New meeting
          </button>
        }
        links={[
          { label: 'Brief to tickets', tab: 'brief' },
          { label: 'Projects', tab: 'projects' },
          { label: 'Today', tab: 'today' },
        ]}
      />

      <JumpNav
        items={[
          { id: 'minutes-overview', label: 'Overview' },
          { id: 'minutes-list', label: 'All meetings', count: minutes.length },
        ]}
      />

      <Section id="minutes-overview" title="Overview" tone="brand">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="Meetings" value={minutes.length} active={filter === 'all'} onClick={() => { setFilter('all'); jumpToList(); }} />
          <StatTile label="Drafts" value={drafts} tone={drafts ? 'warn' : 'neutral'} hint="not finalised" active={filter === 'draft'} onClick={() => { setFilter('draft'); jumpToList(); }} />
          <StatTile label="Final" value={finals} tone="ok" active={filter === 'final'} onClick={() => { setFilter('final'); jumpToList(); }} />
          <StatTile label="Action items" value={openActions} tone={openActions ? 'info' : 'neutral'} hint="in draft meetings" />
        </div>
      </Section>

      <Section
        id="minutes-list"
        title="All meetings"
        count={visible.length}
        tone="info"
        actions={
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search title or attendee…"
            aria-label="Search meetings"
            className="w-40 rounded-lg border border-slate-300 px-2.5 py-1 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 sm:w-56"
          />
        }
      >
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {(['all', 'draft', 'final'] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={btnChip(filter === f)}>
            {f === 'all' ? 'All' : f === 'draft' ? `Drafts${drafts ? ` (${drafts})` : ''}` : 'Final'}
          </button>
        ))}
      </div>

      <ErrorNote message={error} />
      {loading && <p className="text-sm text-slate-500">Loading…</p>}
      {!loading && minutes.length === 0 && !error && (
        <EmptyState
          title="No meeting minutes yet"
          action={
            <button onClick={() => setEditing({ minute: null, copy: false })} className={btnPrimary}>
              + New meeting
            </button>
          }
        >
          Add your first meeting to capture decisions and action items.
        </EmptyState>
      )}
      {!loading && minutes.length > 0 && visible.length === 0 && <EmptyState title="Nothing matches">Try a different filter or search.</EmptyState>}

      {groups.map((g) => (
        <div key={g.label} className="flex flex-col gap-2">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-400">{g.label}</div>
          {g.items.map((m) => {
            const isOpen = String(openId) === String(m.id);
            return (
              <div key={m.id} className="rounded-xl border border-slate-200 bg-white">
                <button onClick={() => toggle(m.id)} className="flex w-full items-center justify-between gap-3 p-4 text-left">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium text-slate-900">{m.title}</span>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase ${badge(m.status)}`}>{m.status}</span>
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500">
                      {shortDate(m.meeting_date)}
                      {m.attendees.length > 0 && ` · ${m.attendees.length} attendee${m.attendees.length === 1 ? '' : 's'}`}
                      {m.action_items.length > 0 && ` · ${m.action_items.length} action item${m.action_items.length === 1 ? '' : 's'}`}
                    </div>
                  </div>
                  <span className="shrink-0 text-slate-400">{isOpen ? '▲' : '▼'}</span>
                </button>

                {isOpen && (
                  <div className="border-t border-slate-100 p-4">
                    {expandLoading && <p className="text-sm text-slate-500">Loading…</p>}
                    {!expandLoading && expanded && expanded.id === m.id && (
                      <MinutesDetail
                        minute={expanded}
                        onEdit={() => setEditing({ minute: expanded, copy: false })}
                        onDuplicate={() => setEditing({ minute: expanded, copy: true })}
                        onMarkFinal={() => markFinal(expanded)}
                        onDelete={() => remove(m.id)}
                      />
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
      </Section>
    </div>
  );
}

function MinutesDetail({
  minute,
  onEdit,
  onDuplicate,
  onMarkFinal,
  onDelete,
}: {
  minute: MeetingMinutesFull;
  onEdit: () => void;
  onDuplicate: () => void;
  onMarkFinal: () => void;
  onDelete: () => void;
}) {
  const [showPush, setShowPush] = useState(false);
  const [showEmail, setShowEmail] = useState(false);
  const [sentNote, setSentNote] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const topics = topicsFor(minute);
  const text = minutesToText({ ...minute, topics });

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — nothing useful to do */
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {minute.attendees.length > 0 && (
        <div>
          <div className="mb-1 text-xs font-medium text-slate-500">Attendees</div>
          <p className="text-sm text-slate-700">{minute.attendees.join(', ')}</p>
        </div>
      )}

      {topics.map((t, i) => (
        <div key={i}>
          <div className="text-sm font-medium text-slate-800">{i + 1}. {t.title}</div>
          {t.notes && <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-700">{t.notes}</p>}
          {t.decision && <p className="mt-0.5 text-sm text-slate-700"><span className="font-medium">Decision:</span> {t.decision}</p>}
        </div>
      ))}

      {minute.action_items.length > 0 && (
        <div>
          <div className="mb-1 text-xs font-medium text-slate-500">Action items</div>
          <ul className="flex flex-col gap-1">
            {minute.action_items.map((a, i) => (
              <li key={i} className="text-sm text-slate-700">
                {a.task}
                <span className="text-slate-400"> — {a.owner || 'Unassigned'}</span>
                <span className="text-slate-400">{a.due_date ? ` (due ${shortDate(a.due_date)})` : ' (no due date)'}</span>
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
        <button onClick={copy} className={ghostBtn}>{copied ? 'Copied ✓' : 'Copy as text'}</button>
        <button onClick={() => setShowEmail(true)} className={ghostBtn}>Email minutes</button>
        <button onClick={onEdit} className={ghostBtn}>Edit</button>
        {minute.status === 'draft' && <button onClick={onMarkFinal} className={ghostBtn}>Mark final</button>}
        <button onClick={onDuplicate} className={ghostBtn}>Duplicate for next meeting</button>
        {minute.action_items.length > 0 && (
          <button onClick={() => setShowPush(true)} className={ghostBtn}>Push action items to a project</button>
        )}
        <button onClick={onDelete} className={dangerBtn}>Delete</button>
      </div>

      {sentNote && <p className="text-xs text-green-700">{sentNote}</p>}
      {showPush && <PushActionItemsModal items={minute.action_items} onClose={() => setShowPush(false)} />}
      {showEmail && (
        <EmailModal
          title="Email minutes"
          names={minute.attendees}
          subject={`Minutes: ${minute.title} — ${shortDate(minute.meeting_date)}`}
          body={`Hi all,\n\nHere are the minutes from our meeting.\n\n${text}\n\nThanks`}
          onClose={() => setShowEmail(false)}
          onSent={(n) => {
            setShowEmail(false);
            setSentNote(`Minutes emailed to ${n} ${n === 1 ? 'person' : 'people'}.`);
          }}
        />
      )}
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
    // Keep a running copy so every pushed item ends up flagged, not just the last one.
    let working = items;
    let markFailed = false;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      try {
        await pmApi.addProjectTask(projectId, {
          title: item.task,
          assignedByName: item.owner || undefined,
          dueDate: item.due_date || quickDates()[3].value,
        });
        out.push({ task: item.task, ok: true });
      } catch (e) {
        out.push({ task: item.task, ok: false, error: err(e, 'Failed') });
        continue;
      }

      // The task now exists in Taskmandu. If recording that on the minutes fails it must not be
      // reported as a failed push (that would invite pushing the same task twice).
      if (minuteId) {
        working = working.map((a, j) => (j === i ? { ...a, pushed_to_board: true, pushed_project_id: projectId } : a));
        try {
          await pmApi.minutesUpdate(minuteId, { action_items: working });
        } catch {
          markFailed = true;
        }
      }
    }
    if (markFailed) setError("The tasks were created, but couldn't be marked as pushed on these minutes.");
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

const STEPS = ['Basics', 'Attendees', 'Topics', 'Action items', 'Review'] as const;

function MinutesWizard({
  initial,
  copy,
  onCancel,
  onSaved,
}: {
  initial: MeetingMinutesFull | null;
  copy: boolean;
  onCancel: () => void;
  onSaved: (m: MeetingMinutesFull) => void;
}) {
  const isEdit = !!initial && !copy;
  const { employees } = useEmployees();
  const [projects, setProjects] = useState<Project[]>([]);
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Basics
  const [type, setType] = useState(MEETING_TYPES[0]);
  const [project, setProject] = useState('');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [titleTouched, setTitleTouched] = useState(!!initial);
  const [meetingDate, setMeetingDate] = useState(copy || !initial ? localISO(new Date()) : initial.meeting_date);

  // Attendees (plain names; custom ones are just names that aren't in the employee list)
  const [attendees, setAttendees] = useState<string[]>(initial?.attendees ?? []);
  const [search, setSearch] = useState('');
  const [customName, setCustomName] = useState('');
  const [customCompany, setCustomCompany] = useState('');

  // Topics + action items
  const [topics, setTopics] = useState<MinutesTopic[]>(
    initial ? (copy ? topicsFor(initial).map((t) => blankTopic(t.title)) : topicsFor(initial)) : [blankTopic()],
  );
  const [actionItems, setActionItems] = useState<ActionItem[]>(
    initial && !copy ? initial.action_items.map((a) => ({ ...a, task: a.task ?? '', owner: a.owner ?? '' })) : [],
  );

  useEffect(() => {
    pmApi.projects().then(({ data }) => setProjects(data.projects)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!titleTouched) setTitle(autoTitle(type, project));
  }, [type, project, titleTouched]);

  const employeeNames = useMemo(() => new Set(employees.map((e) => e.name)), [employees]);
  const customAttendees = attendees.filter((a) => !employeeNames.has(a));
  const shownEmployees = employees.filter((e) => e.name.toLowerCase().includes(search.trim().toLowerCase()));
  // Owners come from the attendees picked in step 2. An existing owner who is no longer an attendee stays selectable.
  const ownerOptions = (current: string) => (current && !attendees.includes(current) ? [...attendees, current] : attendees);

  const toggleAttendee = (name: string) =>
    setAttendees((a) => (a.includes(name) ? a.filter((x) => x !== name) : [...a, name]));

  function addCustom() {
    const n = customName.trim();
    if (!n) return;
    const full = customCompany.trim() ? `${n} (${customCompany.trim()})` : n;
    setAttendees((a) => (a.includes(full) ? a : [...a, full]));
    setCustomName('');
    setCustomCompany('');
  }

  const updateTopic = (i: number, patch: Partial<MinutesTopic>) =>
    setTopics((ts) => ts.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  const updateAction = (i: number, patch: Partial<ActionItem>) =>
    setActionItems((ai) => ai.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const snapshot = { title: title.trim(), meeting_date: meetingDate, attendees, topics, action_items: actionItems };
  const text = minutesToText(snapshot);
  const warnings = minutesWarnings(snapshot);
  const dates = quickDates();

  async function save(status: MinutesStatus) {
    if (!title.trim() || !meetingDate) {
      setStep(0);
      setError('Add a title and a date first.');
      return;
    }
    setSaving(true);
    setError(null);
    const f = deriveFields(topics, actionItems);
    const payload = {
      title: title.trim(),
      status,
      meeting_date: meetingDate,
      attendees,
      topics: f.topics,
      agenda_items: f.agenda_items,
      discussion: f.discussion,
      decisions: f.decisions,
      action_items: f.action_items,
    };
    try {
      const { data } = isEdit ? await pmApi.minutesUpdate(initial!.id, payload) : await pmApi.minutesCreate(payload);
      onSaved(data.minute);
    } catch (e) {
      setError(err(e, "Couldn't save these minutes."));
    } finally {
      setSaving(false);
    }
  }

  async function copyText() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  }

  const last = step === STEPS.length - 1;

  return (
    <div className="flex flex-col gap-4">
      <button onClick={onCancel} className="self-start text-sm text-slate-500 hover:text-slate-700">← Back to list</button>

      <div className="flex flex-wrap gap-1.5">
        {STEPS.map((s, i) => (
          <button
            key={s}
            onClick={() => setStep(i)}
            className={`rounded-full px-3 py-1 text-xs ${i === step ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
          >
            {i + 1}. {s}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        {step === 0 && (
          <div className="flex flex-col gap-3">
            <Field label="What kind of meeting?">
              <div className="flex flex-wrap gap-1.5">
                {MEETING_TYPES.map((t) => (
                  <button
                    key={t}
                    onClick={() => { setType(t); setTitleTouched(false); }}
                    className={`rounded-full px-3 py-1 text-xs ${type === t && !titleTouched ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Project / client (optional)">
                <input list="mm-projects" value={project} onChange={(e) => setProject(e.target.value)} className={inputCls} />
                <datalist id="mm-projects">{projects.map((p) => <option key={p._id} value={p.name} />)}</datalist>
              </Field>
              <Field label="Meeting date">
                <input type="date" value={meetingDate} onChange={(e) => setMeetingDate(e.target.value)} className={inputCls} />
              </Field>
            </div>
            <Field label="Title (auto-filled — edit if you like)">
              <input
                value={title}
                onChange={(e) => { setTitle(e.target.value); setTitleTouched(true); }}
                maxLength={200}
                className={inputCls}
              />
            </Field>
          </div>
        )}

        {step === 1 && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search team…" className="flex-1 rounded-md border border-slate-300 px-2 py-1 text-sm" />
              <button onClick={() => setAttendees((a) => Array.from(new Set([...a, ...shownEmployees.map((e) => e.name)])))} className={ghostBtn}>Select shown</button>
              <button onClick={() => setAttendees((a) => a.filter((x) => !employeeNames.has(x)))} className={ghostBtn}>Clear team</button>
            </div>
            <div className="grid max-h-56 grid-cols-2 gap-1 overflow-y-auto rounded-md border border-slate-200 p-2">
              {employees.length === 0 && <span className="col-span-2 text-xs text-slate-400">Team list not loaded — add people below instead.</span>}
              {shownEmployees.map((e) => (
                <label key={e.employeeId} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={attendees.includes(e.name)} onChange={() => toggleAttendee(e.name)} />
                  <span>{e.name}</span>
                  {e.designation && <span className="truncate text-xs text-slate-400">{e.designation}</span>}
                </label>
              ))}
            </div>

            <div>
              <div className="mb-1 text-xs font-medium text-slate-500">Someone not on the team list? (client, vendor, guest)</div>
              <div className="flex flex-wrap gap-1.5">
                <input value={customName} onChange={(e) => setCustomName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } }} placeholder="Name" className="w-40 rounded-md border border-slate-300 px-2 py-1 text-sm" />
                <input value={customCompany} onChange={(e) => setCustomCompany(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } }} placeholder="Company (optional)" className="w-44 rounded-md border border-slate-300 px-2 py-1 text-sm" />
                <button onClick={addCustom} className={ghostBtn}>Add</button>
              </div>
              {customAttendees.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {customAttendees.map((a) => (
                    <span key={a} className="flex items-center gap-1 rounded-full bg-sky-50 px-2.5 py-1 text-xs text-sky-800">
                      {a}
                      <button onClick={() => toggleAttendee(a)} className="text-sky-400 hover:text-red-600">✕</button>
                    </span>
                  ))}
                </div>
              )}
            </div>
            <p className="text-xs text-slate-400">{attendees.length} attendee{attendees.length === 1 ? '' : 's'} selected.</p>
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-slate-500">Quick add:</span>
              {TOPIC_SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => setTopics((ts) => (ts.length === 1 && !ts[0].title && !ts[0].notes && !ts[0].decision ? [blankTopic(s)] : [...ts, blankTopic(s)]))}
                  className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-200"
                >
                  + {s}
                </button>
              ))}
            </div>
            {topics.map((t, i) => (
              <div key={i} className="rounded-lg border border-slate-200 p-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400">{i + 1}.</span>
                  <input value={t.title} onChange={(e) => updateTopic(i, { title: e.target.value })} placeholder="Topic" maxLength={200} className="flex-1 rounded-md border border-slate-300 px-2 py-1 text-sm" />
                  <button onClick={() => setTopics((ts) => ts.filter((_, j) => j !== i))} className="text-slate-400 hover:text-red-600">✕</button>
                </div>
                <textarea value={t.notes} onChange={(e) => updateTopic(i, { notes: e.target.value })} rows={3} maxLength={4000} placeholder="What was discussed — rough is fine" className={`${inputCls} mt-2`} />
                <input value={t.decision} onChange={(e) => updateTopic(i, { decision: e.target.value })} maxLength={300} placeholder="Decision made (optional)" className={`${inputCls} mt-2`} />
              </div>
            ))}
            <button onClick={() => setTopics((ts) => [...ts, blankTopic()])} className="self-start text-xs text-slate-500 hover:text-slate-700">+ Add topic</button>
          </div>
        )}

        {step === 3 && (
          <div className="flex flex-col gap-3">
            {actionItems.length === 0 && <p className="text-sm text-slate-500">No action items yet.</p>}
            {actionItems.map((a, i) => (
              <div key={i} className="rounded-lg border border-slate-200 p-3">
                <div className="flex items-center gap-2">
                  <input value={a.task} onChange={(e) => updateAction(i, { task: e.target.value })} placeholder="What needs to be done" maxLength={300} className="flex-1 rounded-md border border-slate-300 px-2 py-1 text-sm" />
                  <button onClick={() => setActionItems((ai) => ai.filter((_, j) => j !== i))} className="text-slate-400 hover:text-red-600">✕</button>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <select value={a.owner} onChange={(e) => updateAction(i, { owner: e.target.value })} className="w-48 rounded-md border border-slate-300 px-2 py-1 text-sm">
                    <option value="">{attendees.length ? 'Owner…' : 'Pick attendees first'}</option>
                    {ownerOptions(a.owner).map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                  <input type="date" value={a.due_date ?? ''} onChange={(e) => updateAction(i, { due_date: e.target.value || null })} className="rounded-md border border-slate-300 px-2 py-1 text-sm" />
                  {dates.map((d) => (
                    <button key={d.label} onClick={() => updateAction(i, { due_date: d.value })} className={`rounded-full px-2.5 py-1 text-xs ${a.due_date === d.value ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                      {d.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <button onClick={() => setActionItems((ai) => [...ai, { task: '', owner: '', due_date: null }])} className="self-start text-xs text-slate-500 hover:text-slate-700">+ Add action item</button>
          </div>
        )}

        {step === 4 && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium text-slate-500">Formatted automatically</div>
              <button onClick={copyText} className={ghostBtn}>{copied ? 'Copied ✓' : 'Copy as text'}</button>
            </div>
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-sm text-slate-800">{text}</pre>
            {warnings.length > 0 && (
              <ul className="list-inside list-disc text-xs text-amber-700">
                {warnings.map((w) => <li key={w}>{w}</li>)}
              </ul>
            )}
          </div>
        )}

        <div className="mt-3"><ErrorNote message={error} /></div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <button onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0} className={`${ghostBtn} disabled:opacity-40`}>Back</button>
          <div className="flex gap-2">
            <button onClick={() => save('draft')} disabled={saving} className={ghostBtn}>{saving ? 'Saving…' : 'Save draft'}</button>
            {last ? (
              <button onClick={() => save('final')} disabled={saving} className={primaryBtn}>Save as final</button>
            ) : (
              <button onClick={() => setStep((s) => s + 1)} className={primaryBtn}>Next</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
