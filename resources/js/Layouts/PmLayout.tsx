import { Head, Link } from '@inertiajs/react';
import type { ReactNode } from 'react';
import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout';
import { Icon } from '@/Components/Pm/ui/kit';
import { PM_PAGES, type PmPage } from '@/lib/pmNav';

const LOOK: Record<PmPage, { icon: string; short: string }> = {
  today: { icon: 'sun', short: 'Today' },
  projects: { icon: 'folder', short: 'Projects' },
  minutes: { icon: 'notes', short: 'Minutes' },
  brief: { icon: 'list', short: 'Brief' },
  reports: { icon: 'chart', short: 'Reports' },
  scope: { icon: 'target', short: 'Scope' },
  git: { icon: 'branch', short: 'Git' },
};

/** Shared chrome for every PM page: header + a row of real links, one per page. */
export default function PmLayout({ page, attention = 0, children }: { page: PmPage; attention?: number; children: ReactNode }) {
  const current = PM_PAGES.find((p) => p.key === page)!;

  return (
    <AuthenticatedLayout header={<h2 className="text-lg font-semibold text-slate-800">PM agent</h2>}>
      <Head title={`${current.label} · PM agent`} />

      <div className="mx-auto max-w-6xl px-3 py-4 sm:px-6 sm:py-6">
        <nav aria-label="PM agent sections" className="mb-4 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {PM_PAGES.map((p) => {
              const on = p.key === page;
              const badge = p.key === 'today' ? attention : 0;
              return (
                <Link
                  key={p.key}
                  href={p.href}
                  aria-current={on ? 'page' : undefined}
                  className={`relative flex shrink-0 items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition ${
                    on
                      ? 'border-indigo-600 bg-indigo-50/60 text-indigo-700'
                      : 'border-transparent text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                  }`}
                >
                  <Icon name={LOOK[p.key].icon} className="h-4 w-4" />
                  <span className="hidden sm:inline">{p.label}</span>
                  <span className="sm:hidden">{LOOK[p.key].short}</span>
                  {badge > 0 && (
                    <span className="rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white" title="Overdue + blocked">
                      {badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        </nav>

        {children}
      </div>
    </AuthenticatedLayout>
  );
}
