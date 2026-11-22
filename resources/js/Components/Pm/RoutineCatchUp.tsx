import axios from 'axios';
import { useEffect, useRef, useState } from 'react';

type DayRecord = {
  day: string | null;
  exists: boolean;
  ticks: Record<string, boolean>;
  priorities: string[];
  fresh: boolean;
  skipped: boolean;
  missed: string[];
  complete: boolean;
};

const LABELS: Record<string, string> = {
  sync: 'Check live data', decide: 'Decide requests and ideas', late: 'Chase overdue and blocked tasks',
  owners: 'Check task owners', qa: 'Review QA', meetings: 'Follow up meetings',
  capacity: 'Check team capacity', priorities: 'Set top priorities',
  mid_requests: 'Review new requests', mid_blocked: 'Check blocked work', mid_qa: 'Check QA progress',
  eod_statuses: 'Review task statuses', eod_standup: 'Send end-of-day update', eod_report: 'Open daily report',
  eod_waiting: 'Review waiting items', eod_tomorrow: 'Set tomorrow priorities',
  fri_ideas: 'Review ideas', fri_balance: 'Review workload balance', fri_health: 'Review project health',
};

function dayLabel(day: string | null): string {
  if (!day) return 'Today';
  const date = new Date(day + 'T12:00:00');
  return date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

export default function RoutineCatchUp({
  ticks, priorities, onRestore,
}: {
  ticks: Record<string, boolean>;
  priorities: string[];
  onRestore: (ticks: Record<string, boolean>, priorities: string[]) => void;
}) {
  const [history, setHistory] = useState<DayRecord[]>([]);
  const [today, setToday] = useState<DayRecord | null>(null);
  const [streak, setStreak] = useState(0);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [catching, setCatching] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstSave = useRef(true);

  useEffect(() => {
    let active = true;
    axios.get('/pm/api/routine').then(({ data }) => {
      if (!active) return;
      const current = data.day as DayRecord;
      setToday(current);
      setHistory(data.history ?? []);
      setStreak(data.streak ?? 0);
      if (current.exists) onRestore(current.ticks ?? {}, current.priorities ?? []);
      setReady(true);
    }).catch(() => {
      if (active) { setError('Routine sync unavailable. Your checklist remains usable in this browser.'); setReady(true); }
    });
    return () => { active = false; if (timer.current) clearTimeout(timer.current); };
  }, []);

  useEffect(() => {
    if (!ready || !today || today.skipped) return;
    if (firstSave.current) { firstSave.current = false; return; }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setSaving(true);
      try {
        const { data } = await axios.put('/pm/api/routine', { ticks, priorities });
        setToday(data.day);
        setError('');
      } catch {
        setError('Could not save routine progress. It will retry when you make another change.');
      } finally { setSaving(false); }
    }, 700);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [ticks, priorities, ready]);

  const markDayOff = async () => {
    try {
      const { data } = await axios.put('/pm/api/routine', { skipped: true });
      setToday(data.day); setError('');
    } catch { setError('Could not mark this day off.'); }
  };

  const catchUp = async (record: DayRecord) => {
    if (!record.day) return;
    setCatching(record.day);
    try {
      const ticksToSave = Object.fromEntries(record.missed.map((id) => [id, true]));
      await axios.post('/pm/api/routine/' + record.day + '/catch-up', { ticks: ticksToSave });
      setHistory((items) => items.map((item) => item.day === record.day ? { ...item, missed: [], complete: true } : item));
      setStreak((value) => value + 1);
      setError('');
    } catch { setError('Could not save catch-up for that day.'); }
    finally { setCatching(null); }
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-indigo-600">Routine history</p>
          <h3 className="mt-1 text-lg font-bold text-slate-900">Keep your daily routine on track</h3>
          <p className="mt-1 text-sm text-slate-500">Progress syncs to your account, so it follows you across devices.</p>
        </div>
        <div className="rounded-xl bg-indigo-50 px-3 py-2 text-center">
          <div className="text-xl font-bold text-indigo-700">{streak}</div>
          <div className="text-[11px] font-medium text-indigo-700">day streak</div>
        </div>
      </div>

      {error && <p role="status" className="mt-3 rounded-lg bg-amber-50 p-2.5 text-xs text-amber-800">{error}</p>}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-slate-500">{saving ? 'Saving…' : ready ? 'Synced' : 'Loading…'}</span>
        {today && !today.skipped && <button type="button" onClick={markDayOff} className="ml-auto rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">Mark today as day off</button>}
        {today?.skipped && <span className="ml-auto rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600">Today marked as day off</span>}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-5">
        {history.map((record) => (
          <div key={record.day} className="rounded-xl border border-slate-200 p-3">
            <div className="text-xs font-semibold text-slate-700">{dayLabel(record.day)}</div>
            {record.skipped ? <p className="mt-1 text-xs text-slate-500">Day off</p> : record.complete ? <p className="mt-1 text-xs font-semibold text-emerald-700">Completed</p> : (
              <>
                <p className="mt-1 text-xs text-slate-500">{record.missed.length} steps missed</p>
                <button type="button" disabled={catching === record.day || record.missed.length === 0} onClick={() => void catchUp(record)} className="mt-2 rounded-md bg-indigo-600 px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
                  {catching === record.day ? 'Saving…' : 'Mark caught up'}
                </button>
              </>
            )}
          </div>
        ))}
        {history.length === 0 && <p className="text-xs text-slate-500 sm:col-span-5">Your previous routine days will appear here.</p>}
      </div>
    </section>
  );
}
