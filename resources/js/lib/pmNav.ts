import { router } from '@inertiajs/react';

/**
 * The PM dashboard is one real page per tab. Nested state inside a page
 * (open project / task / sub-task, selected meeting…) stays in that page's
 * query string — e.g. /pm/projects?project=<id>&ptab=tasks&task=<id>&sub=<id>.
 */
export type PmPage = 'today' | 'projects' | 'minutes' | 'brief' | 'reports' | 'scope' | 'git';

export const PM_PAGES: { key: PmPage; label: string; href: string }[] = [
  { key: 'today', label: 'Today', href: '/pm' },
  { key: 'projects', label: 'Projects', href: '/pm/projects' },
  { key: 'minutes', label: 'Meeting minutes', href: '/pm/minutes' },
  { key: 'brief', label: 'Brief to tickets', href: '/pm/brief' },
  { key: 'reports', label: 'Reports', href: '/pm/reports' },
  { key: 'scope', label: 'Scope check', href: '/pm/scope' },
  { key: 'git', label: 'Git', href: '/pm/git' },
];

export const isPmPage = (v: string): v is PmPage => PM_PAGES.some((p) => p.key === v);

export function pmUrl(page: PmPage, params: Record<string, string | null | undefined> = {}): string {
  const base = PM_PAGES.find((p) => p.key === page)!.href;
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => v && qs.set(k, v));
  const s = qs.toString();
  return s ? `${base}?${s}` : base;
}

export const visitPm = (page: PmPage, params?: Record<string, string | null | undefined>) => router.visit(pmUrl(page, params));
