import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { setUrlParams } from '@/lib/urlState';

/* ------------------------------------------------------------------ */
/* Shared look for every PM tab. Palette:                               */
/*   indigo = brand / primary actions / active state                    */
/*   red = needs action · amber = watch · green = healthy · sky = info  */
/*   slate = everything else                                            */
/* ------------------------------------------------------------------ */

export type Tone = 'neutral' | 'brand' | 'danger' | 'warn' | 'ok' | 'info';

export const toneText: Record<Tone, string> = {
  neutral: 'text-slate-700',
  brand: 'text-indigo-700',
  danger: 'text-red-700',
  warn: 'text-amber-700',
  ok: 'text-emerald-700',
  info: 'text-sky-700',
};

const toneSoft: Record<Tone, string> = {
  neutral: 'bg-slate-100 text-slate-600',
  brand: 'bg-indigo-50 text-indigo-700',
  danger: 'bg-red-100 text-red-700',
  warn: 'bg-amber-100 text-amber-800',
  ok: 'bg-emerald-100 text-emerald-700',
  info: 'bg-sky-100 text-sky-700',
};

const toneBar: Record<Tone, string> = {
  neutral: 'bg-slate-300',
  brand: 'bg-indigo-500',
  danger: 'bg-red-500',
  warn: 'bg-amber-400',
  ok: 'bg-emerald-500',
  info: 'bg-sky-400',
};

/** Shared control styles so buttons look the same on every tab. */
export const btnPrimary =
  'inline-flex items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50';
export const btnSecondary =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50';
export const btnChip = (active: boolean) =>
  `rounded-full border px-3 py-1 text-xs font-medium transition ${
    active ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
  }`;

/* ------------------------------------------------------------------ */
/* Icons (stroke, 24px grid)                                            */
/* ------------------------------------------------------------------ */

const ICONS: Record<string, string> = {
  chevron: 'M6 9l6 6 6-6',
  sun: 'M12 3v2M12 19v2M5 5l1.4 1.4M17.6 17.6L19 19M3 12h2M19 12h2M5 19l1.4-1.4M17.6 6.4L19 5M12 8a4 4 0 100 8 4 4 0 000-8z',
  folder: 'M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z',
  notes: 'M7 3h7l5 5v13H7V3zM14 3v5h5M10 13h6M10 17h6',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  chart: 'M4 20h16M7 20v-9M12 20V5M17 20v-6',
  target: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 16a4 4 0 100-8 4 4 0 000 8z',
  branch: 'M6 3v12M18 9a3 3 0 100-6 3 3 0 000 6zM6 21a3 3 0 100-6 3 3 0 000 6zM18 9a9 9 0 01-9 9',
  refresh: 'M20 11a8 8 0 10-2.3 5.7M20 4v7h-7',
  up: 'M12 19V5M5 12l7-7 7 7',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  copy: 'M9 9h10v10H9V9zM5 15V5h10',
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3z',
};

