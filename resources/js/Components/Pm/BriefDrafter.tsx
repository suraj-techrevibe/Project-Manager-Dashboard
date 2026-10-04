import { useEffect, useMemo, useState } from 'react';
import { pmApi } from '../../lib/pmApi';
import {
  BRIEF_MAX_CHARS,
  MAX_TICKETS,
  autoAssign,
  blankTicket,
  findExisting,
  keywordQuestions,
  questionsEmail,
  sameTitle,
  splitBrief,
  type EditableTicket,
} from '../../lib/briefHeuristics';
import { TASK_PRIORITIES } from '../../types/pm';
import type { BriefContext, Project, PushTicket } from '../../types/pm';

const inputCls = 'rounded-md border border-slate-200 px-2 py-1.5 text-sm focus:border-slate-400 focus:outline-none';

/** Pulls the most useful message out of a failed request. */
function errorText(e: any, fallback: string): string {
  const d = e?.response?.data;
  if (d?.error) return d.error;
  if (d?.errors) {
    const first = Object.values(d.errors)[0] as string[] | undefined;
    if (first?.[0]) return first[0];
  }
  if (d?.message && e?.response?.status !== 500) return d.message;
  return fallback;
}

export default function BriefDrafter() {
  const [brief, setBrief] = useState('');
  const [tickets, setTickets] = useState<EditableTicket[]>([]);
  const [aiQuestions, setAiQuestions] = useState<string[]>([]);
  const [skipped, setSkipped] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState(false);

  const [loading, setLoading] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [ctx, setCtx] = useState<BriefContext | null>(null);
  const [ctxError, setCtxError] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState('');

  const [pushing, setPushing] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);
  const [pushSummary, setPushSummary] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);

  function loadContext() {
    pmApi
      .briefContext()
      .then(({ data }) => {
        setCtx(data);
        setCtxError(null);
      })
      .catch((e) => setCtxError(errorText(e, "Couldn't load employees — Taskmandu may be unreachable.")));
  }

  useEffect(() => {
    loadContext();
    pmApi
      .projects()
      .then(({ data }) => setProjects(data.projects))
      .catch(() => {});
  }, []);

  const employees = ctx?.employees ?? [];
  const pending = tickets.filter((t) => t.state !== 'pushed');
  const pushedCount = tickets.length - pending.length;

  // Tickets this batch has already given each person, so the dropdown shows the real picture.
  const batchLoad = useMemo(() => {
    const m: Record<string, { n: number; h: number }> = {};
    pending.forEach((t) => {
      if (!t.assigneeId) return;
      const cur = m[t.assigneeId] ?? { n: 0, h: 0 };
      m[t.assigneeId] = { n: cur.n + 1, h: cur.h + (Number(t.estimate_hours) || 0) };
    });
    return m;
  }, [pending]);

  const employeeLabel = (e: (typeof employees)[number]) => {
    const b = batchLoad[e.employeeId];
    return `${e.name}${e.designation ? ` (${e.designation})` : ''} — ${e.open ?? 0} open${
      e.week_hours ? ` · ${e.week_hours}h this week` : ''
    }${b ? ` (+${b.n} here${b.h ? `, ${b.h}h` : ''})` : ''}`;
  };

  // Warn when this batch pushes someone past their weekly capacity.
  const overCapacity = useMemo(() => {
    const out: Record<string, string> = {};
    pending.forEach((t) => {
      const e = employees.find((x) => x.employeeId === t.assigneeId);
      const b = e ? batchLoad[e.employeeId] : undefined;
      if (!e || !b) return;
      const cap = e.capacity ?? 40;
      const total = Math.round(((e.week_hours ?? 0) + b.h) * 10) / 10;
      if (total > cap) {
        out[t.uid] = `${e.name} would be at ${total}h of ${cap}h this week with this batch — consider someone lighter.`;
      }
    });
    return out;
  }, [pending, employees, batchLoad]);

  // Duplicate warnings: against existing cards, and against other tickets in this batch.
  const duplicates = useMemo(() => {
    const out: Record<string, string> = {};
    tickets.forEach((t, i) => {
      if (t.state === 'pushed' || !t.title.trim()) return;
      const existing = findExisting(t.title, ctx?.titles ?? []);
      if (existing) {
        out[t.uid] = `A similar task already exists${existing.project_name ? ` in ${existing.project_name}` : ''}: “${existing.title}”`;
        return;
      }
      const j = tickets.findIndex((o, k) => k < i && o.state !== 'pushed' && sameTitle(o.title, t.title));
      if (j >= 0) out[t.uid] = `Same as ticket #${j + 1} in this batch`;
    });
    return out;
  }, [tickets, ctx]);

  const questions = useMemo(() => {
    const text = `${brief}\n${tickets.map((t) => `${t.title} ${t.description}`).join('\n')}`;
    return Array.from(new Set([...aiQuestions, ...keywordQuestions(text)]));
  }, [brief, tickets, aiQuestions]);

  const askClient = questions.filter((q) => !skipped[q]);

  /* ---------------- drafting ---------------- */

  function checkBrief(): string | null {
    const text = brief.trim();
    if (!text) return 'Paste a brief first';
    if (text.length > BRIEF_MAX_CHARS) {
      return `The brief is ${text.length.toLocaleString()} characters — the limit is ${BRIEF_MAX_CHARS.toLocaleString()}. Trim it or split it into two briefs.`;
    }
    return null;
  }

  // New drafts replace unpushed tickets but never the ones already in Taskmandu.
  function loadDrafts(fresh: EditableTicket[]) {
    setTickets((prev) => [...prev.filter((t) => t.state === 'pushed'), ...fresh].slice(0, MAX_TICKETS));
    setAttempted(false);
    setPushError(null);
    setPushSummary(null);
  }

  async function draft() {
    const problem = checkBrief();
    if (problem) return setDraftError(problem);

    setDraftError(null);
    setNotice(null);
    setLoading(true);
    try {
      const { data } = await pmApi.draftBrief(brief.trim());
      loadDrafts(
        data.tickets.map((t) =>
          blankTicket({
            title: t.title,
            description: t.description ?? '',
            level: t.level === 'senior dev' ? 'senior dev' : 'intern',
            estimate_hours: Number.isFinite(Number(t.estimate_hours)) ? Number(t.estimate_hours) : 2,
          })
        )
      );
      setAiQuestions(data.questions ?? []);
      if (!data.tickets.length) setDraftError('The AI returned no tickets — add more detail to the brief and try again.');
      else if (data.truncated) setNotice(`The AI drafted ${data.truncated} more than the ${MAX_TICKETS}-ticket limit; the extras were dropped.`);
    } catch (e) {
      setDraftError(errorText(e, "Couldn't draft tickets. Check your connection and try again."));
    } finally {
      setLoading(false);
    }
  }

  function splitLocally() {
    if (!brief.trim()) return setDraftError('Paste a brief first');
    const { tickets: fresh, dropped } = splitBrief(brief);
    if (!fresh.length) return setDraftError('Nothing to split — put one task per line (bullets or numbers work best).');

    setDraftError(null);
    setAiQuestions([]);
    loadDrafts(fresh);
    setNotice(
      `Split without AI: level and hours are guesses from keywords, so review them.${
        dropped ? ` ${dropped} extra line(s) beyond ${MAX_TICKETS} were dropped.` : ''
      }`
    );
  }

  /* ---------------- editing ---------------- */

  const update = (uid: string, patch: Partial<EditableTicket>) =>
    setTickets((prev) => prev.map((t) => (t.uid === uid ? { ...t, ...patch, state: t.state === 'failed' ? 'draft' : t.state } : t)));

  const remove = (uid: string) => setTickets((prev) => prev.filter((t) => t.uid !== uid));

  const add = () => setTickets((prev) => (prev.length >= MAX_TICKETS ? prev : [...prev, blankTicket()]));

  const assignAll = (assigneeId: string) => {
    if (assigneeId) setTickets((prev) => prev.map((t) => (t.state === 'pushed' ? t : { ...t, assigneeId })));
  };

  const dueAll = (dueDate: string) => setTickets((prev) => prev.map((t) => (t.state === 'pushed' ? t : { ...t, dueDate })));

  function runAutoAssign() {
    const picks = autoAssign(tickets, employees);
    setTickets((prev) => prev.map((t) => (picks[t.uid] ? { ...t, assigneeId: picks[t.uid] } : t)));
  }

  /* ---------------- pushing ---------------- */

  async function pushList(list: EditableTicket[]) {
    setAttempted(true);
    setPushSummary(null);

    if (list.some((t) => !t.title.trim())) return setPushError('Every ticket needs a title.');
    const missing = list.filter((t) => !t.assigneeId).length;
    if (missing) {
      return setPushError(`${missing} ticket${missing === 1 ? ' has' : 's have'} no assignee — Taskmandu requires one per task.`);
    }

    const payload: PushTicket[] = list.map((t) => ({
      title: t.title.trim(),
      description: t.description.trim(),
      level: t.level,
      estimate_hours: t.estimate_hours === '' ? null : Number(t.estimate_hours),
      priority: t.priority,
      assignee_employee_id: t.assigneeId,
      due_date: t.dueDate || null,
    }));

    setPushError(null);
    setPushing(true);
    try {
      const { data } = await pmApi.pushTickets(payload, projectId || undefined);
      const byUid = new Map(data.results.map((r) => [list[r.index].uid, r]));

      setTickets((prev) =>
        prev.map((t) => {
          const r = byUid.get(t.uid);
          if (!r) return t;
          return r.ok ? { ...t, state: 'pushed', error: undefined } : { ...t, state: 'failed', error: r.error ?? 'Failed' };
        })
      );

      const fellBack = data.results.some((r) => r.ok && r.fields_fallback);
      setPushSummary(
        `${data.created} pushed${data.failed ? `, ${data.failed} failed — fix them or press Retry on each` : ''}.${
          fellBack ? ' Taskmandu wouldn’t accept priority/hours/tags on create, so those went into the description.' : ''
        }`
      );
      loadContext(); // refresh workload counts + duplicate list
    } catch (e: any) {
      setPushError(
        e?.response
          ? errorText(e, "Couldn't push to Taskmandu")
          : "Lost the connection mid-push. Some tickets may already exist in Taskmandu — check there before retrying so nothing is created twice."
      );
    } finally {
      setPushing(false);
    }
  }

  async function copyQuestions() {
    const text = questionsEmail(askClient);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  const over = brief.length > BRIEF_MAX_CHARS;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <textarea
        value={brief}
        onChange={(e) => {
          setBrief(e.target.value);
          setDraftError(null);
        }}
        placeholder="Paste a raw client brief here — or one task per line for the no-AI splitter..."
        className="min-h-[110px] w-full resize-y rounded-md border border-slate-200 p-2 text-sm"
      />
      <div className="mt-1 flex items-center justify-between text-xs">
        <span className={over ? 'font-medium text-red-600' : 'text-slate-400'}>
          {brief.length.toLocaleString()} / {BRIEF_MAX_CHARS.toLocaleString()} characters
        </span>
        {draftError && <span className="text-red-600">{draftError}</span>}
      </div>

      <div className="mt-2 flex flex-wrap justify-end gap-2">
        <button
          onClick={splitLocally}
          disabled={loading}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          title="Turns bullets, numbered lines and plain lines into tickets. No AI, no API key."
        >
          Split without AI
        </button>
        <button
          onClick={draft}
          disabled={loading || over}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
        >
          {loading ? 'Drafting…' : 'Draft with AI'}
        </button>
      </div>

      {notice && <div className="mt-2 rounded-md bg-slate-50 p-2 text-xs text-slate-600">{notice}</div>}
      {ctxError && <div className="mt-2 rounded-md bg-amber-50 p-2 text-xs text-amber-700">{ctxError}</div>}

      {tickets.length > 0 && (
        <div className="mt-3 border-t border-slate-100 pt-3">
          {/* Bulk shortcuts */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <select value="" onChange={(e) => assignAll(e.target.value)} className={inputCls}>
              <option value="">Assign all to…</option>
              {employees.map((e) => (
                <option key={e.employeeId} value={e.employeeId}>
                  {employeeLabel(e)}
                </option>
              ))}
            </select>
            <input
              type="date"
              min={today}
              onChange={(e) => dueAll(e.target.value)}
              className={inputCls}
              title="Set the due date on every unpushed ticket"
            />
            <button
              onClick={runAutoAssign}
              disabled={!employees.length}
              className="rounded-md border border-slate-300 px-2.5 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              title="Senior-dev tickets go to senior designations, interns to junior ones — always the person with the fewest hours due this week in that group."
            >
              Auto-assign to least busy
            </button>
            <span className="ml-auto text-xs text-slate-400">
              {tickets.length} / {MAX_TICKETS} tickets
            </span>
          </div>

          <div className="flex flex-col gap-2">
            {tickets.map((t, i) =>
              t.state === 'pushed' ? (
                <div key={t.uid} className="flex items-center gap-2 rounded-md bg-green-50 px-2.5 py-1.5 text-sm text-green-800">
                  <span>✓</span>
                  <span className="truncate">{t.title}</span>
                  <span className="ml-auto whitespace-nowrap text-xs text-green-600">in Taskmandu</span>
                </div>
              ) : (
                <div
                  key={t.uid}
                  className={`rounded-md border p-2 ${
                    t.state === 'failed' ? 'border-red-300 bg-red-50/50' : 'border-slate-200 bg-slate-50'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-400">#{i + 1}</span>
                    <input
                      value={t.title}
                      onChange={(e) => update(t.uid, { title: e.target.value })}
                      maxLength={200}
                      placeholder="Ticket title"
                      className={`${inputCls} min-w-0 flex-1`}
                    />
                    <button
                      onClick={() => remove(t.uid)}
                      className="rounded px-1.5 text-slate-400 hover:bg-white hover:text-red-600"
                      title="Remove this ticket"
                    >
                      ✕
                    </button>
                  </div>

                  <textarea
                    value={t.description}
                    onChange={(e) => update(t.uid, { description: e.target.value })}
                    maxLength={3000}
                    rows={2}
                    placeholder="Description"
                    className={`${inputCls} mt-1.5 w-full resize-y text-xs`}
                  />

                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <select value={t.level} onChange={(e) => update(t.uid, { level: e.target.value })} className={`${inputCls} text-xs`}>
                      <option value="senior dev">senior dev</option>
                      <option value="intern">intern</option>
                    </select>
                    <label className="flex items-center gap-1 text-xs text-slate-500">
                      <input
                        type="number"
                        min={0}
                        max={1000}
                        step={0.5}
                        value={t.estimate_hours}
                        onChange={(e) => update(t.uid, { estimate_hours: e.target.value === '' ? '' : Number(e.target.value) })}
                        className={`${inputCls} w-16 text-xs`}
                      />
                      h
                    </label>
                    <select
                      value={t.priority}
                      onChange={(e) => update(t.uid, { priority: e.target.value as EditableTicket['priority'] })}
                      className={`${inputCls} text-xs`}
                    >
                      {TASK_PRIORITIES.map((p) => (
                        <option key={p}>{p}</option>
                      ))}
                    </select>
                    <select
                      value={t.assigneeId}
                      onChange={(e) => update(t.uid, { assigneeId: e.target.value })}
                      className={`${inputCls} min-w-[11rem] text-xs ${attempted && !t.assigneeId ? 'border-red-400 bg-red-50' : ''}`}
                    >
                      <option value="">Assign to…</option>
                      {employees.map((e) => (
                        <option key={e.employeeId} value={e.employeeId}>
                          {employeeLabel(e)}
                        </option>
                      ))}
                    </select>
                    <input
                      type="date"
                      min={today}
                      value={t.dueDate}
                      onChange={(e) => update(t.uid, { dueDate: e.target.value })}
                      className={`${inputCls} text-xs`}
                      title="Due date (defaults to +1 week if left blank)"
                    />
                  </div>

                  {duplicates[t.uid] && <div className="mt-1.5 text-xs text-amber-700">⚠ {duplicates[t.uid]}</div>}
                  {overCapacity[t.uid] && <div className="mt-1.5 text-xs text-red-600">⚠ {overCapacity[t.uid]}</div>}
                  {t.state === 'failed' && (
                    <div className="mt-1.5 flex items-center gap-2 text-xs text-red-600">
                      <span className="min-w-0 flex-1">Not pushed: {t.error}</span>
                      <button
                        onClick={() => pushList([t])}
                        disabled={pushing}
                        className="rounded-md border border-red-300 bg-white px-2 py-0.5 font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                      >
                        Retry
                      </button>
                    </div>
                  )}
                </div>
              )
            )}
          </div>

          <button
            onClick={add}
            disabled={tickets.length >= MAX_TICKETS}
            className="mt-2 rounded-md border border-dashed border-slate-300 px-3 py-1 text-xs text-slate-500 hover:bg-slate-50 disabled:opacity-50"
          >
            + Add ticket
          </button>

          {/* Client questions */}
          {questions.length > 0 && (
            <div className="mt-3 rounded-md bg-amber-50 p-2.5 text-xs text-amber-800">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="font-medium">Ask the client first</span>
                <button
                  onClick={copyQuestions}
                  disabled={!askClient.length}
                  className="rounded-md bg-white px-2 py-1 font-medium text-amber-800 shadow-sm hover:bg-amber-100 disabled:opacity-50"
                >
                  {copied ? 'Copied ✓' : 'Copy as email'}
                </button>
              </div>
              <ul className="flex flex-col gap-1">
                {questions.map((q) => (
                  <li key={q}>
                    <label className="flex cursor-pointer items-start gap-1.5">
                      <input
                        type="checkbox"
                        checked={!skipped[q]}
                        onChange={() => setSkipped((s) => ({ ...s, [q]: !s[q] }))}
                        className="mt-0.5"
                      />
                      <span>{q}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Push */}
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className={inputCls} title="Where the tasks should land">
              <option value="">Standalone tasks (no project)</option>
              {projects.map((p) => (
                <option key={p._id} value={p._id}>
                  Project board: {p.name}
                </option>
              ))}
            </select>
            <button
              onClick={() => pushList(pending)}
              disabled={pushing || pending.length === 0}
              className="ml-auto rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
            >
              {pushing
                ? 'Pushing…'
                : pending.length === 0
                  ? 'All pushed ✓'
                  : pushedCount
                    ? `Push ${pending.length} remaining`
                    : `Push ${pending.length} to Taskmandu`}
            </button>
          </div>
          {pushError && <div className="mt-1.5 text-xs text-red-600">{pushError}</div>}
          {pushSummary && <div className="mt-1.5 text-xs text-slate-600">{pushSummary}</div>}
          <p className="mt-1.5 text-xs text-slate-400">
            {projectId
              ? 'Tasks go onto that project’s board and show up in the Projects tab.'
              : 'Standalone tasks don’t appear in the Projects tab — pick a project above to put them on its board.'}
          </p>
        </div>
      )}
    </div>
  );
}
