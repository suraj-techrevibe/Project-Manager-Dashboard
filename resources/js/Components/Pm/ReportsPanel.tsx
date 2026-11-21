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
          <details className="mt-4">
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
  const [overview, setOverview] = useState<any | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [reportView, setReportView] = useState<'company' | 'business' | 'team'>('company');
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
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

  useEffect(() => {
    load();
    loadOverview();
  }, []);

  function loadOverview() {
    setOverviewLoading(true);
    setOverviewError(null);
    pmApi.reportOverview()
      .then(({ data }) => setOverview(data))
      .catch((e) => setOverviewError(errorText(e, "Couldn't load the business overview.")))
      .finally(() => setOverviewLoading(false));
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
      <UiSection id="report-overview" title="Management overview" subtitle="Live snapshot from Taskmandu projects, subtasks and the QA review inbox." tone="info" actions={<button onClick={loadOverview} className={btnSecondary}>Refresh</button>}>
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
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
                  {[
                    ['Businesses', overview.totals.businesses],
                    ['Tasks', overview.totals.tasks],
                    ['Completed', overview.totals.completed],
                    ['Open', overview.totals.open],
                    ['Blocked', overview.totals.blocked],
                    ['Overdue', overview.totals.overdue],
                    ['QA pending / failed', `${overview.totals.qa_pending} / ${overview.totals.qa_failed}`],
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
            placeholder={'Log your operational work as well as task-board activity. e.g.\nPlanning: clarified broker-system requirements with boss\nCoordination: agreed technical approach with Senior Dev\nQA: tested referral and commission calculations\nFollow-up: resolved blocker with developer\nWaiting on: client approval for payment gateway\nNext: prepare business demo'}
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
