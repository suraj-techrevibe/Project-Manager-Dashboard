import { useEffect, useState } from 'react';
import { pmApi } from '../../lib/pmApi';
import { reportText } from '../../lib/Reporttext';
import type { DailyContent, Report, ReportItem, ReportPill, WeeklyContent } from '../../types/pm';
import { EmptyState, JumpNav, Notice, PageHeader, Section as UiSection, btnChip, btnPrimary, btnSecondary } from './ui/kit';

const inputCls = 'rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500';

const todayStr = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const niceDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

function errorText(e: any, fallback: string): string {
  const d = e?.response?.data;
  if (d?.errors) {
    const first = Object.values(d.errors)[0] as string[] | undefined;
    if (first?.[0]) return first[0];
  }
  return d?.error ?? d?.message ?? fallback;
}

const tone: Record<ReportPill['tone'], string> = {
  green: 'bg-green-50 text-green-700',
  red: 'bg-red-50 text-red-700',
  amber: 'bg-amber-50 text-amber-700',
  slate: 'bg-slate-100 text-slate-600',
};


function StructuredEditor({ label, value, onChange, depth = 0 }: { label: string; value: any; onChange: (next: any) => void; depth?: number }) {
  const human = label.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  if (Array.isArray(value)) {
    return <details open={depth === 0} className="rounded-lg border border-slate-200 p-3"><summary className="cursor-pointer text-sm font-semibold">{human} <span className="font-normal text-slate-400">({value.length})</span></summary><div className="mt-3 space-y-3">{value.map((item, index) => <div key={index} className="rounded-md bg-white p-2"><div className="mb-2 flex items-center justify-between"><span className="text-xs font-medium text-slate-500">Item {index + 1}</span><button type="button" className="text-xs text-red-600" onClick={() => onChange(value.filter((_: any, i: number) => i !== index))}>Remove</button></div><StructuredEditor label={`Item ${index + 1}`} value={item} depth={depth + 1} onChange={next => onChange(value.map((v: any, i: number) => i === index ? next : v))} /></div>)}<button type="button" className="rounded-md border px-3 py-1.5 text-xs" onClick={() => onChange([...value, (value[0] && typeof value[0] === 'object' ? Object.fromEntries(Object.keys(value[0]).map(k => [k, typeof value[0][k] === 'number' ? 0 : typeof value[0][k] === 'boolean' ? false : ''])) : '')])}>+ Add item</button></div></details>;
  }
  if (value !== null && typeof value === 'object') {
    return <details open={depth === 0} className="rounded-lg border border-slate-200 p-3"><summary className="cursor-pointer text-sm font-semibold">{human}</summary><div className="mt-3 space-y-3">{Object.entries(value).map(([key, child]) => <StructuredEditor key={key} label={key} value={child} depth={depth + 1} onChange={next => onChange({ ...value, [key]: next })} />)}</div></details>;
  }
  return <label className="block text-xs font-medium text-slate-600">{human}{typeof value === 'boolean' ? <input type="checkbox" className="ml-2" checked={value} onChange={e => onChange(e.target.checked)} /> : typeof value === 'number' ? <input type="number" className={inputCls + ' mt-1 block w-full'} value={value} onChange={e => onChange(Number(e.target.value))} /> : typeof value === 'string' && (value.length > 100 || value.includes('\n')) ? <textarea rows={3} className={inputCls + ' mt-1 block w-full'} value={value} onChange={e => onChange(e.target.value)} /> : <input className={inputCls + ' mt-1 block w-full'} value={value ?? ''} onChange={e => onChange(e.target.value)} />}</label>;
}

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <section className="border-t border-slate-100 py-3 first:border-t-0 first:pt-0">
      <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">
        {title}
        {count !== undefined && <span className="ml-1.5 text-slate-400">{count}</span>}
      </h3>
      {children}
    </section>
  );
}

const Empty = ({ children }: { children: React.ReactNode }) => <p className="text-sm text-slate-400">{children}</p>;

function Bullets({ lines }: { lines: string[] }) {
  return (
    <ul className="flex flex-col gap-1 text-sm text-slate-700">
      {lines.map((l, i) => (
        <li key={i} className="flex gap-2">
          <span className="text-slate-300">•</span>
          <span>{l}</span>
        </li>
      ))}
    </ul>
  );
}

