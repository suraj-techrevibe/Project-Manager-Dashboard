import { useEffect, useState } from 'react';
import { pmApi } from '../../lib/pmApi';
import type { OperationsTodaySummary, PmIntakeStatus, Project } from '../../types/pm';

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
  planned: 'Planned',
};

function Metric({ label, value, hint, tone }: { label: string; value: number; hint: string; tone: 'slate' | 'amber' | 'rose' | 'indigo' }) {
  const styles = {
    slate: 'border-slate-200 bg-white text-slate-900',
    amber: 'border-amber-200 bg-amber-50 text-amber-950',
    rose: 'border-rose-200 bg-rose-50 text-rose-950',
    indigo: 'border-indigo-200 bg-indigo-50 text-indigo-950',
  };

  return (
    <div className={`rounded-2xl border p-4 ${styles[tone]}`}>
      <div className="text-xs font-semibold uppercase tracking-wide opacity-65">{label}</div>
      <div className="mt-1 text-3xl font-bold tabular-nums">{value}</div>
      <div className="mt-1 text-xs opacity-70">{hint}</div>
    </div>
  );
}

export default function OperationsTodayPanel({ summary, onNavigate, onCapture }: Props) {
  const { counts } = summary;
  const [projects, setProjects] = useState<Project[]>([]);
  useEffect(() => {
    let active = true;
    pmApi.projects()
      .then(({ data }) => { if (active) setProjects(data.projects); })
      .catch(() => { if (active) setProjects([]); });
    return () => { active = false; };
  }, []);
  const today = new Date().toISOString().slice(0, 10);
  const activeProjects = projects.filter((project) => project.status !== 'Completed').length;

  return (
    <section className="overflow-hidden rounded-3xl border border-indigo-100 bg-gradient-to-br from-white via-white to-indigo-50/70 p-4 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-widest text-indigo-600">Company operations</div>
          <h2 className="mt-1 text-2xl font-bold text-slate-950">Your company at a glance</h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">Capture incoming work, match it to a Taskmandu project and track delivery against that project.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onCapture('request')}
            className="rounded-xl bg-indigo-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
          >
            + New request
          </button>
          <button
            type="button"
            onClick={() => onCapture('idea')}
            className="rounded-xl border border-indigo-200 bg-white px-3.5 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
          >
            + New idea
          </button>
          <button
            type="button"
            onClick={() => onNavigate('operations')}
            className="rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Open workflow →
          </button>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <Metric label="Open requests" value={counts.open_requests} hint="Not yet planned or closed" tone="slate" />
        <Metric label="Awaiting decision" value={counts.requests_for_decision} hint="Requests in review" tone="amber" />
        <Metric label="Ideas to review" value={counts.ideas_for_review} hint="Under review" tone="indigo" />
        <Metric label="Overdue requests" value={counts.overdue_requests} hint="Past requested date" tone="rose" />
        <Metric label="Taskmandu projects" value={projects.length} hint={`${activeProjects} active / in progress`} tone="slate" />
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-semibold text-slate-900">Taskmandu project portfolio</h3>
            <button type="button" onClick={() => onNavigate('projects')} className="text-xs font-semibold text-indigo-700 hover:text-indigo-900">View projects →</button>
          </div>
          {projects.length ? (
            <div className="mt-3 space-y-3">
              {projects.slice(0, 7).map((project) => {
                const tasks = project.tasks ?? [];
                const completed = tasks.filter((task) => task.status === 'Completed').length;
                const open = tasks.filter((task) => !['Completed', 'Cancelled'].includes(task.status)).length;
                const blocked = tasks.filter((task) => task.status === 'Blocked').length;
                const overdue = tasks.filter((task) => task.dueDate && task.dueDate < today && !['Completed', 'Cancelled'].includes(task.status)).length;
                const progress = tasks.length ? Math.round((completed / tasks.length) * 100) : 0;
                return (
                  <button key={project._id} type="button" onClick={() => onNavigate('projects')} className="block w-full rounded-xl bg-slate-50 px-3 py-3 text-left hover:bg-indigo-50">
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate text-sm font-semibold text-slate-800">{project.name}</span>
                      <span className="shrink-0 text-xs text-slate-500">{project.status}</span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200">
                      <div className="h-full rounded-full bg-indigo-600" style={{ width: `${progress}%` }} />
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                      <span>{completed}/{tasks.length} completed</span><span>{open} open</span>
                      {blocked > 0 && <span className="font-medium text-rose-700">{blocked} blocked</span>}
                      {overdue > 0 && <span className="font-medium text-amber-700">{overdue} overdue</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="mt-3 rounded-xl border border-dashed border-slate-200 px-3 py-5 text-center text-sm text-slate-500">
              Taskmandu projects could not be loaded. Check the Taskmandu connection and refresh.
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-semibold text-slate-900">Needs your attention</h3>
            <button type="button" onClick={() => onNavigate('operations')} className="text-xs font-semibold text-indigo-700 hover:text-indigo-900">
              View all →
            </button>
          </div>
          {summary.recent_items.length ? (
            <div className="mt-3 divide-y divide-slate-100">
              {summary.recent_items.map((item) => (
                <div key={`${item.kind}-${item.id}`} className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-slate-800">{item.title}</div>
                    <div className="mt-0.5 text-xs text-slate-500">
                      {item.project_name || item.business_name || 'No project matched'} · {item.kind === 'request' ? 'Request' : 'Idea'}
                      {item.requested_due_at ? ` · Due ${new Date(`${item.requested_due_at}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` : ''}
                    </div>
                  </div>
                  <span className="shrink-0 rounded-full bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-600">
                    {STATUS_LABELS[item.status]}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-3 rounded-xl border border-dashed border-slate-200 px-3 py-5 text-center text-sm text-slate-500">
              No open requests or ideas need attention.
            </div>
          )}
        </div>
      </div>
      <p className="mt-4 text-xs text-slate-500">A Taskmandu project is the business record. Progress above is calculated from the project’s real Tasks; request and idea records remain separate until work is pushed.</p>
    </section>
  );
}
