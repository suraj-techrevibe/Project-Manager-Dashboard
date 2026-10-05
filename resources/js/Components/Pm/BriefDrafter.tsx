import { useEffect, useMemo, useState } from 'react';
import { pmApi } from '../../lib/pmApi';
import { BRIEF_MAX_CHARS, MAX_TICKETS, autoAssign, blankSubtask, blankTicket, findExisting, keywordQuestions, questionsEmail, sameTitle, splitBrief, type EditableTicket } from '../../lib/briefHeuristics';
import { localISO } from '../../lib/meetingNotes';
import { TASK_PRIORITIES } from '../../types/pm';
import type { BriefContext, Project, PushTicket } from '../../types/pm';
import MeetingPicker from './MeetingPicker';

const inputCls = 'rounded-md border border-slate-200 px-2 py-1.5 text-sm focus:border-slate-400 focus:outline-none';

function errorText(e: any, fallback: string) {
  const d = e?.response?.data;
  if (d?.error) return d.error;
  if (d?.errors) {
    const first = Object.values(d.errors)[0] as string[] | undefined;
    if (first?.[0]) return first[0];
  }
  return d?.message || fallback;
}

type MeetingContext = { id: number; title: string; meeting_date: string; minutes: string };

export default function BriefDrafter() {
  const [brief, setBrief] = useState('');
  const [tickets, setTickets] = useState<EditableTicket[]>([]);
  const [aiQuestions, setAiQuestions] = useState<string[]>([]);
  const [skipped, setSkipped] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [ctx, setCtx] = useState<BriefContext | null>(null);
  const [ctxError, setCtxError] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [pushing, setPushing] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);
  const [pushSummary, setPushSummary] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [meeting, setMeeting] = useState<MeetingContext | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  const loadContext = () =>
    pmApi
      .briefContext()
      .then(({ data }) => {
        setCtx(data);
        setCtxError(null);
      })
      .catch((e) => setCtxError(errorText(e, "Couldn't load employees — Taskmandu may be unreachable.")));

  useEffect(() => {
    loadContext();
    pmApi.projects().then(({ data }) => setProjects(data.projects)).catch(() => {});
  }, []);

  const employees = ctx?.employees ?? [];
  const pending = tickets.filter((t) => t.state !== 'pushed');
  const today = localISO(new Date());

  const batchLoad = useMemo(() => {
    const m: Record<string, { n: number; h: number }> = {};
    pending.forEach((t) => {
      if (!t.assigneeId) return;
      const x = m[t.assigneeId] ?? { n: 0, h: 0 };
      m[t.assigneeId] = { n: x.n + 1, h: x.h + (Number(t.estimate_hours) || 0) };
    });
    return m;
  }, [pending]);

  const employeeLabel = (e: (typeof employees)[number]) =>
    `${e.name}${e.designation ? ` (${e.designation})` : ''} — ${e.open ?? 0} open`;

  const duplicates = useMemo(() => {
    const out: Record<string, string> = {};
    tickets.forEach((t, i) => {
      if (t.state === 'pushed' || !t.title.trim()) return;
      const ex = findExisting(t.title, ctx?.titles ?? []);
      if (ex) {
        out[t.uid] = `A similar task already exists${ex.project_name ? ` in ${ex.project_name}` : ''}: “${ex.title}”`;
        return;
      }
      const j = tickets.findIndex((o, k) => k < i && o.state !== 'pushed' && sameTitle(o.title, t.title));
      if (j >= 0) out[t.uid] = `Same as ticket #${j + 1} in this batch`;
    });
    return out;
  }, [tickets, ctx]);

  const questions = useMemo(
    () => Array.from(new Set([...aiQuestions, ...keywordQuestions(`${brief}\n${tickets.map((t) => `${t.title} ${t.description}`).join('\n')}`)])),
    [brief, tickets, aiQuestions],
  );
  const askClient = questions.filter((q) => !skipped[q]);

  const update = (uid: string, patch: Partial<EditableTicket>) =>
    setTickets((p) => p.map((t) => (t.uid === uid ? { ...t, ...patch, state: t.state === 'failed' ? 'draft' : t.state } : t)));

  const loadDrafts = (fresh: EditableTicket[]) => {
    setTickets((p) => [...p.filter((t) => t.state === 'pushed'), ...fresh].slice(0, MAX_TICKETS));
    setAttempted(false);
    setPushError(null);
    setPushSummary(null);
    setDraftSaved(false);
  };

  async function draft() {
    if (!brief.trim()) return setDraftError('Paste a brief first');
    if (brief.length > BRIEF_MAX_CHARS) return setDraftError(`The brief is over ${BRIEF_MAX_CHARS.toLocaleString()} characters.`);
    setLoading(true);
    setDraftError(null);
    try {
      const { data } = await pmApi.draftBrief(brief.trim());
      loadDrafts(
        data.tickets.map((t: any) =>
          blankTicket({
            title: t.title,
            description: t.description ?? '',
            level: t.level === 'senior dev' ? 'senior dev' : 'intern',
            estimate_hours: Number(t.estimate_hours) || 2,
          }),
        ),
      );
      setAiQuestions(data.questions ?? []);
    } catch (e) {
      setDraftError(errorText(e, "Couldn't draft tickets."));
    } finally {
      setLoading(false);
    }
  }

  function splitLocally() {
    if (!brief.trim()) return setDraftError('Paste a brief first');
    const r = splitBrief(brief);
    loadDrafts(r.tickets);
    setAiQuestions([]);
    setNotice(`Split ${r.tickets.length} ticket${r.tickets.length === 1 ? '' : 's'} without AI.`);
  }

  const assignAll = (id: string) =>
    id &&
    setTickets((p) =>
      p.map((t) =>
        t.state === 'pushed'
          ? t
          : { ...t, assigneeId: id, subtasks: t.subtasks.map((s) => ({ ...s, assigneeId: s.assigneeId || id })) },
      ),
    );

  const auto = () => {
    const picks = autoAssign(tickets, employees);
    setTickets((p) =>
      p.map((t) =>
        picks[t.uid]
          ? {
              ...t,
              assigneeId: picks[t.uid],
              subtasks: t.subtasks.map((s) => ({ ...s, assigneeId: s.assigneeId || picks[t.uid] })),
            }
          : t,
      ),
    );
  };

  const confirmProject = async (uid: string) => {
    const t = tickets.find((x) => x.uid === uid);
    if (!t?.projectName.trim()) return;
    setPushing(true);
    try {
      const { data } = await pmApi.createProject({ name: t.projectName.trim(), status: 'Planning' });
      setProjects((p) => [...p, data.project]);
      update(uid, {
        projectId: data.project._id,
        projectName: data.project.name,
        projectNeedsConfirmation: false,
        projectConfirmed: true,
      });
      setNotice(`Created project “${data.project.name}” for this Work Item.`);
    } catch (e) {
      setPushError(errorText(e, "Couldn't create the project."));
    } finally {
      setPushing(false);
    }
  };

  async function pushList(list: EditableTicket[]) {
    setAttempted(true);
    setPushSummary(null);

    if (list.some((t) => !t.title.trim())) return setPushError('Every ticket needs a title.');

    const missing = list.filter((t) => !t.assigneeId).length;
    if (missing) return setPushError(`${missing} ticket${missing === 1 ? ' has' : 's have'} no assignee.`);

    const unconfirmed = list.filter((t) => t.projectNeedsConfirmation || (!t.projectId && t.subtasks.length));
    if (unconfirmed.length) return setPushError('Confirm or select a project for every meeting Work Item before pushing.');

    const payload: PushTicket[] = list.map((t) => ({
      title: t.title.trim(),
      description: t.description.trim(),
      level: t.level,
      estimate_hours: t.estimate_hours === '' ? null : Number(t.estimate_hours),
      priority: t.priority,
      assignee_employee_id: t.assigneeId,
      due_date: t.dueDate || null,
      project_id: t.projectId || null,
      project_name: t.projectName || null,
      project_confirmed: t.projectConfirmed || !t.projectId,
      subtasks: t.subtasks
        .filter((s) => s.title.trim())
        .map((s) => ({
          title: s.title.trim(),
          description: s.description.trim() || undefined,
          assignee_employee_id: s.assigneeId || t.assigneeId,
          due_date: s.dueDate || null,
        })),
    }));

    setPushing(true);
    setPushError(null);
    try {
      const { data } = await pmApi.pushTickets(payload);
      const byUid = new Map(data.results.map((r: any) => [list[r.index].uid, r]));
      setTickets((p) =>
        p.map((t) => {
          const r = byUid.get(t.uid);
          return r?.ok
            ? { ...t, state: 'pushed', error: undefined }
            : r
              ? { ...t, state: 'failed', error: r.error ?? 'Failed' }
              : t;
        }),
      );
      const subtasksCreated = data.results
        .filter((r: any) => r.ok)
        .map((r: any) => r.subtasks_created || 0)
        .reduce((a: number, b: number) => a + b, 0);
      const failedText = data.failed ? `, ${data.failed} failed` : '';
      setPushSummary(`${data.created} pushed${failedText}. ${subtasksCreated} subtasks created.`);
      loadContext();
    } catch (e) {
      setPushError(errorText(e, "Couldn't push tickets."));
    } finally {
      setPushing(false);
    }
  }

  const remove = (uid: string) => setTickets((p) => p.filter((t) => t.uid !== uid));
  const add = () => setTickets((p) => (p.length < MAX_TICKETS ? [...p, blankTicket()] : p));

  const saveMeetingDraft = async () => {
    if (!meeting) return;
    setSavingDraft(true);
    try {
      await (await import('axios')).default.post('/pm/drafts', {
        title: `Meeting: ${meeting.title}`,
        brief: meeting.minutes,
        tickets: tickets.map((t) => ({
          uid: t.uid,
          title: t.title,
          description: t.description,
          level: t.level,
          estimate_hours: t.estimate_hours,
          priority: t.priority,
          assigneeId: t.assigneeId,
          dueDate: t.dueDate,
          state: t.state,
          subtasks: t.subtasks,
          projectId: t.projectId,
          projectName: t.projectName,
        })),
        source_type: 'meeting',
        source_id: meeting.id,
        source_title: meeting.title,
      });
      setDraftSaved(true);
    } catch (e) {
      setDraftError(errorText(e, "Couldn't save the meeting draft."));
    } finally {
      setSavingDraft(false);
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <textarea
        value={brief}
        onChange={(e) => {
          setBrief(e.target.value);
          setMeeting(null);
        }}
        placeholder="Paste a raw client brief, or load a saved meeting…"
        className="min-h-[110px] w-full resize-y rounded-md border border-slate-200 p-2 text-sm"
      />
      <div className="mt-2 flex flex-wrap justify-end gap-2">
        <button onClick={splitLocally} disabled={loading} className={inputCls}>Split without AI</button>
        <MeetingPicker
          employees={employees}
          projects={projects}
          disabled={loading}
          onError={setDraftError}
          onLoad={(fresh, msg, m) => {
            loadDrafts(fresh);
            setMeeting(m);
            setBrief(m.minutes);
            setNotice(msg);
          }}
        />
        <button onClick={draft} disabled={loading} className="rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white">
          {loading ? 'Drafting…' : 'Draft with AI'}
        </button>
      </div>
      {meeting && (
        <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600">
          <b>Saved meeting context:</b> {meeting.title} · {meeting.meeting_date}
        </div>
      )}
      {notice && <div className="mt-2 rounded-md bg-slate-50 p-2 text-xs text-slate-600">{notice}</div>}
      {draftError && <div className="mt-2 text-xs text-red-600">{draftError}</div>}
      {ctxError && <div className="mt-2 text-xs text-amber-700">{ctxError}</div>}

      {tickets.length > 0 && (
        <div className="mt-3 border-t border-slate-100 pt-3">
          <div className="mb-3 flex flex-wrap gap-2">
            <select value="" onChange={(e) => assignAll(e.target.value)} className={inputCls}>
              <option value="">Assign all to…</option>
              {employees.map((e) => <option key={e.employeeId} value={e.employeeId}>{employeeLabel(e)}</option>)}
            </select>
            <button onClick={auto} disabled={!employees.length} className={inputCls}>Auto-assign to least busy</button>
            <span className="ml-auto text-xs text-slate-400">{tickets.length} / {MAX_TICKETS} tickets</span>
          </div>

          <div className="flex flex-col gap-3">
            {tickets.map((t, i) => (
              <div key={t.uid} className={`rounded-md border p-3 ${t.state === 'failed' ? 'border-red-300 bg-red-50/40' : 'border-slate-200 bg-slate-50'}`}>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400">#{i + 1}</span>
                  <input value={t.title} onChange={(e) => update(t.uid, { title: e.target.value })} className={`${inputCls} min-w-0 flex-1`} placeholder="Task title" />
                  <button onClick={() => remove(t.uid)} className="text-slate-400 hover:text-red-600">✕</button>
                </div>
                <textarea value={t.description} onChange={(e) => update(t.uid, { description: e.target.value })} rows={2} className={`${inputCls} mt-2 w-full resize-y text-xs`} placeholder="Task description" />

                <div className="mt-2 grid gap-2 md:grid-cols-2">
                  <div>
                    <label className="text-xs text-slate-500">Person / Owner</label>
                    <select value={t.assigneeId} onChange={(e) => update(t.uid, { assigneeId: e.target.value })} className={`${inputCls} mt-1 w-full ${attempted && !t.assigneeId ? 'border-red-400' : ''}`}>
                      <option value="">Select owner…</option>
                      {employees.map((e) => <option key={e.employeeId} value={e.employeeId}>{employeeLabel(e)}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-slate-500">Business / Project</label>
                    {t.projectId ? (
                      <select
                        value={t.projectId}
                        onChange={(e) => {
                          const p = projects.find((x) => x._id === e.target.value);
                          update(t.uid, { projectId: e.target.value, projectName: p?.name ?? t.projectName, projectConfirmed: true, projectNeedsConfirmation: false });
                        }}
                        className={`${inputCls} mt-1 w-full`}
                      >
                        <option value="">Select project…</option>
                        {projects.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}
                      </select>
                    ) : (
                      <div className="mt-1 flex gap-2">
                        <input value={t.projectName} onChange={(e) => update(t.uid, { projectName: e.target.value, projectNeedsConfirmation: true, projectConfirmed: false })} className={`${inputCls} flex-1`} placeholder="Project name" />
                        <button onClick={() => confirmProject(t.uid)} disabled={pushing || !t.projectName.trim()} className="rounded-md border border-slate-300 px-2 text-xs">Confirm & create</button>
                      </div>
                    )}
                    {t.projectNeedsConfirmation && <div className="mt-1 text-xs text-amber-700">New project: {t.projectName} — confirmation required.</div>}
                  </div>
                </div>

                <div className="mt-3 rounded-md border border-slate-200 bg-white p-2">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-700">ACTION ITEMS → SUBTASKS</span>
                    <button onClick={() => update(t.uid, { subtasks: [...t.subtasks, blankSubtask({ assigneeId: t.assigneeId })] })} className="text-xs text-slate-600">+ Add action item</button>
                  </div>
                  {t.subtasks.length === 0 && <div className="text-xs text-slate-400">No action items.</div>}
                  {t.subtasks.map((s, si) => (
                    <div key={s.uid} className="mb-2 grid gap-2 md:grid-cols-[1fr_12rem_8rem_auto]">
                      <input value={s.title} onChange={(e) => update(t.uid, { subtasks: t.subtasks.map((x) => x.uid === s.uid ? { ...x, title: e.target.value } : x) })} className={inputCls} placeholder={`Subtask ${si + 1}`} />
                      <select value={s.assigneeId || t.assigneeId} onChange={(e) => update(t.uid, { subtasks: t.subtasks.map((x) => x.uid === s.uid ? { ...x, assigneeId: e.target.value } : x) })} className={inputCls}>
                        <option value="">Assign to…</option>
                        {employees.map((e) => <option key={e.employeeId} value={e.employeeId}>{e.name}</option>)}
                      </select>
                      <input type="date" value={s.dueDate} onChange={(e) => update(t.uid, { subtasks: t.subtasks.map((x) => x.uid === s.uid ? { ...x, dueDate: e.target.value } : x) })} className={inputCls} />
                      <button onClick={() => update(t.uid, { subtasks: t.subtasks.filter((x) => x.uid !== s.uid) })} className="text-slate-400 hover:text-red-600">✕</button>
                    </div>
                  ))}
                </div>

                <div className="mt-2 flex flex-wrap gap-2">
                  <select value={t.level} onChange={(e) => update(t.uid, { level: e.target.value })} className={inputCls}><option>senior dev</option><option>intern</option></select>
                  <input type="number" min={0} step={.5} value={t.estimate_hours} onChange={(e) => update(t.uid, { estimate_hours: e.target.value === '' ? '' : Number(e.target.value) })} className={`${inputCls} w-20`} />
                  <select value={t.priority} onChange={(e) => update(t.uid, { priority: e.target.value as any })} className={inputCls}>{TASK_PRIORITIES.map((p) => <option key={p}>{p}</option>)}</select>
                  <input type="date" min={today} value={t.dueDate} onChange={(e) => update(t.uid, { dueDate: e.target.value })} className={inputCls} />
                </div>
                {duplicates[t.uid] && <div className="mt-1 text-xs text-amber-700">⚠ {duplicates[t.uid]}</div>}
                {t.state === 'failed' && <div className="mt-1 text-xs text-red-600">Not pushed: {t.error}</div>}
              </div>
            ))}
          </div>
          <button onClick={add} className="mt-2 border border-dashed border-slate-300 px-3 py-1 text-xs text-slate-500">+ Add ticket</button>

          {questions.length > 0 && (
            <div className="mt-3 rounded-md bg-amber-50 p-2 text-xs text-amber-800">
              <div className="flex justify-between">
                <b>Ask the client first</b>
                <button onClick={() => { navigator.clipboard?.writeText(questionsEmail(askClient)); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
                  {copied ? 'Copied ✓' : 'Copy as email'}
                </button>
              </div>
              {questions.map((q) => <label key={q} className="mt-1 flex gap-1"><input type="checkbox" checked={!skipped[q]} onChange={() => setSkipped((s) => ({ ...s, [q]: !s[q] }))} />{q}</label>)}
            </div>
          )}

          <div className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-3">
            {meeting && <button onClick={saveMeetingDraft} disabled={savingDraft} className={inputCls}>{draftSaved ? 'Draft saved ✓' : savingDraft ? 'Saving…' : 'Save as draft'}</button>}
            <button onClick={() => pushList(pending)} disabled={pushing || pending.length === 0} className="ml-auto rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white">{pushing ? 'Pushing…' : `Push ${pending.length} to Taskmandu`}</button>
          </div>
          {pushError && <div className="mt-1 text-xs text-red-600">{pushError}</div>}
          {pushSummary && <div className="mt-1 text-xs text-slate-600">{pushSummary}</div>}
        </div>
      )}
    </div>
  );
}