function Tasks({ items, suffix }: { items: ReportItem[]; suffix?: (t: ReportItem) => string }) {
  return (
    <ul className="flex flex-col gap-1 text-sm text-slate-700">
      {items.map((t, i) => (
        <li key={i} className="flex gap-2">
          <span className="text-slate-300">•</span>
          <span>
            {t.title}
            {t.project && <span className="text-slate-400"> · {t.project}</span>}
            <span className="text-slate-500"> — {t.assignee ?? 'unassigned'}</span>
            {suffix && <span className="text-slate-400"> {suffix(t)}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Sections with nothing in them are left out entirely, so a quiet day is a short report. */
const Optional = ({ show, ...p }: { show: boolean; title: string; count?: number; children: React.ReactNode }) =>
  show ? <Section title={p.title} count={p.count}>{p.children}</Section> : null;

function Footer({ notesAi, children }: { notesAi: boolean | null; children: React.ReactNode }) {
  return (
    <p className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-400">
      {children}
      {notesAi === true && ' Custom text was split into sections by AI.'}
    </p>
  );
}

/** Part 1: written for the boss — plain language, nothing from the task board. */
function UpdatePart({ c }: { c: DailyContent | WeeklyContent }) {
  const blocks = [
    { title: 'What I did', lines: c.my_actions },
    { title: 'Blockers / waiting on', lines: c.blocker_notes },
    { title: c.kind === 'weekly' ? 'Next week' : 'Tomorrow', lines: c.plan },
    { title: 'Notes', lines: c.notes },
  ].filter((b) => b.lines.length);

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-4">
      <h3 className="mb-3 text-base font-semibold text-slate-900">Update</h3>
      {blocks.length ? (
        <div className="flex flex-col gap-4">
          {blocks.map((b) => (
            <div key={b.title}>
              <h4 className="mb-1 text-sm font-medium text-slate-800">{b.title}</h4>
              <ul className="flex flex-col gap-1 text-[15px] leading-snug text-slate-700">
                {b.lines.map((l, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-slate-300">•</span>
                    <span>{l}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-slate-400">
          Nothing written yet. Type what you did into the custom text box above and press Regenerate — it will appear here, ahead of the technical details.
        </p>
      )}
    </div>
  );
}

/** Part 2: the board data. Same content as before, minus what moved into the Update. */
function DailyDetails({ c }: { c: DailyContent }) {
  return (
    <>
      <Section title="Today at a glance">
        <p className="text-sm text-slate-700">{c.summary_text}</p>
        <p className="mt-1 text-xs text-slate-500">Board: {c.board_text}</p>
      </Section>

      <Section title="Completed today" count={c.completed.length}>
        {c.completed.length ? <Tasks items={c.completed} /> : <Empty>Nothing completed.</Empty>}
      </Section>

      <Optional show={c.new_tasks.length > 0} title="New tasks" count={c.new_tasks.length}>
        <Tasks items={c.new_tasks} />
      </Optional>

      <Section title="Progress today" count={c.moved.length + c.comments.length}>
        {c.moved.length + c.comments.length ? (
          <>
            <Tasks items={c.moved} suffix={(t) => `${t.from ?? '?'} → ${t.to ?? '?'}`} />
            {c.comments.length > 0 && (
              <div className={c.moved.length ? 'mt-1' : ''}>
                <Tasks items={c.comments} suffix={(t) => `· ${t.comments} new comment${t.comments === 1 ? '' : 's'}`} />
              </div>
            )}
          </>
        ) : (
          <Empty>No status changes today.</Empty>
        )}
      </Section>

      <Optional show={c.newly_blocked.length > 0} title="New blockers" count={c.newly_blocked.length}>
        <Tasks items={c.newly_blocked} />
      </Optional>

      <Optional show={c.unblocked.length > 0} title="Unblocked" count={c.unblocked.length}>
        <Tasks items={c.unblocked} suffix={(t) => `→ ${t.to ?? ''}`} />
      </Optional>

      <Optional show={c.newly_overdue.length > 0} title="Newly overdue" count={c.newly_overdue.length}>
        <Tasks items={c.newly_overdue} suffix={(t) => `(was due ${t.due})`} />
      </Optional>

      <Optional show={c.attention.length > 0} title="Needs attention (stuck 3+ days)" count={c.attention.length}>
        <Tasks items={c.attention} suffix={(t) => `— ${t.kind} ${t.days}d`} />
      </Optional>

      <Section title="Team today" count={c.team.length}>
        {c.team.length ? (
          <ul className="flex flex-col gap-1 text-sm text-slate-700">
            {c.team.map((p) => (
              <li key={p.name}>
                <span className="font-medium">{p.name}:</span>{' '}
                <span className="text-slate-600">
                  {[
                    p.done.length ? `finished ${p.done.join(', ')}` : '',
                    p.moved.length ? `moved ${p.moved.join(', ')}` : '',
                    p.blocked.length ? `blocked on ${p.blocked.join(', ')}` : '',
                    p.discussed.length ? `discussed ${p.discussed.join(', ')}` : '',
                  ]
                    .filter(Boolean)
                    .join('; ')}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>No team activity recorded.</Empty>
        )}
      </Section>

      <Footer notesAi={c.notes_ai}>
        Only changes are listed, so a task that takes several days shows up on the days it moves, plus once under “needs attention” if it stalls. Changes and comments are detected at each sync. The full open picture is in the weekly report.
      </Footer>
    </>
  );
}

function WeeklyDetails({ c }: { c: WeeklyContent }) {
  const completedGroups = c.completed_by_business ?? c.completed_by_project.map((g) => ({ business: g.project, items: g.items }));
  const total = completedGroups.reduce((n, g) => n + g.items.length, 0);

  return (
    <>
      <Section title="This week at a glance">
        <p className="text-sm text-slate-700">{c.summary_text}</p>
      </Section>

      <Section title="Business-wise progress" count={c.business_summary?.length ?? 0}>
        {c.business_summary?.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[48rem] text-left text-sm">
              <thead className="text-xs text-slate-400">
                <tr>
                  <th className="pb-1 pr-3 font-normal">Business</th>
                  <th className="pb-1 pr-3 text-right font-normal">Completed</th>
                  <th className="pb-1 pr-3 text-right font-normal">QA pending</th>
                  <th className="pb-1 pr-3 text-right font-normal">Accepted</th>
                  <th className="pb-1 pr-3 text-right font-normal">Open</th>
                  <th className="pb-1 pr-3 text-right font-normal">In progress</th>
                  <th className="pb-1 pr-3 text-right font-normal">Blocked</th>
                  <th className="pb-1 text-right font-normal">Overdue</th>
                  <th className="pb-1 text-right font-normal">Subtasks done / total</th>
                </tr>
              </thead>
              <tbody className="text-slate-700">
                {c.business_summary.map((b) => (
                  <tr key={b.business} className="border-t border-slate-100">
                    <td className="py-1.5 pr-3 font-medium">{b.business}</td>
                    <td className="py-1.5 pr-3 text-right">{b.completed}</td>
                    <td className={`py-1.5 pr-3 text-right ${b.qa_pending ? 'text-amber-600 font-medium' : ''}`}>{b.qa_pending}</td>
                    <td className="py-1.5 pr-3 text-right">{b.qa_accepted}</td>
                    <td className="py-1.5 pr-3 text-right">{b.open}</td>
                    <td className="py-1.5 pr-3 text-right">{b.in_progress}</td>
                    <td className={`py-1.5 pr-3 text-right ${b.blocked ? 'text-red-600 font-medium' : ''}`}>{b.blocked}</td>
                    <td className={`py-1.5 text-right ${b.overdue ? 'text-red-600 font-medium' : ''}`}>{b.overdue}</td>
                    <td className="py-1.5 text-right">{b.subtasks_completed ?? 0} / {b.subtasks_total ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>No Taskmandu projects with tasks were found.</Empty>
        )}
      </Section>

      <Section title="Completed this week by business" count={total}>
        {completedGroups.length ? (
          <div className="flex flex-col gap-2">
            {completedGroups.map((g) => (
              <div key={g.business}>
                <div className="mb-0.5 text-xs font-medium text-slate-500">
                  {g.business} <span className="text-slate-400">{g.items.length}</span>
                </div>
                <Tasks items={g.items.map((i) => ({ ...i, project: null }))} />
              </div>
            ))}
          </div>
        ) : (
          <Empty>Nothing completed.</Empty>
        )}
      </Section>

      <Section title="Still in progress" count={c.in_progress.length}>
        {c.in_progress.length ? <Tasks items={c.in_progress} suffix={(t) => (t.days != null ? `· ${t.days}d in progress` : '')} /> : <Empty>Nothing in progress.</Empty>}
      </Section>

      <Section title="Blocked" count={c.blocked.length}>
        {c.blocked.length ? <Tasks items={c.blocked} suffix={(t) => (t.days != null ? `· blocked ${t.days}d` : '')} /> : <Empty>Nothing blocked.</Empty>}
      </Section>

      <Section title="Overdue" count={c.overdue.length}>
        {c.overdue.length ? <Tasks items={c.overdue} suffix={(t) => `· ${t.days}d overdue`} /> : <Empty>Nothing overdue.</Empty>}
      </Section>

      <Section title="Team workload" count={c.team.length}>
        {c.team.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[26rem] text-left text-sm">
              <thead className="text-xs text-slate-400">
                <tr>
                  <th className="pb-1 pr-3 font-normal">Person</th>
                  <th className="pb-1 pr-3 text-right font-normal">Completed</th>
                  <th className="pb-1 pr-3 text-right font-normal">Open</th>
                  <th className="pb-1 pr-3 text-right font-normal">In progress</th>
                  <th className="pb-1 pr-3 text-right font-normal">Blocked</th>
                  <th className="pb-1 text-right font-normal">Overdue</th>
                </tr>
              </thead>
              <tbody className="text-slate-700">
                {c.team.map((p) => (
                  <tr key={p.name} className="border-t border-slate-50">
                    <td className="py-1 pr-3 font-medium">{p.name}</td>
                    <td className="py-1 pr-3 text-right">{p.completed}</td>
                    <td className="py-1 pr-3 text-right">{p.open}</td>
                    <td className="py-1 pr-3 text-right">{p.in_progress}</td>
                    <td className={`py-1 pr-3 text-right ${p.blocked ? 'text-red-600' : ''}`}>{p.blocked}</td>
                    <td className={`py-1 text-right ${p.overdue ? 'text-red-600' : ''}`}>{p.overdue}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>No team activity.</Empty>
        )}
      </Section>

      <Footer notesAi={c.notes_ai}>
        Completed counts come from status changes seen at each sync. “Still in progress” shows the board as of when this report was generated; days are counted from when the task last moved to In Progress. QA pending and accepted counts show the latest QA status at generation time, not a historical end-of-week snapshot.
      </Footer>
    </>
  );
}

function healthTone(health: string): string {
  return health === 'At risk' ? 'bg-red-50 text-red-700' : health === 'Watch' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700';
}

function ExecutiveBrief({ c }: { c: DailyContent | WeeklyContent }) {
  const e = c.executive;
  if (!e) return null;
  const t = e.totals;
  const healthBar = (value: number, color: string) => (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
  return (
    <section className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><h3 className="text-base font-semibold text-slate-900">Executive snapshot</h3><p className="text-xs text-slate-500">Company delivery position · as of {new Date(e.as_of).toLocaleString()}</p></div>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] text-slate-600">{e.businesses.length} projects / businesses</span>
      </div>
      <div className="mt-3 rounded-lg border border-indigo-100 bg-indigo-50/50 p-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-indigo-900">{c.kind === 'weekly' ? 'This week’s movement' : 'Today’s movement'}</div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {(c.kind === 'daily' ? [
            ['Completed', c.summary.completed, 'text-emerald-700'],
            ['Moved forward', c.summary.moved, 'text-indigo-700'],
            ['New tasks', c.summary.new_tasks, 'text-slate-800'],
            ['Newly blocked', c.summary.newly_blocked, c.summary.newly_blocked ? 'text-red-700' : 'text-slate-800'],
            ['Newly overdue', c.summary.newly_overdue, c.summary.newly_overdue ? 'text-amber-700' : 'text-slate-800'],
          ] : [
            ['Completed', c.summary.completed, 'text-emerald-700'],
            ['vs previous week', c.summary.completed - c.summary.prev_completed, c.summary.completed >= c.summary.prev_completed ? 'text-emerald-700' : 'text-amber-700'],
            ['New tasks', c.summary.new_tasks, 'text-slate-800'],
            ['Blocked now', c.summary.blocked, c.summary.blocked ? 'text-red-700' : 'text-slate-800'],
            ['Overdue now', c.summary.overdue, c.summary.overdue ? 'text-amber-700' : 'text-slate-800'],
          ]).map(([label, value, color]) => (
            <div key={String(label)} className="rounded-md bg-white/80 px-2.5 py-2">
              <div className="text-[10px] text-slate-500">{label}</div>
              <div className={`mt-0.5 text-lg font-semibold ${color}`}>{value}</div>
            </div>
          ))}
        </div>
        {c.kind === 'weekly' && <p className="mt-2 text-[10px] text-slate-500">Previous week: {c.summary.prev_completed} completed · {c.summary.prev_new_tasks} new tasks. This is a volume comparison, not a productivity rating.</p>}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {[
          ['Tasks', t.tasks, 'text-slate-900'],
          ['Completed', t.completed, 'text-emerald-700'],
          ['Open', t.open, 'text-slate-900'],
          ['Blocked', t.blocked, t.blocked ? 'text-red-700' : 'text-slate-900'],
          ['Overdue', t.overdue, t.overdue ? 'text-red-700' : 'text-slate-900'],
          ['QA pending', t.qa_pending, t.qa_pending ? 'text-amber-700' : 'text-slate-900'],
          ['QA failed', t.qa_failed, t.qa_failed ? 'text-red-700' : 'text-slate-900'],
        ].map(([label, value, color]) => (
          <div key={String(label)} className="rounded-lg bg-slate-50 px-3 py-2"><div className="text-[11px] text-slate-500">{label}</div><div className={`mt-0.5 text-xl font-semibold ${color}`}>{value}</div></div>
        ))}
      </div>

      <div className="mt-5">
        <div className="mb-2 flex items-center justify-between"><h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Business / project performance</h4><span className="text-[11px] text-slate-400">Completed tasks / total tasks</span></div>
        {e.businesses.length ? <div className="grid gap-3 md:grid-cols-2">
          {e.businesses.map((b) => (
            <div key={b.project_id} className="rounded-lg border border-slate-100 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-semibold text-slate-800">{b.business}</span><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${healthTone(b.health)}`}>{b.health}</span></div>
              <div className="mt-2 flex items-center justify-between text-xs text-slate-500"><span>{b.completed} / {b.total} completed</span><strong className="text-slate-700">{b.progress}%</strong></div>
              <div className="mt-1">{healthBar(b.progress, 'bg-indigo-500')}</div>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
                <span>{b.open} open</span><span>{b.blocked} blocked</span><span>{b.overdue} overdue</span><span>{b.qa_pending} QA pending</span><span>{b.qa_failed} QA failed</span><span>Subtasks {b.subtasks_completed}/{b.subtasks_total}</span>
              </div>
            </div>
          ))}
        </div> : <Empty>No project-linked tasks in this snapshot.</Empty>}
      </div>

      <div className="mt-5">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Team delivery health</h4><span className="text-[11px] text-slate-400">Share of assigned tasks without a blocked or overdue risk</span></div>
        {e.team.length ? <div className="grid gap-2 md:grid-cols-2">
          {e.team.map((p) => (
            <div key={p.name} className="rounded-lg border border-slate-100 px-3 py-2">
              <div className="flex items-center justify-between gap-2"><span className="text-sm font-medium text-slate-800">{p.name}</span><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${healthTone(p.health)}`}>{p.health}</span></div>
              <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500"><span>{p.completed} completed · {p.open} open</span><span>{p.health_pct}% without risk</span></div>
              <div className="mt-1">{healthBar(p.health_pct, p.health === 'At risk' ? 'bg-red-500' : p.health === 'Watch' ? 'bg-amber-500' : 'bg-emerald-500')}</div>
              <div className="mt-1 text-[11px] text-slate-500">{p.in_progress} in progress · {p.blocked} blocked · {p.overdue} overdue</div>
            </div>
          ))}
        </div> : <Empty>No assigned task data.</Empty>}
      </div>
      <p className="mt-3 text-[10px] text-slate-400">Snapshot is current when generated, including for backdated reports. Standalone tasks are included in company totals and team workload, but not assigned to a Taskmandu project. A task blocked and overdue counts as one risk.</p>
    </section>
  );
}

function ReportBody({ report, onCopy, onDelete, copied }: { report: Report; onCopy: (part: 'update' | 'full') => void; onDelete: () => void; copied: 'update' | 'full' | null }) {
  const c = report.content;
  const meta = 'prepared_by' in c ? c : null;

  return (
    <div className="border-t border-slate-100 px-4 pb-4 pt-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-400">
          {meta && <>Prepared by {meta.prepared_by}</>}
          {report.generated_at && <>{meta ? ' · ' : ''}generated {new Date(report.generated_at).toLocaleString()}</>}
        </p>
        <div className="flex gap-1.5">
          {report.content.kind && report.content.kind !== 'pack' && (
            <button onClick={() => onCopy('update')} className="rounded-md bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-700" title="Just the Update section — the one to send to your boss">
              {copied === 'update' ? 'Copied ✓' : 'Copy update'}
            </button>
          )}
          <button onClick={() => onCopy('full')} className="rounded-md bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200">
            {copied === 'full' ? 'Copied ✓' : report.content.kind ? 'Copy full report' : 'Copy as text'}
          </button>
          <button onClick={onDelete} className="rounded-md border border-slate-200 px-3 py-1 text-xs text-slate-500 hover:bg-red-50 hover:text-red-600">
            Delete
          </button>
        </div>
      </div>

      {meta?.notes_warning && <div className="mb-3 rounded-md bg-amber-50 p-2 text-xs text-amber-700">{meta.notes_warning}</div>}

      {c.kind === 'daily' || c.kind === 'weekly' ? (
        <>
          <ExecutiveBrief c={c} />
          <UpdatePart c={c} />
          <details className="mt-4">
            <summary className="cursor-pointer select-none text-sm font-semibold text-slate-600">
              Project details <span className="font-normal text-slate-400">· from the task board</span>
            </summary>
            <div className="mt-3">{c.kind === 'daily' ? <DailyDetails c={c} /> : <WeeklyDetails c={c} />}</div>
          </details>
        </>
      ) : c.kind === 'pack' ? (
        <div className="space-y-3">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <h3 className="text-base font-semibold text-slate-900">{c.title}</h3>
            <p className="mt-1 text-xs text-slate-500">Period: {c.period?.from} to {c.period?.to}</p>
            <div className="mt-2 flex flex-wrap gap-2">{Object.entries(c.summary || {}).map(([key,value])=><span key={key} className="rounded-md bg-white px-2 py-1 text-xs text-slate-600">{key.replaceAll('_',' ')}: <strong>{String(value)}</strong></span>)}</div>
          </div>
          <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap rounded-lg bg-white p-3 font-sans text-xs text-slate-700">{report.body}</pre>
        </div>
      ) : (
        <>
          <div className="mb-2 rounded-md bg-amber-50 p-2 text-xs text-amber-700">This report was made in the old format. Generate it again for this date to get the new layout.</div>
          <pre className="whitespace-pre-wrap font-sans text-sm text-slate-700">{report.body}</pre>
        </>
      )}
    </div>
  );
}

export default function ReportsPanel() {
  const [reports, setReports] = useState<Report[]>([]);
  const [overview, setOverview] = useState<any | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [reportView, setReportView] = useState<'company' | 'business' | 'team'>('company');
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [openIds, setOpenIds] = useState<Set<number>>(new Set());
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [periodFrom, setPeriodFrom] = useState(() => {
    const d = new Date(); d.setDate(1);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  });
  const [periodTo, setPeriodTo] = useState(todayStr());
  const [periodType, setPeriodType] = useState<'qa' | 'minutes' | 'performance'>('performance');
  const [periodData, setPeriodData] = useState<any | null>(null);
  const [periodLoading, setPeriodLoading] = useState(false);
  const [periodError, setPeriodError] = useState<string | null>(null);

  const [kind, setKind] = useState<'daily' | 'weekly'>('daily');
  const [date, setDate] = useState(todayStr());
  const [notes, setNotes] = useState('');
  const [sync, setSync] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [copied, setCopied] = useState<{ id: number; part: 'update' | 'full' } | null>(null);
  const [reportType,setReportType]=useState<'daily'|'weekly'|'range'>('daily');
  const [savedSearch,setSavedSearch]=useState('');
  const [savedPeriodFilter,setSavedPeriodFilter]=useState<'all'|'daily'|'weekly'|'date_range'>('all');
  const [savedFilter,setSavedFilter]=useState<'all'|'daily'|'weekly'|'qa'|'minutes'|'performance'>('all');
  const [editId,setEditId]=useState<number|null>(null);
  const [editContent,setEditContent]=useState<any>(null);
  const [editBody,setEditBody]=useState('');
  const [editNotes,setEditNotes]=useState('');
  const [editSaving,setEditSaving]=useState(false);

  // Newest date first, always — never trust the order the server happened to return.
  const sorted = (list: Report[]) =>
    [...list].sort((a, b) => b.report_date.localeCompare(a.report_date) || (a.kind === b.kind ? 0 : a.kind === 'weekly' ? -1 : 1));

  useEffect(() => {
    loadOverview();
    loadPeriod();
  }, []);

  function loadOverview() {
    setOverviewLoading(true);
    setOverviewError(null);
    pmApi.reportOverview()
      .then(({ data }) => setOverview(data))
      .catch((e) => setOverviewError(errorText(e, "Couldn't load the business overview.")))
      .finally(() => setOverviewLoading(false));
  }

  async function loadPeriod() {
    if (!periodFrom || !periodTo || periodFrom > periodTo) {
      setPeriodError('Choose a valid date range. The start date must be before or equal to the end date.');
      return;
    }
    setPeriodLoading(true);
    setLoadingList(true);
    setPeriodError(null);
    setListError(null);
    try {
      const [{ data }, { data: archive }] = await Promise.all([pmApi.reportPeriod(periodFrom, periodTo), pmApi.reports()]);
      setPeriodData(data);
      setReports(sorted(archive.reports ?? data.saved_reports ?? []));
    } catch (e) {
      const message = errorText(e, "Couldn't load reports for this date range.");
      setPeriodError(message);
      setListError(message);
    } finally {
      setPeriodLoading(false);
      setLoadingList(false);
    }
  }

  // A weekly report is dated by its Monday, so "does one already exist?" compares Mondays.
  const monday = (iso: string) => {
    const d = new Date(`${iso}T00:00:00`);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  const targetDate = kind === 'weekly' ? monday(date) : date;
  const existing = reports.find((r) => r.kind === kind && r.report_date === targetDate);

  const toggle = (id: number) =>
    setOpenIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  async function generate() {
    if (notes.length > 6000) return setGenError('The custom text is over the 6,000 character limit.');
    setGenError(null);
    setWarning(null);
    setGenerating(true);
    try {
      const { data } = await pmApi.generateReport(date, notes.trim(), sync, kind);
      const r = data.report;
      setReports((prev) => sorted([r, ...prev.filter((x) => x.id !== r.id && !(x.kind === r.kind && x.report_date === r.report_date))]));
      setOpenIds((prev) => new Set(prev).add(r.id)); // open the one just made
      setWarning(data.warning);
    } catch (e) {
      setGenError(errorText(e, "Couldn't generate the report. Try again."));
    } finally {
      setGenerating(false);
    }
  }

  async function generatePack() {
    setGenError(null); setWarning(null); setGenerating(true);
    try {
      const payload = reportType === 'range'
        ? { period_type: 'date_range' as const, from: periodFrom, to: periodTo, sync }
        : { period_type: reportType, date, sync };
      const { data } = await pmApi.generateReportPack(payload);
      setReports(prev => sorted([...data.reports, ...prev.filter(old => !data.reports.some((fresh: Report) => fresh.id === old.id))]));
      setOpenIds(prev => new Set([...prev, ...data.reports.map((r: Report) => r.id)]));
      setSavedFilter('all');
      setWarning(data.warning);
    } catch (e) {
      setGenError(errorText(e, "Couldn't generate the report pack."));
    } finally { setGenerating(false); }
  }

  async function remove(r: Report) {
    if (!window.confirm(`Delete this ${r.kind} report (${niceDate(r.report_date)})?`)) return;
    try {
      await pmApi.deleteReport(r.id);
      setReports((prev) => prev.filter((x) => x.id !== r.id));
    } catch (e) {
      setListError(errorText(e, "Couldn't delete that report."));
    }
  }

  async function copy(r: Report, part: 'update' | 'full') {
    const text = reportText(r, part);
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
    setCopied({ id: r.id, part });
    setTimeout(() => setCopied((cur) => (cur?.id === r.id ? null : cur)), 1500);
  }

  const weeklyCount = reports.filter((r) => r.kind === 'weekly').length;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        icon="chart"
        title="Reports"
        description="Business performance, delivery risks, team workload and boss-facing daily or weekly updates."
        status={reports.length ? `${reports.length} saved · ${weeklyCount} weekly` : undefined}
        links={[
          { label: 'Today', tab: 'today' },
          { label: 'Projects', tab: 'projects' },
          { label: 'Meeting minutes', tab: 'minutes' },
        ]}
      />

      <JumpNav
        items={[
          { id: 'report-overview', label: 'Management overview' },
          { id: 'report-new', label: 'New report' },
          { id: 'report-list', label: 'Saved reports', count: reports.length },
        ]}
      />
      <UiSection id="report-period" title="Date-range report centre" subtitle="Choose a period, then switch between QA, meeting minutes and task / team / project performance." tone="brand">
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-slate-500">From<input type="date" value={periodFrom} max={periodTo || undefined} onChange={e => setPeriodFrom(e.target.value)} className={`${inputCls} mt-1 block`} /></label>
          <label className="text-xs text-slate-500">To<input type="date" value={periodTo} min={periodFrom || undefined} max={todayStr()} onChange={e => setPeriodTo(e.target.value)} className={`${inputCls} mt-1 block`} /></label>
          <button onClick={() => void loadPeriod()} disabled={periodLoading} className={btnPrimary}>{periodLoading ? 'Loading…' : 'Apply date range'}</button>
          {periodData && <span className="text-xs text-slate-400">{periodData.range.from} → {periodData.range.to}</span>}
        </div>
        <div className="mt-4 flex flex-wrap gap-1.5">
          {([{id:'qa',label:'QA reports',count:periodData?.qa?.count},{id:'minutes',label:'Meeting minutes',count:periodData?.minutes?.count},{id:'performance',label:'Tasks & performance',count:periodData?.performance?.summary?.activity_events}] as const).map(item => (
            <button key={item.id} onClick={() => setPeriodType(item.id)} className={`${btnChip(periodType === item.id)}`}>
              {item.label}{item.count !== undefined ? ` · ${item.count}` : ''}
            </button>
          ))}
        </div>
        {periodError && <Notice tone="danger">{periodError}</Notice>}
        {periodLoading && <p className="mt-3 text-sm text-slate-400">Loading records in this date range…</p>}
        {!periodLoading && periodData && periodType === 'qa' && (
          <div className="mt-3">
            {periodData.qa.reports.length ? <div className="divide-y divide-slate-100">
              {periodData.qa.reports.map((r:any) => <div key={r.id} className="py-3">
                <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="text-sm font-semibold text-slate-800">{r.business} · {r.report_code}</div><div className="mt-0.5 text-xs text-slate-500">{r.report_date} · {r.site_app || 'Website / app'} · {r.finding_count} findings</div><div className="mt-1 flex flex-wrap gap-2 text-xs"><span className="text-red-700">{r.severity_counts.critical} Critical</span><span className="text-orange-700">{r.severity_counts.high} High</span><span className="text-amber-700">{r.severity_counts.medium} Medium</span><span className="text-slate-500">{r.severity_counts.low} Low</span></div></div>
                <span className={r.handed_over_at ? 'text-xs font-medium text-emerald-700' : 'text-xs text-amber-700'}>{r.handed_over_at ? 'Handed over' : 'Not handed over'}</span></div>
                <details className="mt-2 rounded-lg border border-slate-100 px-3 py-2"><summary className="cursor-pointer text-xs font-medium text-indigo-700">View report details · {r.findings?.length || 0} findings</summary>
                  {r.summary && <p className="mt-2 whitespace-pre-wrap text-xs text-slate-600">{r.summary}</p>}
                  {r.areas_tested && <p className="mt-2 text-xs text-slate-600"><strong>Areas tested:</strong> {r.areas_tested}</p>}
                  {r.environment && <p className="mt-1 text-xs text-slate-600"><strong>Environment:</strong> {r.environment}</p>}
                  {r.fix_first && <p className="mt-1 whitespace-pre-wrap text-xs text-slate-600"><strong>Fix first:</strong> {r.fix_first}</p>}
                  {r.findings?.map((f:any,i:number)=><div key={f.id ?? i} className="mt-3 border-t border-slate-100 pt-2 text-xs"><div className="font-semibold text-slate-800">QA-{String(i+1).padStart(2,'0')} · {f.title} <span className="font-normal text-slate-500">· {f.severity} · {f.status}</span></div>{f.page_url && <div className="mt-1 break-all text-slate-500">{f.page_url}</div>}{f.description && <p className="mt-1 whitespace-pre-wrap text-slate-600"><strong>Actual:</strong> {f.description}</p>}{f.expected_behaviour && <p className="mt-1 whitespace-pre-wrap text-slate-600"><strong>Expected:</strong> {f.expected_behaviour}</p>}{f.developer_notes && <p className="mt-1 whitespace-pre-wrap text-slate-600"><strong>Developer notes:</strong> {f.developer_notes}</p>}{f.assignee && <p className="mt-1 text-slate-500">Assigned: {f.assignee}</p>}{f.evidence_url && <a className="mt-1 inline-block break-all text-indigo-700 underline" href={f.evidence_url} target="_blank" rel="noreferrer">Open evidence</a>}</div>)}
                  {r.checklist?.length > 0 && <div className="mt-3 border-t border-slate-100 pt-2 text-xs"><strong>Checklist</strong>{r.checklist.map((item:any,i:number)=><div key={i} className="mt-1 flex justify-between gap-3"><span>{item.label}</span><span>{item.result}</span></div>)}</div>}
                  {r.open_questions && <p className="mt-2 whitespace-pre-wrap text-xs text-slate-600"><strong>Open questions:</strong> {r.open_questions}</p>}
                </details>
              </div>)}
            </div> : <EmptyState title="No QA reports in this period">Saved QA reports will appear here when their report date falls inside the selected range.</EmptyState>}
          </div>
        )}
        {!periodLoading && periodData && periodType === 'minutes' && (
          <div className="mt-3">
            {periodData.minutes.meetings.length ? <div className="divide-y divide-slate-100">
              {periodData.minutes.meetings.map((m:any) => <div key={m.id} className="py-3">
                <div className="flex flex-wrap items-start justify-between gap-2"><div className="text-sm font-semibold text-slate-800">{m.title}</div><span className="text-xs text-slate-500">{m.meeting_date} · {m.status}</span></div>
                <div className="mt-1 text-xs text-slate-500">Attendees: {m.attendees?.join(', ') || 'Not recorded'} · {m.action_items?.length || 0} action items · {m.work_items?.length || 0} work items</div>
                {m.agenda_items?.length > 0 && <div className="mt-2 text-xs text-slate-600"><strong>Agenda:</strong> {m.agenda_items.join(' · ')}</div>}
                {m.discussion && <p className="mt-2 whitespace-pre-wrap text-xs text-slate-600"><strong>Discussion:</strong> {m.discussion}</p>}
                {m.decisions?.length > 0 && <ul className="mt-2 list-disc pl-5 text-xs text-slate-600">{m.decisions.map((d:string,i:number)=><li key={i}>{d}</li>)}</ul>}
                {m.work_items?.map((w:any,i:number)=><div key={i} className="mt-3 rounded-md bg-slate-50 p-2 text-xs"><div className="font-semibold text-slate-700">{w.project || 'General'} · {w.owner || 'Owner not assigned'}</div><div className="mt-1 text-slate-700">{w.requirement}</div>{w.discussion && <p className="mt-1 whitespace-pre-wrap text-slate-500">{w.discussion}</p>}{w.action_items?.length > 0 && <ul className="mt-1 list-disc pl-4 text-slate-600">{w.action_items.map((a:any,j:number)=><li key={j}>{a.task}{a.due_date ? ` · due ${a.due_date}` : ''}</li>)}</ul>}</div>)}
                {m.action_items?.length > 0 && <div className="mt-2 text-xs text-slate-600"><strong>Action items:</strong> {m.action_items.map((a:any)=>`${a.task} — ${a.owner || 'Unassigned'}${a.due_date ? ` (due ${a.due_date})` : ''}`).join(' · ')}</div>}
              </div>)}
            </div> : <EmptyState title="No meeting minutes in this period">Meeting minutes are matched using the meeting date, not the date they were last edited.</EmptyState>}
          </div>
        )}
        {!periodLoading && periodData && periodType === 'performance' && (
          <div className="mt-3 space-y-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
              {[
                ['Activity events',periodData.performance.summary.activity_events],
                ['Tasks created',periodData.performance.summary.tasks_created],
                ['Tasks completed',periodData.performance.summary.tasks_completed],
                ['Newly blocked',periodData.performance.summary.tasks_blocked],
                ['Comments',periodData.performance.summary.comments],
                ['Follow-ups',periodData.performance.summary.follow_ups],
                ['Verified',periodData.performance.summary.verified],
                ['Subtasks created',periodData.performance.summary.subtasks_created],
                ['Subtasks completed',periodData.performance.summary.subtasks_completed],
              ].map(([label,value])=><div key={String(label)} className="rounded-lg border border-slate-200 bg-white p-3"><div className="text-xs text-slate-500">{label}</div><div className="mt-1 text-xl font-semibold text-slate-900">{value}</div></div>)}
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <div><h4 className="mb-2 text-sm font-semibold text-slate-800">Business / project performance</h4>{periodData.performance.businesses.length ? <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="text-slate-400"><tr><th className="pb-2">Business / project</th><th className="pb-2 text-right">Activity</th><th className="pb-2 text-right">Created</th><th className="pb-2 text-right">Completed</th><th className="pb-2 text-right">Blocked</th></tr></thead><tbody>{periodData.performance.businesses.map((b:any)=><tr key={b.business} className="border-t border-slate-100"><td className="py-2 pr-2 font-medium">{b.business}</td><td className="py-2 text-right">{b.activity_count}</td><td className="py-2 text-right">{b.tasks_created}</td><td className="py-2 text-right">{b.tasks_completed}</td><td className="py-2 text-right">{b.blocked}</td></tr>)}</tbody></table></div>:<Empty>No task activity recorded.</Empty>}</div>
              <div><h4 className="mb-2 text-sm font-semibold text-slate-800">Team performance / contribution</h4>{periodData.performance.team.length ? <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="text-slate-400"><tr><th className="pb-2">Team member</th><th className="pb-2 text-right">Activity</th><th className="pb-2 text-right">Created</th><th className="pb-2 text-right">Completed</th><th className="pb-2 text-right">Blocked</th></tr></thead><tbody>{periodData.performance.team.map((p:any)=><tr key={p.name} className="border-t border-slate-100"><td className="py-2 pr-2 font-medium">{p.name}</td><td className="py-2 text-right">{p.activity_count}</td><td className="py-2 text-right">{p.tasks_created}</td><td className="py-2 text-right">{p.tasks_completed}</td><td className="py-2 text-right">{p.blocked}</td></tr>)}</tbody></table></div>:<Empty>No team activity recorded.</Empty>}</div>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <div><h4 className="mb-2 text-sm font-semibold text-slate-800">Subtask activity by project</h4>{periodData.performance.subtasks.by_project.length ? <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="text-slate-400"><tr><th className="pb-2">Project</th><th className="pb-2 text-right">Created</th><th className="pb-2 text-right">Completed</th></tr></thead><tbody>{periodData.performance.subtasks.by_project.map((s:any)=><tr key={s.project_id} className="border-t border-slate-100"><td className="py-2 pr-2">{s.project}</td><td className="py-2 text-right">{s.created}</td><td className="py-2 text-right">{s.completed}</td></tr>)}</tbody></table></div>:<Empty>No subtask activity recorded.</Empty>}</div>
              <div><h4 className="mb-2 text-sm font-semibold text-slate-800">Subtask activity by team member</h4>{periodData.performance.subtasks.by_team.length ? <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="text-slate-400"><tr><th className="pb-2">Team member</th><th className="pb-2 text-right">Created</th><th className="pb-2 text-right">Completed</th></tr></thead><tbody>{periodData.performance.subtasks.by_team.map((s:any)=><tr key={s.name} className="border-t border-slate-100"><td className="py-2 pr-2">{s.name}</td><td className="py-2 text-right">{s.created}</td><td className="py-2 text-right">{s.completed}</td></tr>)}</tbody></table></div>:<Empty>No subtask activity recorded.</Empty>}</div>
            </div>
            <div><div className="mb-2 flex flex-wrap items-center justify-between gap-2"><h4 className="text-sm font-semibold text-slate-800">Activity log</h4><span className="text-xs text-slate-400">Showing {periodData.performance.activities.length} of {periodData.performance.activity_total}</span></div>
              <div className="overflow-x-auto"><table className="w-full min-w-[38rem] text-left text-xs"><thead className="text-slate-400"><tr><th className="pb-2">Date / time</th><th className="pb-2">Business / project</th><th className="pb-2">Task / activity</th><th className="pb-2">Team member</th><th className="pb-2">Change</th></tr></thead><tbody>{periodData.performance.activities.map((a:any)=><tr key={a.id} className="border-t border-slate-100"><td className="py-2 pr-2 whitespace-nowrap">{a.occurred_at ? new Date(a.occurred_at).toLocaleString() : '—'}</td><td className="py-2 pr-2">{a.business}</td><td className="py-2 pr-2">{a.title}<span className="block text-slate-400">{a.type.replaceAll('_',' ')}</span></td><td className="py-2 pr-2">{a.assignee}</td><td className="py-2">{a.from || a.to ? `${a.from || '—'} → ${a.to || '—'}` : '—'}</td></tr>)}</tbody></table></div>
              {periodData.performance.activity_truncated && <p className="mt-2 text-xs text-amber-700">Activity log is limited to the latest 500 events in this range; summary totals include all events.</p>}
            </div>
            <p className="text-xs text-slate-500">{periodData.performance.data_note}</p>
          </div>
        )}
      </UiSection>

      <UiSection id="report-overview" title="Management overview" subtitle="Current board snapshot, independent of the selected historical date range above." tone="info" actions={<button onClick={loadOverview} className={btnSecondary}>Refresh</button>}>
        <div className="mb-4 flex flex-wrap gap-1.5">
          {(['company', 'business', 'team'] as const).map((v) => (
            <button key={v} onClick={() => setReportView(v)} className={`${btnChip(reportView === v)} capitalize`}>{v === 'company' ? 'Company overview' : v === 'business' ? 'Business reports' : 'Team reports'}</button>
          ))}
        </div>
        {overviewLoading ? <p className="text-sm text-slate-400">Loading live report data…</p> : overviewError ? (
          <Notice tone="danger">{overviewError} <button onClick={loadOverview} className="underline">Retry</button></Notice>
        ) : overview ? (
          <>
            {reportView === 'company' && (
              <>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
                  {[
                    ['Businesses', overview.totals.businesses],
                    ['Tasks', overview.totals.tasks],
                    ['Completed', overview.totals.completed],
                    ['Open', overview.totals.open],
                    ['Blocked', overview.totals.blocked],
                    ['Overdue', overview.totals.overdue],
                    ['QA pending / failed', `${overview.totals.qa_pending} / ${overview.totals.qa_failed}`],
                    ['Subtasks done / total', `${overview.totals.subtasks_completed} / ${overview.totals.subtasks_total}`],
                  ].map(([label, value]) => <div key={String(label)} className="rounded-lg border border-slate-200 bg-white p-3"><div className="text-xs text-slate-500">{label}</div><div className="mt-1 text-xl font-semibold text-slate-900">{value}</div></div>)}
                </div>
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full min-w-[50rem] text-left text-sm">
                    <thead className="text-xs text-slate-400"><tr>{['Business / project','Tasks','Completed','Open','Blocked','Overdue','QA pending','QA failed','Subtasks done / total'].map(x => <th key={x} className="pb-2 pr-3 font-medium">{x}</th>)}</tr></thead>
                    <tbody>{overview.projects.map((p: any) => <tr key={p.project_id} className="border-t border-slate-100"><td className="py-2 pr-3 font-medium"><button onClick={() => { setReportView('business'); setExpandedProjects(prev => new Set(prev).add(p.project_id)); }} className="text-left text-indigo-700 hover:underline">{p.project_name}</button></td><td className="py-2 pr-3">{p.task_count}</td><td className="py-2 pr-3">{p.completed}</td><td className="py-2 pr-3">{p.open}</td><td className={`py-2 pr-3 ${p.blocked ? 'font-semibold text-red-600' : ''}`}>{p.blocked}</td><td className={`py-2 pr-3 ${p.overdue ? 'font-semibold text-red-600' : ''}`}>{p.overdue}</td><td className={`py-2 pr-3 ${p.qa_pending ? 'font-semibold text-amber-600' : ''}`}>{p.qa_pending}</td><td className={`py-2 pr-3 ${p.qa_failed ? 'font-semibold text-red-600' : ''}`}>{p.qa_failed}</td><td className="py-2 pr-3">{p.subtasks_completed ?? 0} / {p.subtasks_total ?? 0}</td></tr>)}</tbody>
                  </table>
                </div>
                {overview.unassigned_tasks?.length > 0 && <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50/60 p-3"><div className="mb-2 text-sm font-semibold text-amber-900">Standalone / shared tasks · {overview.unassigned_tasks.length}</div><div className="space-y-1">{overview.unassigned_tasks.map((task: any, index: number) => <div key={index} className="flex flex-wrap justify-between gap-2 text-xs text-amber-900"><span>{task.title} <span className="text-amber-700">· {task.project_name || 'No project'} · {task.assignee || 'Unassigned'}</span></span><span>{task.status}</span></div>)}</div></div>}
              </>
            )}
            {reportView === 'business' && (
              <div className="flex flex-col gap-2">
                {overview.projects.map((p: any) => {
                  const expanded = expandedProjects.has(p.project_id);
                  return <div key={p.project_id} className="overflow-hidden rounded-lg border border-slate-200">
                    <button onClick={() => setExpandedProjects(prev => { const next = new Set(prev); expanded ? next.delete(p.project_id) : next.add(p.project_id); return next; })} className="flex w-full flex-wrap items-center gap-2 px-3 py-3 text-left hover:bg-slate-50">
                      <span className="text-slate-400">{expanded ? '▾' : '▸'}</span><span className="min-w-0 flex-1 text-sm font-semibold text-slate-900">{p.project_name}</span>
                      <span className="text-xs text-slate-500">{p.task_count} tasks</span><span className="text-xs text-green-700">{p.completed} done</span><span className="text-xs text-red-600">{p.blocked + p.overdue} attention</span>
                    </button>
                    {expanded && <div className="border-t border-slate-100">
                      {p.tasks.map((t: any) => <div key={t.id} className="border-b border-slate-100 px-3 py-3 last:border-0">
                        <div className="flex flex-wrap items-start gap-2"><div className="min-w-0 flex-1"><div className="text-sm font-medium text-slate-800">{t.title}</div><div className="mt-0.5 text-xs text-slate-500">{t.assignee || 'Unassigned'} · Due {t.due_at || 'not set'}{t.subtasks_total ? ` · ${t.subtasks_completed}/${t.subtasks_total} subtasks done` : ''}</div></div><span className={`rounded-full px-2 py-0.5 text-[11px] ${t.status === 'Completed' ? 'bg-green-50 text-green-700' : t.status === 'Blocked' ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-600'}`}>{t.status}</span>{t.qa_status && <span className={`rounded-full px-2 py-0.5 text-[11px] ${t.qa_status === 'Passed' ? 'bg-green-50 text-green-700' : t.qa_status === 'Failed' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>QA {t.qa_status}</span>}{t.url && <a href={t.url} target="_blank" rel="noreferrer" className="text-xs text-indigo-600 underline">Taskmandu</a>}</div>
                        {t.qa_history?.length > 0 && <details className="mt-2 text-xs"><summary className="cursor-pointer text-slate-500">QA history · {t.qa_history.length} events (cycle {t.qa_cycle || 1})</summary><div className="mt-1 space-y-1 pl-3">{t.qa_history.map((event: any, index: number) => <div key={index} className="text-slate-500">Cycle {event.cycle}: <span className="font-medium">{event.result}</span>{event.severity ? ` · ${event.severity}` : ''}{event.notes ? ` · ${event.notes}` : ''}</div>)}</div></details>}
                        {t.subtasks.length > 0 && <div className="mt-2 ml-3 border-l-2 border-slate-100 pl-3"><div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Subtasks</div>{t.subtasks.map((sub: any) => <div key={sub.id} className="flex flex-wrap justify-between gap-2 py-1 text-xs"><span className="text-slate-700">{sub.title} <span className="text-slate-400">· {sub.assignee || 'Unassigned'}</span></span><span className={sub.status === 'Completed' ? 'text-green-700' : 'text-slate-500'}>{sub.status}</span></div>)}</div>}
                      </div>)}
                      {p.tasks.length === 0 && <p className="p-3 text-sm text-slate-400">No tasks found.</p>}
                      {p.team?.length > 0 && <div className="border-t border-slate-100 bg-slate-50/60 p-3"><div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Team contribution in this business</div><div className="flex flex-wrap gap-2">{p.team.map((member: any) => <div key={member.name} className="rounded-md border border-slate-200 bg-white px-2.5 py-2 text-xs"><div className="font-medium text-slate-800">{member.name}</div><div className="mt-0.5 text-slate-500">{member.tasks_completed} tasks done · {member.tasks_open} open · {member.subtasks_completed} subtasks done · {member.subtasks_open} open</div></div>)}</div></div>}
                    </div>}
                  </div>;
                })}
              </div>
            )}
            {reportView === 'team' && (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[42rem] text-left text-sm">
                  <thead className="text-xs text-slate-400"><tr>{['Team member','Tasks completed','Tasks open','Subtasks completed','Subtasks open','Blocked','Overdue','Business contributions'].map(x => <th key={x} className="pb-2 pr-3 font-medium">{x}</th>)}</tr></thead>
                  <tbody>{overview.team.map((p: any) => <tr key={p.name} className="border-t border-slate-100"><td className="py-2 pr-3 font-medium text-slate-800">{p.name}</td><td className="py-2 pr-3">{p.tasks_completed}</td><td className="py-2 pr-3">{p.tasks_open}</td><td className="py-2 pr-3">{p.subtasks_completed}</td><td className="py-2 pr-3">{p.subtasks_open}</td><td className={`py-2 pr-3 ${p.blocked ? 'text-red-600' : ''}`}>{p.blocked}</td><td className={`py-2 pr-3 ${p.overdue ? 'text-red-600' : ''}`}>{p.overdue}</td><td className="py-2 pr-3 text-xs text-slate-600">{p.businesses?.length ? p.businesses.map((b: any) => `${b.project_name} (${b.tasks_open + b.tasks_completed} tasks / ${b.subtasks_open + b.subtasks_completed} subtasks)`).join(' · ') : 'Standalone / shared'}</td></tr>)}</tbody>
                </table>
                <p className="mt-2 text-xs text-slate-400">Task and subtask counts are separate. These figures describe current assigned workload, not a productivity ranking.</p>
              </div>
            )}
            <div className="mt-3 border-t border-slate-100 pt-2 text-[11px] text-slate-400">Snapshot: {new Date(overview.generated_at).toLocaleString()} · {overview.data_notes.join(' ')}</div>
          </>
        ) : null}
      </UiSection>


      <UiSection id="report-new" title="Generate report pack" subtitle="Choose a period. One click creates three separate saved reports." tone="brand">
        <div className="flex flex-wrap gap-2">{(['daily','weekly','range'] as const).map(k=><button key={k} onClick={()=>setReportType(k)} className={btnChip(reportType===k)}>{k==='range'?'Date range':k==='daily'?'Daily':'Weekly'}</button>)}</div>
        {reportType !== 'range' ? <label className="mt-3 block text-xs text-slate-500">{reportType === 'weekly' ? 'Choose any date in the week' : 'Report date'}<input type="date" max={todayStr()} value={date} onChange={e=>setDate(e.target.value||todayStr())} className={inputCls+' mt-1 block'}/></label> : <div className="mt-3 flex flex-wrap gap-3"><label className="text-xs text-slate-500">From<input type="date" value={periodFrom} max={periodTo} onChange={e=>setPeriodFrom(e.target.value)} className={inputCls+' mt-1 block'}/></label><label className="text-xs text-slate-500">To<input type="date" value={periodTo} min={periodFrom} max={todayStr()} onChange={e=>setPeriodTo(e.target.value)} className={inputCls+' mt-1 block'}/></label></div>}
        <div className="mt-4 grid gap-2 sm:grid-cols-3"><div className="rounded-lg border p-3"><strong className="text-sm">QA Report</strong><p className="text-xs text-slate-500">Findings, severity, pass/fail and fixes.</p></div><div className="rounded-lg border p-3"><strong className="text-sm">Meeting Minutes</strong><p className="text-xs text-slate-500">Meetings, decisions, actions and follow-ups.</p></div><div className="rounded-lg border p-3"><strong className="text-sm">Tasks &amp; Performance</strong><p className="text-xs text-slate-500">Task progress, business, project and team activity.</p></div></div>
        <div className="mt-3 flex flex-wrap items-center gap-3"><label className="flex items-center gap-2 text-xs text-slate-500"><input type="checkbox" checked={sync} onChange={e=>setSync(e.target.checked)}/>Sync Taskmandu first</label><button onClick={()=>void generatePack()} disabled={generating} className={btnPrimary}>{generating?'Generating three reports…':'Generate report pack'}</button></div>
        {genError&&<Notice tone="danger">{genError}</Notice>}{warning&&<Notice tone="warn">{warning}</Notice>}
      </UiSection>

<UiSection
        id="report-list"
        title="Saved reports"
        count={reports.length || undefined}
        subtitle="Newest first — click one to open it"
        tone="info"
        actions={
          reports.length > 1 ? (
            <button onClick={() => setOpenIds((prev) => (prev.size ? new Set() : new Set(reports.map((r) => r.id))))} className={btnSecondary}>
              {openIds.size ? 'Collapse all' : 'Expand all'}
            </button>
          ) : undefined
        }
      >
        <div className="mb-3 flex flex-wrap gap-2"><input value={savedSearch} onChange={e=>setSavedSearch(e.target.value)} placeholder="Search saved reports…" className={inputCls+" min-w-[12rem] flex-1"}/><select value={savedFilter} onChange={e=>setSavedFilter(e.target.value as any)} className={inputCls}><option value="all">All report types</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="qa">QA Report</option><option value="minutes">Meeting Minutes</option><option value="performance">Tasks &amp; Performance</option></select><select value={savedPeriodFilter} onChange={e=>setSavedPeriodFilter(e.target.value as any)} className={inputCls}><option value="all">All periods</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="date_range">Date range</option></select></div>
        {loadingList ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : listError ? (
          <Notice tone="danger">
            {listError}{' '}
            <button onClick={() => void loadPeriod()} className="font-medium underline">
              Retry
            </button>
          </Notice>
        ) : reports.length === 0 ? (
          <EmptyState title="No reports yet">Generate one above — after that, a daily report is also created each weekday evening and a weekly one on Fridays.</EmptyState>
        ) : (
          <div className="flex flex-col gap-2">
            {reports.filter(r=>(savedFilter==='all'||r.kind===savedFilter)&&(savedPeriodFilter==='all'||r.period_type===savedPeriodFilter)&&(`${r.report_date} ${r.period_end||''} ${r.kind} ${JSON.stringify(r.content||{})} ${r.notes||''}`).toLowerCase().includes(savedSearch.toLowerCase())).map((r) => {
              const open = openIds.has(r.id);
              return (
                <div key={r.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white transition hover:border-slate-300">
                  <button onClick={() => toggle(r.id)} aria-expanded={open} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50">
                    <span className={`text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`}>▸</span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-slate-900">{r.period_end && r.period_end !== r.report_date ? `${niceDate(r.report_date)} – ${niceDate(r.period_end)}` : r.kind === 'weekly' ? `Week of ${niceDate(r.report_date)}` : niceDate(r.report_date)}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${r.kind === 'weekly' ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-100 text-slate-500'}`}>{r.kind === 'qa' ? 'QA Report' : r.kind === 'minutes' ? 'Meeting Minutes' : r.kind === 'performance' ? 'Tasks & Performance' : r.kind}</span>
                        {r.auto && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">auto</span>}
                      </span>
                      <span className="block truncate text-xs text-slate-400">{r.content.summary_text || r.content.title || `Reporting period: ${r.period_type || r.kind}`}</span>
                    </span>
                    <span className="hidden flex-wrap justify-end gap-1 md:flex">
                      {(r.content.pills ?? []).map((p: ReportPill) => (
                        <span key={p.text} className={`rounded-full px-2 py-0.5 text-[11px] ${tone[p.tone]}`}>
                          {p.text}
                        </span>
                      ))}
                    </span>
                  </button>
                  {open && <><div className="flex flex-wrap gap-2 px-4 pt-3"><button onClick={()=>{setEditId(r.id);setEditContent(JSON.parse(JSON.stringify(r.content || {})));setEditBody(r.body || '');setEditNotes(r.notes||'');}} className={btnSecondary}>Edit report</button><button onClick={()=>window.location.href='/pm/api/reports/'+r.id+'/docx'} className={btnSecondary}>Export DOCX</button></div>{editId===r.id&&<div className="mx-4 mt-3 rounded-lg border bg-slate-50 p-3">{r.content?.kind === 'pack' ? <div><div className="mb-2"><p className="text-sm font-semibold text-slate-800">Edit report text</p><p className="text-xs text-slate-500">Edit the report like a document. This changes the saved report and DOCX export, not the original QA, meeting or task records.</p></div><textarea rows={22} value={editBody} onChange={e=>setEditBody(e.target.value)} spellCheck className="w-full rounded-lg border border-slate-300 bg-white p-3 font-mono text-sm leading-6 text-slate-800 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"/></div> : <div><p className="mb-2 text-xs text-slate-500">Edit the saved report using fields and expandable sections. Source records are not changed.</p><StructuredEditor label="Report content" value={editContent} onChange={setEditContent}/></div>}<label className="mt-3 block text-xs font-medium">Notes<textarea rows={3} value={editNotes} onChange={e=>setEditNotes(e.target.value)} className={inputCls+' mt-1 w-full'}/></label><div className="mt-2 flex gap-2"><button disabled={editSaving} onClick={async()=>{try{setEditSaving(true);const res=await pmApi.updateReport(r.id,editContent,editNotes,r.content?.kind === 'pack' ? editBody : undefined);setReports(prev=>sorted(prev.map(x=>x.id===r.id?res.data.report:x)));setEditId(null);}catch(e:any){setListError(e?.message||'Unable to save report edit. Please try again.');}finally{setEditSaving(false);}}} className={btnPrimary}>{editSaving?'Saving…':'Save changes'}</button><button onClick={()=>setEditId(null)} className={btnSecondary}>Cancel</button></div></div>}<ReportBody report={r} copied={copied?.id === r.id ? copied.part : null} onCopy={(part) => copy(r, part)} onDelete={() => remove(r)} /></>}
                </div>
              );
            })}
          </div>
        )}
      </UiSection>
    </div>
  );
}
