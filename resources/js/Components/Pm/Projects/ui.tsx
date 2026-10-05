import { useEffect, useState } from 'react';
import { pmApi } from '../../../lib/pmApi';
import type { Employee, Project, ProjectStatus, ProjectTask, TaskPriority, TaskStatus } from '../../../types/pm';

export const inputCls = 'w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm';
export const primaryBtn = 'rounded-md bg-indigo-600 px-3 py-1.5 text-sm text-white disabled:opacity-50';
export const ghostBtn = 'rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50';
export const dangerBtn = 'rounded-md border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50';

export const projectStatusColors: Record<ProjectStatus, string> = {
  Planning: 'bg-slate-100 text-slate-600',
  Active: 'bg-green-50 text-green-700',
  Blocked: 'bg-red-50 text-red-700',
  'On Hold': 'bg-amber-50 text-amber-700',
  Completed: 'bg-blue-50 text-blue-700',
};

export const taskStatusColors: Record<TaskStatus, string> = {
  Assigned: 'bg-slate-100 text-slate-600',
  Pending: 'bg-amber-50 text-amber-700',
  'In Progress': 'bg-blue-50 text-blue-700',
  Blocked: 'bg-red-50 text-red-700',
  Completed: 'bg-green-50 text-green-700',
  Cancelled: 'bg-slate-100 text-slate-400',
};

export const priorityColors: Record<TaskPriority, string> = {
  Low: 'bg-slate-100 text-slate-500',
  Medium: 'bg-blue-50 text-blue-600',
  High: 'bg-amber-50 text-amber-700',
  Critical: 'bg-red-50 text-red-700',
};

// Same palette Taskmandu offers. Full literal class names so Tailwind keeps them.
export const PROJECT_COLORS: { bg: string; name: string }[] = [
  { bg: 'bg-indigo-500', name: 'Indigo' },
  { bg: 'bg-emerald-500', name: 'Emerald' },
  { bg: 'bg-amber-500', name: 'Amber' },
  { bg: 'bg-rose-500', name: 'Rose' },
  { bg: 'bg-teal-500', name: 'Teal' },
];

export function err(e: any, fallback: string): string {
  const data = e?.response?.data;
  // Laravel validation errors: {message, errors: {field: [msg]}}
  const firstValidation = data?.errors ? (Object.values(data.errors)[0] as string[] | undefined)?.[0] : undefined;
  return data?.error ?? firstValidation ?? fallback;
}

export function today(offsetDays = 0): string {
  return new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
}

export function formatDate(v?: string | null): string {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatTimestamp(v?: string | null): string {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function isOverdue(task: Pick<ProjectTask, 'dueDate' | 'status'>): boolean {
  if (!task.dueDate || task.status === 'Completed' || task.status === 'Cancelled') return false;
  return task.dueDate < today();
}

export function taskProgress(task: ProjectTask) {
  const total = task.subTasks?.length ?? 0;
  const done = (task.subTasks ?? []).filter((s) => s.status === 'Completed').length;
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}

export function projectProgress(project: Project) {
  const total = project.tasks.length;
  const done = project.tasks.filter((t) => t.status === 'Completed').length;
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
}

/** Loads the Taskmandu employee list once and exposes an id → name lookup. */
export function useEmployees() {
  const [employees, setEmployees] = useState<Employee[]>([]);

  useEffect(() => {
    pmApi.employees().then(({ data }) => setEmployees(data.employees)).catch(() => {});
  }, []);

  // Tasks can reference an employee by employeeId or by Mongo _id — match both.
  const nameFor = (id: string) => employees.find((e) => e.employeeId === id || e.id === id)?.name ?? id;

  return { employees, nameFor };
}

export function Avatar({ name, size = 'h-6 w-6 text-[10px]' }: { name: string; size?: string }) {
  return (
    <span className={`inline-flex shrink-0 items-center justify-center rounded-full bg-slate-200 font-medium text-slate-600 ${size}`} title={name}>
      {initials(name) || '?'}
    </span>
  );
}

export function ProgressBar({ pct, className = '' }: { pct: number; className?: string }) {
  return (
    <div className={`h-1.5 w-full overflow-hidden rounded-full bg-slate-100 ${className}`}>
      <div className="h-full rounded-full bg-green-500 transition-all" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Badge({ className, children }: { className: string; children: React.ReactNode }) {
  return <span className={`shrink-0 rounded px-2 py-0.5 text-xs ${className}`}>{children}</span>;
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-500">{label}</span>
      {children}
    </label>
  );
}

export function ErrorNote({ message }: { message: string | null }) {
  return message ? <div className="rounded-md bg-red-50 p-2 text-xs text-red-700">{message}</div> : null;
}

export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className={`max-h-[90vh] w-full overflow-y-auto rounded-xl bg-white p-5 shadow-lg ${wide ? 'max-w-2xl' : 'max-w-md'}`}
      >
        <div className="mb-4 flex items-center justify-between">
          <h4 className="text-base font-medium text-slate-900">{title}</h4>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Small confirm dialog used instead of window.confirm for destructive actions. */
export function ConfirmModal({
  title,
  message,
  confirmLabel = 'Delete',
  busy,
  onConfirm,
  onClose,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal title={title} onClose={onClose}>
      <p className="text-sm text-slate-600">{message}</p>
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className={ghostBtn}>Cancel</button>
        <button onClick={onConfirm} disabled={busy} className="rounded-md bg-red-600 px-3 py-1.5 text-sm text-white disabled:opacity-50">
          {busy ? 'Working…' : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

/** Multi-select list of employees, used for task / sub-task assignees. */
export function AssigneePicker({
  employees,
  value,
  onChange,
}: {
  employees: Employee[];
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);

  return (
    <div className="flex max-h-32 flex-col gap-1 overflow-y-auto rounded-md border border-slate-200 p-2">
      {employees.length === 0 && <span className="text-xs text-slate-400">No employees loaded.</span>}
      {employees.map((e) => (
        <label key={e.employeeId} className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={value.includes(e.employeeId)} onChange={() => toggle(e.employeeId)} />
          {e.name}
        </label>
      ))}
    </div>
  );
}

/**
 * Runs a pmApi call that returns {project}, swaps the updated project into
 * the parent, and tracks which item is busy plus the last error. Returns
 * true on success so callers can reset their forms.
 */
export function useRunner(onChanged: (p: Project) => void) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(key: string, fn: () => Promise<{ data: { project: Project } }>, fallback: string): Promise<boolean> {
    setBusy(key);
    setError(null);
    try {
      const { data } = await fn();
      onChanged(data.project);
      return true;
    } catch (e) {
      setError(err(e, fallback));
      return false;
    } finally {
      setBusy(null);
    }
  }

  return { busy, error, setError, run };
}
