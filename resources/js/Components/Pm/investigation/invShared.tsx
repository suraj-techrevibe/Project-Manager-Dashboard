import type { ReactNode } from 'react';
import type { InvPriority, InvStatus } from '@/types/pmInvestigation';
import { Pill, type Tone } from '../ui/kit';

export const errText = (e: unknown, fallback: string) => {
  const r = (e as { response?: { data?: { message?: string; errors?: Record<string, string[]> } } })?.response?.data;
  const first = r?.errors ? Object.values(r.errors)[0]?.[0] : undefined;
  return first ?? r?.message ?? fallback;
};

export const inputCls =
  'w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-800 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400 disabled:bg-slate-50 disabled:text-slate-500';

export const fmtDate = (d: string | null | undefined) => {
  if (!d) return '—';
  const [y, m, day] = d.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
};

export const fmtDateTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';

export function Field({ label, hint, children, className = '' }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block text-xs font-medium text-slate-600 ${className}`}>
      {label}
      <div className="mt-1 font-normal">{children}</div>
      {hint && <div className="mt-0.5 text-[11px] font-normal text-slate-400">{hint}</div>}
    </label>
  );
}

/** Two-step delete: the first click asks, the second one does it. */

export const STATUS_LABEL: Record<InvStatus, string> = {
  not_started: 'Not started', in_progress: 'In progress', awaiting_review: 'Awaiting review', reviewed: 'Reviewed', completed: 'Completed', returned: 'Returned for further investigation',
};
const STATUS_TONE: Record<InvStatus, Tone> = { not_started: 'neutral', in_progress: 'info', awaiting_review: 'warn', reviewed: 'brand', completed: 'ok', returned: 'danger' };
const PRIORITY_TONE: Record<InvPriority, Tone> = { low: 'neutral', medium: 'info', high: 'warn', urgent: 'danger' };

export const PRIORITIES: InvPriority[] = ['low', 'medium', 'high', 'urgent'];
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const StatusPill = ({ status }: { status: InvStatus }) => <Pill tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Pill>;
export const PriorityBadge = ({ value }: { value: InvPriority }) => <Pill tone={PRIORITY_TONE[value]}>{cap(value)}</Pill>;

export const EVENT_LABEL: Record<string, string> = {
  assigned: 'Assigned', reassigned: 'Reassigned', edited: 'Details edited', draft_saved: 'Findings saved', review_notes: 'Review notes saved',
  start: 'Started', submit: 'Findings submitted', review: 'Marked reviewed', return: 'Returned for further investigation', close: 'Closed', reopen: 'Reopened',
};
