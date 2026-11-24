export type Stage = 'Queue' | 'Testing' | 'Failed' | 'Passed';
export type Source = 'Taskmandu' | 'Site check' | 'Client report';

export type Check = { id: number; label: string; is_done: boolean };
export type Shot = { id: string; name: string; url: string; created_at: string };
export type Detail = { label: string; value: string };
export type HistoryEntry = { at: string; message: string; by?: string };

/** One QA item: a site check / client report, or a Taskmandu task waiting for QA. */
export type QAItem = {
  key: string;
  kind: 'issue' | 'task';
  id: number;
  code: string | null;
  stage: Stage;
  title: string;
  business: string | null;
  site: string | null;
  url: string | null;
  source: Source;
  assignee: string | null;
  /** Taskmandu tasks are edited in Taskmandu, not here. */
  editable: boolean;
  details: Detail[];
  checks: Check[];
  screenshots: Shot[];
  fail_note: string | null;
  remarks: string | null;
  history: HistoryEntry[];
  created_at: string;
  updated_at: string;
};

export type Site = {
  id: number;
  business: string;
  name: string;
  url: string;
  website_type: string;
  frequency: string;
  project_id: string | null;
  project_name: string | null;
};

export type Project = { id: string; name: string };
export type Payload = { items: QAItem[]; sites: Site[]; businesses: string[]; projects: Project[] };

export const STAGES: Stage[] = ['Queue', 'Testing', 'Failed', 'Passed'];
export const SOURCES: Source[] = ['Taskmandu', 'Site check', 'Client report'];
export const NO_BUSINESS = 'Business not detected';

export const itemUrl = (item: Pick<QAItem, 'kind' | 'id'>) => `/pm/api/qa-center/items/${item.kind}/${item.id}`;

/** First validation message from Laravel, else the fallback. */
export function errorMessage(e: unknown, fallback: string): string {
  const message = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
  return message || fallback;
}

/** "RHB-QA3" -> "RHB". */
export const businessCode = (code: string | null) => (code ? code.split('-QA')[0] : '');

export const stageClass: Record<Stage, string> = {
  Queue: 'bg-blue-100 text-blue-700',
  Testing: 'bg-amber-100 text-amber-800',
  Failed: 'bg-rose-100 text-rose-700',
  Passed: 'bg-emerald-100 text-emerald-700',
};

export const input = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500';
export const button = 'inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50';
export const primary = 'inline-flex items-center justify-center rounded-lg bg-indigo-700 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-800 disabled:opacity-50';
export const heading = 'text-sm font-semibold text-slate-900';

export const dateTime = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
