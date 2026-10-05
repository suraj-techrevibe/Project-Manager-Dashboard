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
  const total = c.completed_by_project.reduce((n, g) => n + g.items.length, 0);

  return (
    <>
      <Section title="This week at a glance">
        <p className="text-sm text-slate-700">{c.summary_text}</p>
      </Section>

      <Section title="Completed this week" count={total}>
        {c.completed_by_project.length ? (
          <div className="flex flex-col gap-2">
            {c.completed_by_project.map((g) => (
              <div key={g.project}>
                <div className="mb-0.5 text-xs font-medium text-slate-500">
                  {g.project} <span className="text-slate-400">{g.items.length}</span>
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
        Completed counts come from status changes seen at each sync. “Still in progress” shows the board as of when this report was generated; days are counted from when the task last moved to In Progress.
      </Footer>
    </>
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
          {report.content.kind && (
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
          <UpdatePart c={c} />
          <details open className="mt-4">
            <summary className="cursor-pointer select-none text-sm font-semibold text-slate-600">
              Project details <span className="font-normal text-slate-400">· from the task board</span>
            </summary>
            <div className="mt-3">{c.kind === 'daily' ? <DailyDetails c={c} /> : <WeeklyDetails c={c} />}</div>
          </details>
        </>
      ) : (
        <>
          <div className="mb-2 rounded-md bg-amber-50 p-2 text-xs text-amber-700">
            This report was made in the old format. Generate it again for this date to get the new layout.
          </div>
          <pre className="whitespace-pre-wrap font-sans text-sm text-slate-700">{report.body}</pre>
        </>
      )}
    </div>
  );
}

export default function ReportsPanel() {
  const [reports, setReports] = useState<Report[]>([]);
  const [openIds, setOpenIds] = useState<Set<number>>(new Set());
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [kind, setKind] = useState<'daily' | 'weekly'>('daily');
  const [date, setDate] = useState(todayStr());
  const [notes, setNotes] = useState('');
  const [sync, setSync] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [copied, setCopied] = useState<{ id: number; part: 'update' | 'full' } | null>(null);

  // Newest date first, always — never trust the order the server happened to return.
  const sorted = (list: Report[]) =>
    [...list].sort((a, b) => b.report_date.localeCompare(a.report_date) || (a.kind === b.kind ? 0 : a.kind === 'weekly' ? -1 : 1));

  function load() {
    setLoadingList(true);
    setListError(null);
    pmApi
      .reports()
      .then(({ data }) => setReports(sorted(data.reports ?? [])))
      .catch((e) => setListError(errorText(e, "Couldn't load reports.")))
      .finally(() => setLoadingList(false));
  }

  useEffect(load, []);

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
        description="Daily and weekly summaries built from what actually happened on the board."
        status={reports.length ? `${reports.length} saved · ${weeklyCount} weekly` : undefined}
        links={[
          { label: 'Today', tab: 'today' },
          { label: 'Projects', tab: 'projects' },
          { label: 'Meeting minutes', tab: 'minutes' },
        ]}
      />

      <JumpNav
        items={[
          { id: 'report-new', label: 'New report' },
          { id: 'report-list', label: 'Saved reports', count: reports.length },
        ]}
      />

      <UiSection id="report-new" title="New report" subtitle="Generate a daily or weekly report" tone="brand">
        <div className="mb-3 flex gap-1.5">
          {(['daily', 'weekly'] as const).map((k) => (
            <button key={k} onClick={() => setKind(k)} className={`${btnChip(kind === k)} capitalize`}>
              {k}
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="sm:w-48">
            <input type="date" value={date} max={todayStr()} onChange={(e) => setDate(e.target.value || todayStr())} className={`${inputCls} w-full`} />
            {kind === 'weekly' && <div className="mt-1 text-[11px] text-slate-400">Any day — covers that whole Mon–Sun week</div>}
          </div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            placeholder={'Optional — type what you did, in your own words. e.g.\nCalled the client about the payment gateway\nReviewed Ravi\'s login PR\nWaiting on logo files from client\nTomorrow: demo prep'}
            className={`${inputCls} min-w-0 flex-1 resize-y`}
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-500">
            <input type="checkbox" checked={sync} onChange={(e) => setSync(e.target.checked)} className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
            Refresh from Taskmandu first
          </label>
          <span className="text-xs text-slate-400">{notes.length.toLocaleString()} / 6,000</span>
          <button onClick={generate} disabled={generating} className={`${btnPrimary} ml-auto`}>
            {generating ? 'Generating…' : existing ? `Regenerate ${kind} report` : `Generate ${kind} report`}
          </button>
        </div>
        <div className="mt-2 flex flex-col gap-2 empty:hidden">
          {existing && !generating && <Notice tone="warn">A {kind} report for this {kind === 'weekly' ? 'week' : 'date'} already exists — generating replaces it.</Notice>}
          {genError && <Notice tone="danger">{genError}</Notice>}
          {warning && <Notice tone="warn">{warning}</Notice>}
        </div>
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
        {loadingList ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : listError ? (
          <Notice tone="danger">
            {listError}{' '}
            <button onClick={load} className="font-medium underline">
              Retry
            </button>
          </Notice>
        ) : reports.length === 0 ? (
          <EmptyState title="No reports yet">Generate one above — after that, a daily report is also created each weekday evening and a weekly one on Fridays.</EmptyState>
        ) : (
          <div className="flex flex-col gap-2">
            {reports.map((r) => {
              const open = openIds.has(r.id);
              return (
                <div key={r.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white transition hover:border-slate-300">
                  <button onClick={() => toggle(r.id)} aria-expanded={open} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50">
                    <span className={`text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`}>▸</span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-slate-900">{r.kind === 'weekly' ? `Week of ${niceDate(r.report_date)}` : niceDate(r.report_date)}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${r.kind === 'weekly' ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-100 text-slate-500'}`}>{r.kind}</span>
                        {r.auto && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">auto</span>}
                      </span>
                      <span className="block truncate text-xs text-slate-400">{r.content.summary_text}</span>
                    </span>
                    <span className="hidden flex-wrap justify-end gap-1 md:flex">
                      {(r.content.pills ?? []).map((p) => (
                        <span key={p.text} className={`rounded-full px-2 py-0.5 text-[11px] ${tone[p.tone]}`}>
                          {p.text}
                        </span>
                      ))}
                    </span>
                  </button>
                  {open && <ReportBody report={r} copied={copied?.id === r.id ? copied.part : null} onCopy={(part) => copy(r, part)} onDelete={() => remove(r)} />}
                </div>
              );
            })}
          </div>
        )}
      </UiSection>
    </div>
  );
}
