import { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';

type Result = 'Pass' | 'Fail';
type QAStatus = 'Awaiting QA' | 'Passed' | 'Failed';
type Subtask = { id: string; title: string; status: string; assignee: string | null; completed_at: string | null };
type ReviewEvent = {
  id: number;
  cycle: number;
  result: string;
  severity: string | null;
  notes: string | null;
  evidence_url: string | null;
  tester_name: string | null;
  created_at: string;
};
type TaskReview = {
  id: number;
  external_id: string;
  project_id: string | null;
  project_name: string | null;
  task_id: string;
  task_title: string;
  task_description: string | null;
  business: string | null;
  assignee: string | null;
  task_status: string;
  trigger_status: string;
  qa_status: QAStatus;
  cycle: number;
  triggered_at: string | null;
  tested_at: string | null;
  tester_name: string | null;
  last_result: Result | null;
  last_severity: string | null;
  last_notes: string | null;
  last_evidence_url: string | null;
  taskmandu_url: string | null;
  subtasks: Subtask[];
  events: ReviewEvent[];
};

type View = 'inbox' | 'history' | 'report';

const input = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500';
const button = 'rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50';
const dateText = (value?: string | null) => value
  ? new Date(value).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  : '—';

function statusClass(status: string): string {
  if (status === 'Passed') return 'bg-emerald-50 text-emerald-700 ring-emerald-200';
  if (status === 'Failed') return 'bg-rose-50 text-rose-700 ring-rose-200';
  if (status === 'Awaiting QA') return 'bg-amber-50 text-amber-800 ring-amber-200';
  return 'bg-slate-100 text-slate-700 ring-slate-200';
}

export default function TaskQAInbox() {
  const [reviews, setReviews] = useState<TaskReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [view, setView] = useState<View>('inbox');

  const [business, setBusiness] = useState('All');
  const [project, setProject] = useState('All');
  const [task, setTask] = useState('All');
  const [subtask, setSubtask] = useState('All');
  const [developer, setDeveloper] = useState('All');
  const [taskStatus, setTaskStatus] = useState('All');
  const [qaStatus, setQaStatus] = useState('Awaiting QA');
  const [period, setPeriod] = useState('All dates');
  const [search, setSearch] = useState('');

  const [editingId, setEditingId] = useState<number | null>(null);
  const [result, setResult] = useState<Result>('Pass');
  const [severity, setSeverity] = useState('Medium');
  const [notes, setNotes] = useState('');
  const [evidenceUrl, setEvidenceUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [reportTitle, setReportTitle] = useState('Task QA Verification Report');

  const load = useCallback(async (showSpinner = true) => {
    if (showSpinner) setLoading(true);
    setError('');
    try {
      const { data } = await axios.get('/pm/api/qa/task-inbox');
      setReviews(data.reviews ?? []);
      setLastSyncedAt(data.last_synced_at ?? null);
    } catch (e) {
      const message = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(message || 'Could not load the Task QA Inbox. Check the Taskmandu sync and try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const businesses = useMemo(() => Array.from(new Set(reviews.map((r) => r.business).filter((v): v is string => Boolean(v)))).sort(), [reviews]);
  const projects = useMemo(() => Array.from(new Set(reviews.map((r) => r.project_name).filter((v): v is string => Boolean(v)))).sort(), [reviews]);
  const tasks = useMemo(() => Array.from(new Set(reviews.map((r) => r.task_title).filter(Boolean))).sort(), [reviews]);
  const subtasks = useMemo(() => Array.from(new Set(reviews.flatMap((r) => r.subtasks.map((s) => s.title)))).sort(), [reviews]);
  const developers = useMemo(() => Array.from(new Set(reviews.map((r) => r.assignee).filter((v): v is string => Boolean(v)))).sort(), [reviews]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const now = Date.now();
    const periodDays = period === 'This week' ? 7 : period === 'This month' ? 30 : 0;
    return reviews.filter((r) => {
      if (business !== 'All' && r.business !== business) return false;
      if (project !== 'All' && r.project_name !== project) return false;
      if (task !== 'All' && r.task_title !== task) return false;
      if (subtask !== 'All' && !r.subtasks.some((s) => s.title === subtask)) return false;
      if (developer !== 'All' && r.assignee !== developer) return false;
      if (taskStatus !== 'All' && r.task_status !== taskStatus) return false;
      if (qaStatus !== 'All' && r.qa_status !== qaStatus) return false;
      if (periodDays > 0 && r.triggered_at && now - new Date(r.triggered_at).getTime() > periodDays * 86_400_000) return false;
      if (periodDays > 0 && !r.triggered_at) return false;
      if (q && ![
        r.task_title, r.task_description, r.business, r.project_name, r.assignee,
        r.task_status, r.qa_status, ...r.subtasks.map((s) => s.title),
      ].filter(Boolean).join(' ').toLowerCase().includes(q)) return false;
      return true;
    });
  }, [reviews, business, project, task, subtask, developer, taskStatus, qaStatus, period, search]);

  const awaiting = reviews.filter((r) => r.qa_status === 'Awaiting QA' && ['Completed', 'Review'].includes(r.task_status)).length;
  const failed = reviews.filter((r) => r.qa_status === 'Failed').length;
  const passed = reviews.filter((r) => r.qa_status === 'Passed').length;
  const resetFilters = () => {
    setBusiness('All'); setProject('All'); setTask('All'); setSubtask('All');
    setDeveloper('All'); setTaskStatus('All'); setQaStatus('Awaiting QA');
    setPeriod('All dates'); setSearch('');
  };

  const startReview = (review: TaskReview, nextResult: Result) => {
    setEditingId(review.id);
    setResult(nextResult);
    setSeverity(review.last_severity || 'Medium');
    setNotes(review.last_notes || '');
    setEvidenceUrl(review.last_evidence_url || '');
  };

  const saveReview = async (review: TaskReview) => {
    setSaving(true);
    setError('');
    try {
      await axios.patch('/pm/api/qa/task-inbox/' + review.id, {
        result,
        severity: result === 'Fail' ? severity : null,
        notes,
        evidence_url: evidenceUrl || null,
      });
      setEditingId(null);
      await load(false);
    } catch (e) {
      const message = (e as { response?: { data?: { message?: string; errors?: Record<string, string[]> } } })?.response?.data?.message;
      setError(message || 'Could not save the QA result.');
    } finally {
      setSaving(false);
    }
  };

  const runSync = async () => {
    setSyncing(true);
    setError('');
    try {
      await axios.post('/pm/api/sync');
      await load(false);
    } catch (e) {
      const message = (e as { response?: { data?: { error?: string; message?: string } } })?.response?.data?.error
        ?? (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(message || 'Taskmandu sync failed.');
    } finally {
      setSyncing(false);
    }
  };

  const reportPassed = filtered.filter((r) => r.qa_status === 'Passed').length;
  const reportFailed = filtered.filter((r) => r.qa_status === 'Failed').length;
  const reportAwaiting = filtered.filter((r) => r.qa_status === 'Awaiting QA').length;

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Completed task verification</h2>
            <p className="mt-1 max-w-3xl text-sm text-slate-500">
              Tasks enter this inbox automatically when Taskmandu changes their status to Completed or Review.
              QA Pass/Fail is recorded separately and never changes the Taskmandu Kanban status.
            </p>
            <p className="mt-2 text-xs text-slate-400">
              Taskmandu sync runs every five minutes. Last sync: {dateText(lastSyncedAt)}
            </p>
          </div>
          <button type="button" onClick={() => void runSync()} disabled={syncing} className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">
            <span>{syncing ? 'Syncing…' : 'Sync Taskmandu now'}</span>
          </button>
        </div>
        {error && <p role="alert" className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      </section>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4"><div className="text-xs font-medium text-amber-800">Awaiting QA</div><div className="mt-1 text-2xl font-semibold text-amber-900">{awaiting}</div></div>
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4"><div className="text-xs font-medium text-rose-700">Failed / fixing</div><div className="mt-1 text-2xl font-semibold text-rose-900">{failed}</div></div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4"><div className="text-xs font-medium text-emerald-700">QA passed</div><div className="mt-1 text-2xl font-semibold text-emerald-900">{passed}</div></div>
      </div>

      <div className="flex flex-wrap gap-2">
        {([
          ['inbox', 'Awaiting QA'],
          ['history', 'QA history'],
          ['report', 'Generate report'],
        ] as [View, string][]).map(([key, label]) => (
          <button key={key} type="button" onClick={() => { setView(key); setQaStatus(key === 'inbox' ? 'Awaiting QA' : 'All'); }} className={view === key ? 'rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white' : button}>{label}</button>
        ))}
      </div>

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold text-slate-900">{view === 'report' ? 'Report filters' : 'Filter tasks'}</h3>
          <button type="button" onClick={resetFilters} className="text-xs font-medium text-indigo-700 hover:text-indigo-900">Clear filters</button>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <input className={input} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search task, subtask, notes…" />
          <select className={input} value={business} onChange={(e) => setBusiness(e.target.value)}><option>All</option>{businesses.map((v) => <option key={v}>{v}</option>)}</select>
          <select className={input} value={project} onChange={(e) => setProject(e.target.value)}><option>All</option>{projects.map((v) => <option key={v}>{v}</option>)}</select>
          <select className={input} value={task} onChange={(e) => setTask(e.target.value)}><option>All</option>{tasks.map((v) => <option key={v}>{v}</option>)}</select>
          <select className={input} value={subtask} onChange={(e) => setSubtask(e.target.value)}><option>All subtasks</option>{subtasks.map((v) => <option key={v}>{v}</option>)}</select>
          <select className={input} value={developer} onChange={(e) => setDeveloper(e.target.value)}><option>All developers</option>{developers.map((v) => <option key={v}>{v}</option>)}</select>
          <select className={input} value={taskStatus} onChange={(e) => setTaskStatus(e.target.value)}><option>All Taskmandu statuses</option><option>Completed</option><option>Review</option>{Array.from(new Set(reviews.map((r) => r.task_status))).filter((v) => !['Completed', 'Review'].includes(v)).sort().map((v) => <option key={v}>{v}</option>)}</select>
          <select className={input} value={qaStatus} onChange={(e) => setQaStatus(e.target.value)}><option value="All">All QA results</option><option>Awaiting QA</option><option>Passed</option><option>Failed</option></select>
          <select className={input} value={period} onChange={(e) => setPeriod(e.target.value)}><option>All dates</option><option>This week</option><option>This month</option></select>
        </div>
      </section>

      {view !== 'report' ? (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
            <div>
              <h3 className="font-semibold text-slate-900">{view === 'inbox' ? 'Tasks ready for QA' : 'Task QA history'}</h3>
              <p className="text-xs text-slate-500">{filtered.length} matching task review record(s)</p>
            </div>
            <button type="button" onClick={() => void load()} className={button}>Refresh inbox</button>
          </div>
          {loading ? <p className="p-8 text-center text-sm text-slate-500">Loading QA inbox…</p> : filtered.length === 0 ? (
            <div className="p-8 text-center"><p className="font-medium text-slate-700">No matching task reviews</p><p className="mt-1 text-sm text-slate-500">Use Sync Taskmandu now to pull the latest Completed and Review tasks.</p></div>
          ) : (
            <div className="divide-y divide-slate-100">
              {filtered
                .filter((r) => view === 'history' || (r.qa_status === 'Awaiting QA' && ['Completed', 'Review'].includes(r.task_status)))
                .map((r) => (
                  <article key={r.id} className="p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="break-words font-semibold text-slate-900">{r.task_title}</h4>
                          <span className={'rounded-full px-2 py-0.5 text-xs font-medium ring-1 ' + statusClass(r.qa_status)}>{r.qa_status}</span>
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">Taskmandu: {r.task_status}</span>
                        </div>
                        <p className="mt-1 text-sm text-slate-500">{r.business || 'Business not mapped'} · {r.project_name || 'Standalone task'}</p>
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                          <span>Developer: {r.assignee || 'Unassigned'}</span>
                          <span>QA cycle: {r.cycle}</span>
                          <span>Queued: {dateText(r.triggered_at)}</span>
                          {r.tested_at && <span>Last tested: {dateText(r.tested_at)}{r.tester_name ? ' by ' + r.tester_name : ''}</span>}
                        </div>
                        {r.task_description && <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">{r.task_description}</p>}
                        <div className="mt-3 flex flex-wrap items-center gap-3">
                          {r.taskmandu_url ? <a className="text-sm font-medium text-indigo-700 hover:underline" href={r.taskmandu_url} target="_blank" rel="noreferrer">Open in Taskmandu ↗</a> : <span className="text-xs text-slate-400">Taskmandu link unavailable</span>}
                          {r.last_severity && <span className="text-xs text-slate-500">Last severity: {r.last_severity}</span>}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-2">
                        {r.qa_status === 'Awaiting QA' && (
                          <>
                            <button type="button" onClick={() => startReview(r, 'Pass')} className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700">Pass</button>
                            <button type="button" onClick={() => startReview(r, 'Fail')} className="rounded-lg bg-rose-600 px-3 py-2 text-sm font-medium text-white hover:bg-rose-700">Fail</button>
                          </>
                        )}
                        <button type="button" onClick={() => setEditingId(editingId === -r.id ? null : -r.id)} className={button}>History ({r.events.length})</button>
                      </div>
                    </div>

                    {r.subtasks.length > 0 && (
                      <details className="mt-3 rounded-lg border border-slate-100 bg-slate-50">
                        <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-slate-700">
                          Subtasks · {r.subtasks.filter((s) => s.status === 'Completed').length}/{r.subtasks.length} completed
                        </summary>
                        <ul className="divide-y divide-slate-100 px-3">
                          {r.subtasks.map((s) => (
                            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                              <span className="text-slate-700">{s.title}<span className="ml-2 text-xs text-slate-400">{s.assignee || ''}</span></span>
                              <span className={'rounded-full px-2 py-0.5 text-xs ' + (s.status === 'Completed' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800')}>{s.status}</span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}

                    {editingId === r.id && (
                      <div className="mt-4 space-y-3 rounded-xl border border-indigo-200 bg-indigo-50/40 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <h5 className="font-semibold text-slate-900">Record manual QA result</h5>
                          <button type="button" onClick={() => setEditingId(null)} className="text-sm text-slate-500">Close</button>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button type="button" onClick={() => setResult('Pass')} className={result === 'Pass' ? 'rounded-lg bg-emerald-600 px-3 py-2 text-sm text-white' : button}>Pass</button>
                          <button type="button" onClick={() => setResult('Fail')} className={result === 'Fail' ? 'rounded-lg bg-rose-600 px-3 py-2 text-sm text-white' : button}>Fail</button>
                          {result === 'Fail' && (
                            <select className={input + ' max-w-48'} value={severity} onChange={(e) => setSeverity(e.target.value)}>
                              {['Critical', 'High', 'Medium', 'Low', 'Enhancement'].map((v) => <option key={v}>{v}</option>)}
                            </select>
                          )}
                        </div>
                        <textarea className={input} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={result === 'Fail' ? 'What failed? Include actual vs expected behaviour…' : 'Optional verification notes…'} />
                        <input className={input} value={evidenceUrl} onChange={(e) => setEvidenceUrl(e.target.value)} placeholder="Evidence screenshot / recording URL (optional)" />
                        <div className="flex justify-end gap-2">
                          <button type="button" onClick={() => setEditingId(null)} className={button}>Cancel</button>
                          <button type="button" disabled={saving} onClick={() => void saveReview(r)} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">{saving ? 'Saving…' : 'Save QA result'}</button>
                        </div>
                      </div>
                    )}

                    {editingId === -r.id && (
                      <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                        {r.events.length === 0 ? <p className="text-sm text-slate-500">No QA history yet.</p> : (
                          <ol className="space-y-3">
                            {r.events.map((event) => (
                              <li key={event.id} className="border-l-2 border-slate-300 pl-3 text-sm">
                                <div className="flex flex-wrap justify-between gap-2"><strong>{event.result}</strong><span className="text-xs text-slate-500">{dateText(event.created_at)}</span></div>
                                <p className="text-xs text-slate-500">{event.tester_name || 'Automatic system'} · Cycle {event.cycle}{event.severity ? ' · ' + event.severity : ''}</p>
                                {event.notes && <p className="mt-1 whitespace-pre-wrap text-slate-700">{event.notes}</p>}
                                {event.evidence_url && <a className="mt-1 inline-block text-xs text-indigo-700 hover:underline" href={event.evidence_url} target="_blank" rel="noreferrer">Open evidence ↗</a>}
                              </li>
                            ))}
                          </ol>
                        )}
                      </div>
                    )}
                  </article>
                ))}
            </div>
          )}
        </section>
      ) : (
        <section className="qa-task-report rounded-xl border border-slate-200 bg-white p-5">
          <style>{'@media print { body * { visibility: hidden !important; } .qa-task-report, .qa-task-report * { visibility: visible !important; } .qa-task-report { position: absolute; inset: 0; width: 100%; border: 0 !important; box-shadow: none !important; } .qa-report-no-print { display: none !important; } }'}</style>
          <div className="qa-report-no-print mb-4 flex flex-wrap items-center justify-between gap-3">
            <input className={input + ' max-w-md'} value={reportTitle} onChange={(e) => setReportTitle(e.target.value)} aria-label="Report title" />
            <button type="button" onClick={() => window.print()} className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white">Print / Save as PDF</button>
          </div>
          <div className="border-b border-slate-200 pb-4">
            <h2 className="text-2xl font-bold text-slate-900">{reportTitle}</h2>
            <p className="mt-1 text-sm text-slate-500">Generated {new Date().toLocaleString()} · {filtered.length} task review record(s)</p>
            <p className="mt-1 text-sm text-slate-600">
              {business !== 'All' ? business : 'All businesses'} · {project !== 'All' ? project : 'All projects'} · Taskmandu status: {taskStatus}
            </p>
          </div>
          <div className="my-4 grid grid-cols-3 gap-3">
            <div className="rounded-lg bg-amber-50 p-3"><div className="text-xs text-amber-800">Awaiting QA</div><div className="text-2xl font-semibold text-amber-900">{reportAwaiting}</div></div>
            <div className="rounded-lg bg-emerald-50 p-3"><div className="text-xs text-emerald-800">Passed</div><div className="text-2xl font-semibold text-emerald-900">{reportPassed}</div></div>
            <div className="rounded-lg bg-rose-50 p-3"><div className="text-xs text-rose-800">Failed</div><div className="text-2xl font-semibold text-rose-900">{reportFailed}</div></div>
          </div>
          <h3 className="mb-2 font-semibold text-slate-900">Task verification details</h3>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead><tr className="border-b border-slate-300"><th className="p-2">Task / Project</th><th className="p-2">Business</th><th className="p-2">Developer</th><th className="p-2">Taskmandu</th><th className="p-2">QA result</th><th className="p-2">Last tested</th></tr></thead>
              <tbody>
                {filtered.map((r) => <tr key={r.id} className="border-b border-slate-200 align-top"><td className="p-2"><strong>{r.task_title}</strong><div className="text-xs text-slate-500">{r.project_name || 'Standalone'}</div><div className="text-xs text-slate-500">{r.subtasks.length} subtask(s)</div></td><td className="p-2">{r.business || '—'}</td><td className="p-2">{r.assignee || '—'}</td><td className="p-2">{r.task_status}</td><td className="p-2">{r.qa_status}{r.last_severity ? ' · '+r.last_severity : ''}</td><td className="p-2">{dateText(r.tested_at)}</td></tr>)}
              </tbody>
            </table>
          </div>
          {filtered.filter((r) => r.qa_status === 'Failed').length > 0 && (
            <div className="mt-5">
              <h3 className="mb-2 font-semibold text-slate-900">Failed findings</h3>
              {filtered.filter((r) => r.qa_status === 'Failed').map((r) => (
                <div key={r.id} className="mb-3 rounded-lg border border-rose-200 p-3">
                  <div className="font-medium">{r.task_title} · {r.last_severity || 'Medium'}</div>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{r.last_notes || 'No failure notes recorded.'}</p>
                  {r.last_evidence_url && <a href={r.last_evidence_url} className="text-sm text-indigo-700">{r.last_evidence_url}</a>}
                  {r.taskmandu_url && <p className="mt-1 text-xs text-slate-500">Taskmandu: {r.taskmandu_url}</p>}
                </div>
              ))}
            </div>
          )}
          <p className="mt-6 border-t border-slate-200 pt-3 text-xs text-slate-400">QA result is recorded separately from the live Taskmandu task status.</p>
        </section>
      )}
    </div>
  );
}
