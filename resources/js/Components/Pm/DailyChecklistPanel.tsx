import { useEffect, useMemo, useState } from 'react';
import type { PmPage } from '@/lib/pmNav';

type Item = { id: string; title: string; detail: string; destination: PmPage; action: string; section: string };

const ITEMS: Item[] = [
  { id: 'health', section: 'Start of day', title: 'Check Dashboard-2 and system health', detail: 'Confirm the dashboard opens and the latest Taskmandu sync is successful. If database authentication or ECIRCUITBREAKER appears, stop retrying Sync and investigate.', destination: 'today', action: 'Open Command Center' },
  { id: 'overview', section: 'Start of day', title: 'Review today’s tasks and deadlines', detail: 'Check overdue, due today, In Progress and tasks with no recent updates.', destination: 'tasks', action: 'Open All Tasks' },
  { id: 'blockers', section: 'Start of day', title: 'Check blockers and urgent changes', detail: 'Identify blocked work, urgent bugs and new requests from the boss.', destination: 'operations', action: 'Open Operations' },
  { id: 'qa', section: 'Quality assurance', title: 'Complete the QA Inbox review', detail: 'Open each awaiting task, verify the actual website/app, record Pass or Fail, and add clear notes or evidence. QA does not change Taskmandu status.', destination: 'qa', action: 'Open QA Center' },
  { id: 'workload', section: 'Team coordination', title: 'Review developer workload', detail: 'Check assignments across businesses, overloaded developers, interruptions and blockers.', destination: 'today', action: 'Open workload overview' },
  { id: 'minutes', section: 'Team coordination', title: 'Capture meeting decisions and follow-ups', detail: 'Record decisions, owners and actions so follow-ups become visible work.', destination: 'minutes', action: 'Open Meeting Minutes' },
  { id: 'priorities', section: 'Plan the day', title: 'Set no more than three company-wide priorities', detail: 'Give each priority an owner and expected delivery date/time.', destination: 'tasks', action: 'Open All Tasks' },
  { id: 'record', section: 'Plan the day', title: 'Record decisions and communicate changes', detail: 'Update the PM app and make sure the Senior Dev and relevant owners know the agreed priorities.', destination: 'reports', action: 'Open Reports' },
];

function localDateKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

export default function DailyChecklistPanel({ onNavigate }: { onNavigate: (page: PmPage) => void }) {
  const dateKey = useMemo(localDateKey, []);
  const storageKey = `pm-daily-checklist:${dateKey}`;
  const [checked, setChecked] = useState<Record<string, boolean>>(() => {
    if (typeof window === 'undefined') return {};
    try { return JSON.parse(window.localStorage.getItem(storageKey) || '{}'); } catch { return {}; }
  });
  const done = ITEMS.filter((item) => checked[item.id]).length;
  const total = ITEMS.length;
  const complete = done === total;
  const percent = Math.round((done / total) * 100);

  useEffect(() => {
    try { window.localStorage.setItem(storageKey, JSON.stringify(checked)); } catch { /* Storage may be disabled; checklist still works for this session. */ }
  }, [checked, storageKey]);

  const toggle = (id: string) => setChecked((current) => ({ ...current, [id]: !current[id] }));
  const reset = () => setChecked({});

  const sections = [...new Set(ITEMS.map((item) => item.section))];

  return (
    <div className="space-y-5">
      <header className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-indigo-600">Daily PM routine</p>
            <h2 className="mt-1 text-xl font-bold text-slate-900">Your everyday checklist</h2>
            <p className="mt-1 text-sm text-slate-500">Tick each item as you complete it. Your progress is saved in this browser and resets automatically each new day.</p>
          </div>
          <span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${complete ? 'bg-emerald-100 text-emerald-700' : done ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>
            {complete ? '✓ All checks complete · Healthy' : done ? 'In progress' : 'Not started'}
          </span>
        </div>
        <div className="mt-5 flex items-end justify-between gap-3">
          <div><div className="text-2xl font-bold tabular-nums text-slate-900">{done}<span className="text-base font-medium text-slate-400"> / {total}</span></div><div className="text-xs text-slate-500">completed today</div></div>
          <div className="text-sm font-semibold tabular-nums text-slate-700">{percent}%</div>
        </div>
        <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full transition-all ${complete ? 'bg-emerald-500' : 'bg-indigo-500'}`} style={{ width: `${percent}%` }} /></div>
        {complete && <p className="mt-3 text-sm font-medium text-emerald-700">Everything on your daily routine is checked off. Keep an eye on any new urgent requests during the day.</p>}
      </header>

      {sections.map((section) => (
        <section key={section} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-100 px-4 py-3"><h3 className="text-sm font-semibold text-slate-800">{section}</h3></div>
          <div className="divide-y divide-slate-100">
            {ITEMS.filter((item) => item.section === section).map((item) => (
              <div key={item.id} className={`flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center ${checked[item.id] ? 'bg-emerald-50/40' : ''}`}>
                <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3">
                  <input type="checkbox" checked={!!checked[item.id]} onChange={() => toggle(item.id)} className="mt-1 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" />
                  <span className="min-w-0">
                    <span className={`block text-sm font-semibold ${checked[item.id] ? 'text-slate-500 line-through' : 'text-slate-900'}`}>{item.title}</span>
                    <span className="mt-1 block text-sm text-slate-500">{item.detail}</span>
                  </span>
                </label>
                <button type="button" onClick={() => onNavigate(item.destination)} className="ml-7 shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:border-indigo-300 hover:bg-indigo-50 sm:ml-0">{item.action} →</button>
              </div>
            ))}
          </div>
        </section>
      ))}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-xs text-slate-500">Checklist date: {new Date(dateKey + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'short', day: 'numeric' })}. Your ticks are stored on this device/browser.</p>
        <button type="button" onClick={reset} disabled={!done} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">Reset today’s checks</button>
      </div>
    </div>
  );
}
