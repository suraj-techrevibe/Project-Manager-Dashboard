import { visitPm } from '../../lib/pmNav';
import { Icon, Pill, btnPrimary, btnSecondary } from './ui/kit';
import type { OperationsTodaySummary, PmIntakeStatus } from '../../types/pm';

interface Props {
  summary: OperationsTodaySummary;
  onNavigate: (tab: string) => void;
  onCapture: (kind: 'request' | 'idea') => void;
}

const STATUS_LABELS: Record<PmIntakeStatus, string> = {
  received: 'Received',
  needs_clarification: 'Needs clarification',
  in_review: 'In review',
  approved: 'Approved',
  captured: 'Captured',
  under_review: 'Under review',
  accepted: 'Accepted',
  rejected: 'Rejected',
  deferred: 'Deferred',
  planned: 'In delivery',
};

type MetricTone = 'slate' | 'amber' | 'rose' | 'indigo';

const METRIC_ACCENT: Record<MetricTone, { bar: string; value: string }> = {
  slate: { bar: 'border-t-slate-300', value: 'text-slate-900' },
  amber: { bar: 'border-t-amber-400', value: 'text-amber-700' },
  rose: { bar: 'border-t-rose-500', value: 'text-rose-700' },
  indigo: { bar: 'border-t-indigo-500', value: 'text-indigo-700' },
};

function Metric({ label, value, hint, tone }: { label: string; value: number; hint: string; tone: MetricTone }) {
  const a = METRIC_ACCENT[tone];
  return (
    <div className={`rounded-xl border border-t-2 border-slate-200/80 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] ${a.bar}`}>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-3xl font-semibold tabular-nums tracking-tight ${value === 0 && tone !== 'slate' ? 'text-slate-400' : a.value}`}>{value}</div>
      <div className="mt-1 text-xs text-slate-500">{hint}</div>
    </div>
  );
}

function Card({ title, sub, action, children }: { title: string; sub: string; action: { label: string; onClick: () => void }; children: React.ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <header className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold tracking-tight text-slate-900">{title}</h3>
          <p className="text-xs text-slate-500">{sub}</p>
        </div>
        <button type="button" onClick={action.onClick} className="shrink-0 text-xs font-semibold text-indigo-600 hover:text-indigo-800">
          {action.label} →
        </button>
      </header>
      <div className="flex-1 p-4">{children}</div>
    </section>
  );
}

const EmptyNote = ({ children }: { children: React.ReactNode }) => (
  <div className="rounded-lg border border-dashed border-slate-200 px-3 py-6 text-center text-sm text-slate-500">{children}</div>
);

export default function OperationsTodayPanel({ summary, onNavigate, onCapture }: Props) {
  const { counts } = summary;
  const projects = summary.projects;

  return (
    <section aria-label="Company overview" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-slate-900">Company overview</h2>
          <p className="text-sm text-slate-500">Incoming work, decisions waiting on you and delivery across Taskmandu projects.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => onCapture('request')} className={btnPrimary}>
            <Icon name="plus" className="h-4 w-4" /> New request
          </button>
          <button type="button" onClick={() => onCapture('idea')} className={btnSecondary}>
            <Icon name="plus" className="h-4 w-4" /> New idea
          </button>
          <button type="button" onClick={() => onNavigate('operations')} className={btnSecondary}>
            Open workflow
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Metric label="Open requests" value={counts.open_requests} hint="Not yet planned or closed" tone="slate" />
        <Metric label="Awaiting decision" value={counts.requests_for_decision} hint="Requests in review" tone="amber" />
        <Metric label="Ideas to review" value={counts.ideas_for_review} hint="Under review" tone="indigo" />
        <Metric label="Overdue requests" value={counts.overdue_requests} hint="Past requested date" tone="rose" />
        <Metric label="Active projects" value={counts.projects_with_tasks} hint="With tasks on the synced board" tone="slate" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Project portfolio" sub="Progress and task health from Taskmandu" action={{ label: 'View projects', onClick: () => onNavigate('projects') }}>
          {projects.length ? (
            <ul className="space-y-2">
              {projects.slice(0, 7).map((project) => (
                <li key={project.id}>
                  <button type="button" onClick={() => visitPm('projects', { project: project.id })} className="block w-full rounded-lg border border-slate-100 px-3 py-2.5 text-left transition hover:border-indigo-200 hover:bg-indigo-50/40">
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate text-sm font-medium text-slate-900">{project.name}</span>
                      <span className="shrink-0 text-xs font-semibold tabular-nums text-slate-600">{project.progress}%</span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full bg-indigo-500" style={{ width: `${project.progress}%` }} />
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-500">
                      <span>
                        {project.completed}/{project.task_count} done
                      </span>
                      <span>{project.open} open</span>
                      {project.blocked > 0 && <span className="font-medium text-rose-700">{project.blocked} blocked</span>}
                      {project.overdue > 0 && <span className="font-medium text-amber-700">{project.overdue} overdue</span>}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyNote>Taskmandu projects could not be loaded. Check the Taskmandu connection and refresh.</EmptyNote>
          )}
        </Card>

        <Card title="Needs attention" sub="Recent requests and ideas that need follow-up" action={{ label: 'View all', onClick: () => onNavigate('operations') }}>
          {summary.recent_items.length ? (
            <ul className="divide-y divide-slate-100">
              {summary.recent_items.map((item) => (
                <li key={`${item.kind}-${item.id}`} className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-slate-900">{item.title}</div>
                    <div className="mt-0.5 text-xs text-slate-500">
                      {item.project_name || item.business_name || 'No project matched'} · {item.kind === 'request' ? 'Request' : 'Idea'}
                      {item.requested_due_at ? ` · Due ${new Date(`${item.requested_due_at}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` : ''}
                    </div>
                  </div>
                  <Pill>{STATUS_LABELS[item.status]}</Pill>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyNote>No open requests or ideas need attention.</EmptyNote>
          )}
        </Card>
      </div>

      <p className="text-xs text-slate-500">A Taskmandu project is the business record. Progress is calculated from the project's real tasks; requests and ideas stay separate until work is pushed.</p>
    </section>
  );
}
