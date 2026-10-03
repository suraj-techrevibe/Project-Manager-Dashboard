import { useEffect, useState } from 'react';
import { pmApi } from '../../lib/pmApi';
import type { DraftTicket, Employee } from '../../types/pm';

const levelClasses: Record<string, string> = {
  'senior dev': 'bg-blue-50 text-blue-700',
  intern: 'bg-green-50 text-green-700',
};

export default function BriefDrafter() {
  const [brief, setBrief] = useState('');
  const [tickets, setTickets] = useState<DraftTicket[] | null>(null);
  const [questions, setQuestions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [pushed, setPushed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pushError, setPushError] = useState<string | null>(null);
  const [pushing, setPushing] = useState(false);

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [assigneeId, setAssigneeId] = useState('');
  const [dueDate, setDueDate] = useState('');

  useEffect(() => {
    pmApi.employees().then(({ data }) => {
      setEmployees(data.employees);
      if (data.employees[0]) setAssigneeId(data.employees[0].employeeId);
    });
  }, []);

  async function draft() {
    if (!brief.trim()) {
      setError('Paste a brief first');
      return;
    }
    setError(null);
    setLoading(true);
    setPushed(false);
    setPushError(null);
    try {
      const { data } = await pmApi.draftBrief(brief);
      setTickets(data.tickets);
      setQuestions(data.questions);
    } finally {
      setLoading(false);
    }
  }

  async function push() {
    if (!tickets?.length) return;
    if (!assigneeId) {
      setPushError('Pick an assignee first — Taskmandu requires one per task');
      return;
    }
    setPushing(true);
    setPushError(null);
    try {
      await pmApi.pushTickets(tickets, assigneeId, dueDate || undefined);
      setPushed(true);
    } catch (e: any) {
      setPushError(e?.response?.data?.error ?? "Couldn't push to Taskmandu");
    } finally {
      setPushing(false);
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <textarea
        value={brief}
        onChange={(e) => {
          setBrief(e.target.value);
          setError(null);
        }}
        placeholder="Paste a raw client brief here..."
        className="min-h-[90px] w-full resize-y rounded-md border border-slate-200 p-2 text-sm"
      />
      {error && <div className="mt-1 text-xs text-red-600">{error}</div>}

      <div className="mt-2 flex justify-end">
        <button
          onClick={draft}
          disabled={loading}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
        >
          {loading ? 'Drafting…' : 'Draft tickets'}
        </button>
      </div>

      {tickets && (
        <div className="mt-3 border-t border-slate-100 pt-3">
          <div className="flex flex-col gap-1.5">
            {tickets.map((t, i) => (
              <div key={i} className="rounded-md bg-slate-50 p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-slate-900">{t.title}</span>
                  <span className="flex items-center gap-2 whitespace-nowrap">
                    <span className="text-xs text-slate-500">{t.estimate_hours}h</span>
                    <span className={`rounded px-2 py-0.5 text-xs ${levelClasses[t.level] ?? 'bg-slate-100 text-slate-600'}`}>
                      {t.level}
                    </span>
                  </span>
                </div>
                {t.description && <p className="mt-1 text-xs text-slate-500">{t.description}</p>}
              </div>
            ))}
          </div>

          {questions.length > 0 && (
            <div className="mt-2 rounded-md bg-amber-50 p-2 text-xs text-amber-700">
              <span className="font-medium">Ask the client first: </span>
              {questions.join(' · ')}
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
            <select
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
              className="rounded-md border border-slate-200 px-2 py-1.5 text-sm"
            >
              <option value="">Assign all to…</option>
              {employees.map((e) => (
                <option key={e.employeeId} value={e.employeeId}>
                  {e.name}
                  {e.designation ? ` — ${e.designation}` : ''}
                </option>
              ))}
            </select>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="rounded-md border border-slate-200 px-2 py-1.5 text-sm"
              title="Due date (defaults to +1 week if left blank)"
            />
            <button
              onClick={push}
              disabled={pushed || pushing}
              className="ml-auto rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {pushing ? 'Pushing…' : pushed ? 'Pushed to Taskmandu ✓' : `Push ${tickets.length} to Taskmandu`}
            </button>
          </div>
          {pushError && <div className="mt-1.5 text-xs text-red-600">{pushError}</div>}
          <p className="mt-1.5 text-xs text-slate-400">
            All tickets in this batch go to the same assignee — draft separately per person if they differ.
          </p>
        </div>
      )}
    </div>
  );
}
