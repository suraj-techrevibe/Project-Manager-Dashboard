import { CATEGORIES, CATEGORY_STYLE, fmtHours, sumHours } from '@/lib/taskCategories';
import type { CategoryHours, TaskCategory } from '@/types/pm';

/** Small coloured label for one category. Reusable on any task row. */
export function CategoryBadge({ category, className = '' }: { category: TaskCategory; className?: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${CATEGORY_STYLE[category].chip} ${className}`}>
      {CATEGORY_STYLE[category].label}
    </span>
  );
}

/** Compact stacked bar of hours (or counts) per category, with an optional legend underneath. */
export function CategoryBar({ hours, unit = 'h', legend = true }: { hours: Partial<CategoryHours> | undefined; unit?: string; legend?: boolean }) {
  const total = sumHours(hours);

  return (
    <div>
      <div
        className="flex h-2.5 overflow-hidden rounded-full bg-slate-100"
        role="img"
        aria-label={total > 0 ? CATEGORIES.map((c) => `${c} ${fmtHours(hours?.[c] ?? 0)}${unit}`).join(', ') : 'No estimated hours'}
      >
        {total > 0 &&
          CATEGORIES.map((c) => {
            const v = hours?.[c] ?? 0;
            return v > 0 ? <span key={c} title={`${c}: ${fmtHours(v)}${unit}`} className={CATEGORY_STYLE[c].bar} style={{ width: `${(v / total) * 100}%` }} /> : null;
          })}
      </div>
      {legend && (
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
          {CATEGORIES.map((c) => (
            <span key={c} className="inline-flex items-center gap-1">
              <span className={`h-2 w-2 rounded-sm ${CATEGORY_STYLE[c].dot}`} />
              {CATEGORY_STYLE[c].short} {fmtHours(hours?.[c] ?? 0)}
              {unit}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