export function Icon({ name, className = 'h-4 w-4' }: { name: keyof typeof ICONS | string; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={ICONS[name] ?? ''} />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Navigation helpers                                                   */
/* ------------------------------------------------------------------ */

const JUMP_EVENT = 'pm:jump';

/** Scroll to a section by id — opening it first if it was collapsed. */
export function jumpTo(id: string) {
  window.dispatchEvent(new CustomEvent(JUMP_EVENT, { detail: id }));
  // Sections that aren't <Section> (plain anchors) still work:
  requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
}

/** Switch to another PM tab (the tab lives in the URL: ?tab=...). */
export function goTab(tab: string) {
  setUrlParams({ tab: tab === 'today' ? null : tab, project: null, ptab: null, task: null, sub: null, minute: null });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ------------------------------------------------------------------ */
/* Section — a collapsible, linkable block                              */
/* ------------------------------------------------------------------ */

const storeKey = (id: string) => `pm.section.${id}`;

export function Section({
  id,
  title,
  subtitle,
  count,
  tone = 'neutral',
  badges,
  actions,
  defaultOpen = true,
  persist = true,
  bare = false,
  children,
}: {
  id: string;
  title: string;
  subtitle?: ReactNode;
  count?: number | string;
  tone?: Tone;
  /** Small summary chips shown on the right of the header (visible even when collapsed). */
  badges?: ReactNode;
  /** Buttons shown in the header; clicking them doesn't toggle the section. */
  actions?: ReactNode;
  defaultOpen?: boolean;
  /** Remember open/closed in this browser. */
  persist?: boolean;
  /** No padding around the body (for tables / lists that go edge to edge). */
  bare?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState<boolean>(() => {
    if (!persist) return defaultOpen;
    try {
      const v = localStorage.getItem(storeKey(id));
      return v === null ? defaultOpen : v === '1';
    } catch {
      return defaultOpen;
    }
  });

  const set = useCallback(
    (next: boolean) => {
      setOpen(next);
      if (!persist) return;
      try {
        localStorage.setItem(storeKey(id), next ? '1' : '0');
      } catch {
        /* storage unavailable — state lasts for this visit */
      }
    },
    [id, persist]
  );

  useEffect(() => {
    const onJump = (e: Event) => {
      if ((e as CustomEvent<string>).detail === id) setOpen(true);
    };
    window.addEventListener(JUMP_EVENT, onJump);
    return () => window.removeEventListener(JUMP_EVENT, onJump);
  }, [id]);

  return (
    <section id={id} className="scroll-mt-16 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-transparent px-4 py-3 data-[open=true]:border-slate-100" data-open={open}>
        <span className={`h-5 w-1 shrink-0 rounded-full ${toneBar[tone]}`} aria-hidden />
        <button
          onClick={() => set(!open)}
          aria-expanded={open}
          aria-controls={`${id}-body`}
          className="flex min-w-0 flex-1 items-center gap-2 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
        >
          <span className="truncate text-sm font-semibold text-slate-900">{title}</span>
          {count !== undefined && count !== '' && <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${toneSoft[tone]}`}>{count}</span>}
          {subtitle && <span className="hidden truncate text-xs font-normal text-slate-500 md:inline">{subtitle}</span>}
        </button>

        <div className="flex flex-wrap items-center gap-1.5">
          {badges}
          {actions}
          <button
            onClick={() => set(!open)}
            aria-label={open ? `Collapse ${title}` : `Expand ${title}`}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <Icon name="chevron" className={`h-4 w-4 transition-transform ${open ? '' : '-rotate-90'}`} />
          </button>
        </div>
      </div>

      {/* Kept mounted (just hidden) so form text and filters survive a collapse. */}
      <div id={`${id}-body`} hidden={!open} className={bare ? '' : 'px-4 pb-4 pt-3'}>
        {children}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Sticky "Jump to" bar with scroll-spy                                 */
/* ------------------------------------------------------------------ */

export interface JumpItem {
  id: string;
  label: string;
  count?: number | string;
  tone?: Tone;
}

export function JumpNav({ items }: { items: JumpItem[] }) {
  const [active, setActive] = useState<string>(items[0]?.id ?? '');
  const ids = items.map((i) => i.id).join('|');
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const seen = new Map<string, boolean>();
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => seen.set(e.target.id, e.isIntersecting));
        const first = items.find((i) => seen.get(i.id));
        if (first) setActive(first.id);
      },
      { rootMargin: '-64px 0px -55% 0px', threshold: 0 }
    );
    items.forEach((i) => {
      const el = document.getElementById(i.id);
      if (el) io.observe(el);
    });
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);

  // Keep the active pill visible when the bar scrolls sideways on small screens.
  useEffect(() => {
    scroller.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [active]);

  if (items.length === 0) return null;

  return (
    <nav aria-label="Sections" className="sticky top-0 z-20 -mx-1 rounded-xl border border-slate-200 bg-white/90 px-2 py-1.5 shadow-sm backdrop-blur">
      <div ref={scroller} className="flex items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          title="Back to top"
          aria-label="Back to top"
        >
          <Icon name="up" className="h-4 w-4" />
        </button>
        <span className="mx-1 hidden h-5 w-px shrink-0 bg-slate-200 sm:block" />
        {items.map((i) => {
          const on = active === i.id;
          return (
            <button
              key={i.id}
              data-active={on}
              onClick={() => {
                setActive(i.id);
                jumpTo(i.id);
              }}
              className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                on ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {i.label}
              {i.count !== undefined && i.count !== '' && (
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] leading-none ${on ? 'bg-indigo-100 text-indigo-700' : toneSoft[i.tone ?? 'neutral']}`}>{i.count}</span>
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

/* ------------------------------------------------------------------ */
/* PageHeader — the same top block on every tab                         */
/* ------------------------------------------------------------------ */

export interface QuickLink {
  label: string;
  tab: string;
}

export function PageHeader({
  title,
  description,
  icon,
  status,
  actions,
  links,
}: {
  title: string;
  description?: ReactNode;
  icon?: string;
  /** One line under the description — e.g. "Last synced 4 min ago". */
  status?: ReactNode;
  actions?: ReactNode;
  /** "Go to" shortcuts to other tabs. */
  links?: QuickLink[];
}) {
  return (
    <header className="rounded-xl border border-slate-200 bg-gradient-to-br from-white to-indigo-50/40 p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          {icon && (
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm">
              <Icon name={icon} className="h-5 w-5" />
            </span>
          )}
          <div className="min-w-0">
            <h1 className="text-lg font-semibold leading-tight text-slate-900 sm:text-xl">{title}</h1>
            {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
            {status && <div className="mt-1 text-xs text-slate-500">{status}</div>}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>

      {links && links.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-slate-200/70 pt-3">
          <span className="mr-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">Go to</span>
          {links.map((l) => (
            <button
              key={l.tab}
              onClick={() => goTab(l.tab)}
              className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600 hover:border-indigo-300 hover:text-indigo-700"
            >
              {l.label}
              <Icon name="arrow" className="h-3 w-3" />
            </button>
          ))}
        </div>
      )}
    </header>
  );
}

/* ------------------------------------------------------------------ */
/* Small building blocks                                                */
/* ------------------------------------------------------------------ */

const tileTone: Record<Tone, { idle: string; value: string }> = {
  neutral: { idle: 'border-slate-200 bg-white hover:border-slate-300', value: 'text-slate-900' },
  brand: { idle: 'border-indigo-200 bg-indigo-50 hover:border-indigo-300', value: 'text-indigo-700' },
  danger: { idle: 'border-red-200 bg-red-50 hover:border-red-300', value: 'text-red-700' },
  warn: { idle: 'border-amber-200 bg-amber-50 hover:border-amber-300', value: 'text-amber-700' },
  ok: { idle: 'border-emerald-200 bg-emerald-50 hover:border-emerald-300', value: 'text-emerald-700' },
  info: { idle: 'border-sky-200 bg-sky-50 hover:border-sky-300', value: 'text-sky-700' },
};

/** A number that can be clicked (filter, jump, or open something). */
export function StatTile({
  label,
  value,
  hint,
  tone = 'neutral',
  size = 'md',
  active = false,
  onClick,
}: {
  label: string;
  value: number | string;
  hint?: string;
  tone?: Tone;
  size?: 'md' | 'lg';
  active?: boolean;
  onClick?: () => void;
}) {
  const t = tileTone[tone];
  const body = (
    <>
      <div className={`text-xs font-medium ${active ? 'text-indigo-100' : 'text-slate-500'}`}>{label}</div>
      <div className={`mt-0.5 font-semibold tabular-nums ${size === 'lg' ? 'text-4xl' : 'text-2xl'} ${active ? 'text-white' : t.value}`}>{value}</div>
      {hint && <div className={`mt-0.5 text-[11px] ${active ? 'text-indigo-100' : 'text-slate-400'}`}>{hint}</div>}
    </>
  );
  const cls = `rounded-xl border p-3 text-left transition sm:p-4 ${active ? 'border-indigo-600 bg-indigo-600 shadow-md' : t.idle}`;

  return onClick ? (
    <button onClick={onClick} aria-pressed={active} className={`${cls} focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1`}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function Pill({ tone = 'neutral', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${toneSoft[tone]}`}>
      {children}
    </span>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/60 px-4 py-8 text-center">
      <div className="text-sm font-medium text-slate-700">{title}</div>
      {children && <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">{children}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function Notice({ tone = 'info', children }: { tone?: Tone; children: ReactNode }) {
  const cls: Record<Tone, string> = {
    neutral: 'bg-slate-50 text-slate-700 border-slate-200',
    brand: 'bg-indigo-50 text-indigo-800 border-indigo-200',
    danger: 'bg-red-50 text-red-700 border-red-200',
    warn: 'bg-amber-50 text-amber-800 border-amber-200',
    ok: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    info: 'bg-sky-50 text-sky-800 border-sky-200',
  };
  return <div className={`rounded-lg border px-3 py-2 text-sm ${cls[tone]}`}>{children}</div>;
}
