// @ts-nocheck
import { useEffect, useState } from 'react';
import { pmApi } from '../../lib/pmApi';
import { setUrlParams, useUrlParam } from '../../lib/urlState';
import type { CheckInfo, CheckResult, CheckRow, Severity } from '../../types/pm';

const rowClasses: Record<Severity, string> = {
  danger: 'border-red-200 bg-red-50',
  warning: 'border-amber-200 bg-amber-50',
  neutral: 'border-slate-200 bg-white',
};

/**
 * Ask tab — a checklist of predefined questions. Press one and the answer is
 * computed from the board data synced by `php artisan pm:sync`. No AI and no
 * API key involved. The selected question lives in the URL (?check=<key>).
 */
export default function ChecksPanel() {
  const selected = useUrlParam('check');
  const [checks, setChecks] = useState<CheckInfo[]>([]);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0); // bump to re-run the selected check

  useEffect(() => {
    pmApi
      .checks()
      .then(({ data }) => setChecks(data.checks))
      .catch(() => setError("Couldn't load the checklist."));
  }, []);

  useEffect(() => {
    if (!selected) {
      setResult(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    pmApi
      .check(selected)
      .then(({ data }) => !cancelled && setResult(data))
      .catch(() => {
        if (!cancelled) {
          setResult(null);
          setError("Couldn't run that check.");
        }
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [selected, tick]);

  function open(r: CheckRow) {
    if (r.project_id) {
      setUrlParams({ tab: 'projects', project: r.project_id, ptab: r.task_id ? 'tasks' : null, task: r.task_id, sub: null, check: null });
    } else if (r.url) {
      window.open(r.url, '_blank', 'noopener');
    }
  }

  const canOpen = (r: CheckRow) => Boolean(r.project_id || r.url);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-slate-500">
        Pick a question. The answer is read straight from the synced board — no AI needed. Data is as of the last{' '}
        <code className="rounded bg-slate-100 px-1 text-xs">php artisan pm:sync</code>.
      </p>

      <div className="flex flex-wrap gap-1.5">
        {checks.map((c) => (
          <button
            key={c.key}
            onClick={() => (c.key === selected ? setTick((n) => n + 1) : setUrlParams({ check: c.key }))}
            className={`rounded-md px-3 py-1.5 text-sm ${
              c.key === selected ? 'bg-indigo-600 text-white' : 'border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {loading && <p className="text-sm text-slate-500">Checking the board…</p>}

      {!loading && result && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-medium text-slate-900">{result.label}</h3>
              <p className="text-xs text-slate-500">{result.summary}</p>
            </div>
            <button onClick={() => setTick((n) => n + 1)} className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50">
              Re-check
            </button>
          </div>

          {result.rows.map((r, i) => (
            <div
              key={`${r.project_id}-${r.task_id}-${r.title}-${i}`}
              role={canOpen(r) ? 'button' : undefined}
              tabIndex={canOpen(r) ? 0 : undefined}
              onClick={() => canOpen(r) && open(r)}
              onKeyDown={(e) => e.key === 'Enter' && canOpen(r) && open(r)}
              className={`rounded-lg border p-3 ${rowClasses[r.severity]} ${canOpen(r) ? 'cursor-pointer transition hover:shadow-sm' : ''}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  {r.sub && <div className="mb-0.5 text-xs text-slate-500">{r.sub}</div>}
                  <div className="text-sm font-medium text-slate-900">{r.title}</div>
                </div>
                {canOpen(r) && <span className="shrink-0 text-xs text-slate-400">{r.project_id ? 'Open →' : 'Taskmandu ↗'}</span>}
              </div>
              <div className="mt-1 text-xs text-slate-600">{r.detail}</div>
              {r.assignee && <div className="mt-1 text-xs text-slate-400">Assignee: {r.assignee}</div>}
            </div>
          ))}
        </div>
      )}

      {!selected && !loading && checks.length > 0 && <p className="text-sm text-slate-400">Press a button above to check the board.</p>}
    </div>
  );
}
