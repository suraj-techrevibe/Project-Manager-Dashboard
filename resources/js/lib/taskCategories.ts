import type { CategoryHours, TaskCategory } from '@/types/pm';

/**
 * Shared vocabulary for task categories (Development, Research, QA, Maintenance, Unclassified).
 * Import from here anywhere a task's category is shown, so every tab uses the same names and colours.
 */
export const CATEGORIES: TaskCategory[] = ['Development', 'Research', 'QA', 'Maintenance', 'Unclassified'];
export const RULE_CATEGORIES = CATEGORIES.filter((c): c is Exclude<TaskCategory, 'Unclassified'> => c !== 'Unclassified');

export const CATEGORY_STYLE: Record<TaskCategory, { label: string; short: string; bar: string; chip: string; dot: string }> = {
  Development: { label: 'Development', short: 'Dev', bar: 'bg-indigo-500', chip: 'bg-indigo-50 text-indigo-700 ring-indigo-100', dot: 'bg-indigo-500' },
  Research: { label: 'Research', short: 'Research', bar: 'bg-teal-500', chip: 'bg-teal-50 text-teal-700 ring-teal-100', dot: 'bg-teal-500' },
  QA: { label: 'QA', short: 'QA', bar: 'bg-orange-500', chip: 'bg-orange-50 text-orange-700 ring-orange-100', dot: 'bg-orange-500' },
  Maintenance: { label: 'Maintenance', short: 'Maint.', bar: 'bg-amber-500', chip: 'bg-amber-50 text-amber-800 ring-amber-100', dot: 'bg-amber-500' },
  Unclassified: { label: 'Unclassified', short: 'Unclassified', bar: 'bg-slate-300', chip: 'bg-slate-100 text-slate-600 ring-slate-200', dot: 'bg-slate-300' },
};

export const emptyHours = (): CategoryHours => ({ Development: 0, Research: 0, QA: 0, Maintenance: 0, Unclassified: 0 });

export const sumHours = (h: Partial<CategoryHours> | undefined): number => CATEGORIES.reduce((n, c) => n + (h?.[c] ?? 0), 0);

/** Rounded for display: 6 → "6", 6.25 → "6.3". */
export const fmtHours = (n: number): string => String(Math.round(n * 10) / 10);

export function addHours(a: CategoryHours, b: Partial<CategoryHours> | undefined): CategoryHours {
  const out = { ...a };
  CATEGORIES.forEach((c) => (out[c] += b?.[c] ?? 0));
  return out;
}
