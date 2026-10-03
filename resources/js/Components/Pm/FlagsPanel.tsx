import { useState } from 'react';
import { pmApi } from '../../lib/pmApi';
import type { PmFlag, PmMetrics } from '../../types/pm';

const severityClasses: Record<string, string> = {
  danger: 'border-red-300 bg-red-50 text-red-700',
  warning: 'border-amber-300 bg-amber-50 text-amber-700',
  neutral: 'border-slate-200 bg-slate-50 text-slate-600',
};

const metricLabels: { key: keyof PmMetrics; label: string; color: string }[] = [
  { key: 'overdue', label: 'Overdue', color: 'text-red-600' },
  { key: 'stuck', label: 'Stuck 3+ days', color: 'text-amber-600' },
  { key: 'blocked', label: 'Blocked', color: 'text-slate-900' },
  { key: 'unverified', label: 'Unverified done', color: 'text-slate-900' },
];

export default function FlagsPanel({
  flags: initialFlags,
  metrics,
}: {
  flags: PmFlag[];
  metrics: PmMetrics;
}) {
  const [flags, setFlags] = useState(initialFlags);
  const [nudges, setNudges] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);

  async function nudge(cardId: number) {
    setBusy(cardId);
    try {
      const { data } = await pmApi.nudge(cardId);
      setNudges((n) => ({ ...n, [cardId]: data.message }));
    } finally {
      setBusy(null);
    }
  }

  async function snooze(cardId: number) {
    await pmApi.snooze(cardId);
    setFlags((f) => f.filter((x) => x.card_id !== cardId));
  }

  async function verify(cardId: number) {
    await pmApi.verify(cardId);
    setFlags((f) => f.filter((x) => x.card_id !== cardId));
  }

  return (
    <div>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {metricLabels.map((m) => (
          <div key={m.key} className="rounded-lg bg-slate-50 p-3">
            <div className="mb-1 text-xs text-slate-500">{m.label}</div>
            <div className={`text-2xl font-medium ${m.color}`}>{metrics[m.key]}</div>
          </div>
        ))}
      </div>

      {flags.length === 0 ? (
        <p className="text-sm text-slate-500">No flags. Board looks healthy.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {flags.map((f) => (
            <div key={f.card_id} className={`rounded-lg border p-3 ${severityClasses[f.severity]}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-slate-900">
                    {f.url ? (
                      <a href={f.url} target="_blank" rel="noreferrer" className="hover:underline">
                        {f.title}
                      </a>
                    ) : (
                      f.title
                    )}
                  </div>
                  <div className="mt-0.5 text-xs">
                    {f.detail}
                    {f.assignee ? ` · ${f.assignee}` : ''}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  {f.type === 'unverified' ? (
                    <button
                      onClick={() => verify(f.card_id)}
                      className="rounded-md bg-white px-2 py-1 text-xs font-medium shadow-sm hover:bg-slate-50"
                    >
                      Mark verified
                    </button>
                  ) : (
                    <button
                      onClick={() => nudge(f.card_id)}
                      disabled={busy === f.card_id}
                      className="rounded-md bg-white px-2 py-1 text-xs font-medium shadow-sm hover:bg-slate-50 disabled:opacity-50"
                    >
                      {busy === f.card_id ? 'Drafting…' : 'Draft nudge'}
                    </button>
                  )}
                  <button
                    onClick={() => snooze(f.card_id)}
                    className="rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-white/60"
                  >
                    Snooze 3d
                  </button>
                </div>
              </div>
              {nudges[f.card_id] && (
                <div className="mt-2 rounded-md bg-white p-2 text-xs text-slate-700">
                  {nudges[f.card_id]}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
