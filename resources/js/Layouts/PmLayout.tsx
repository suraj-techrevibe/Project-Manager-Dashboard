import { Head, Link } from '@inertiajs/react';
import type { ReactNode } from 'react';
import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout';
import { PM_PAGES, type PmPage } from '@/lib/pmNav';

/** Shared chrome for every PM page: header + a row of real links, one per page. */
export default function PmLayout({ page, children }: { page: PmPage; children: ReactNode }) {
  const current = PM_PAGES.find((p) => p.key === page)!;

  return (
    <AuthenticatedLayout header={<h2 className="text-lg font-medium text-slate-800">PM agent</h2>}>
      <Head title={`${current.label} · PM agent`} />

      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <nav aria-label="PM sections" className="mb-4 flex flex-wrap gap-1.5">
          {PM_PAGES.map((p) => (
            <Link
              key={p.key}
              href={p.href}
              aria-current={p.key === page ? 'page' : undefined}
              className={`rounded-md px-3 py-1.5 text-sm ${
                p.key === page ? 'bg-slate-900 text-white' : 'border border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {p.label}
            </Link>
          ))}
        </nav>

        {children}
      </div>
    </AuthenticatedLayout>
  );
}
