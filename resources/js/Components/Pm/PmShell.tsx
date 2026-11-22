import { Link, usePage } from '@inertiajs/react';
import axios from 'axios';
import { useEffect, useState, type ReactNode } from 'react';
import ScrollToTop from '@/Components/ScrollToTop';
import AssistantBubble from '@/Components/Pm/AssistantBubble';
import { Icon } from '@/Components/Pm/ui/kit';
import { PM_PAGES, visitPm, type PmPage } from '@/lib/pmNav';

/** Sidebar icons + the one-line description shown under each page title. */
export const PM_LOOK: Record<PmPage, { icon: string; blurb: string }> = {
  today: { icon: 'grid', blurb: 'What needs your attention right now' },
  tasks: { icon: 'list', blurb: 'Every task and completed subtask across projects' },
  operations: { icon: 'inbox', blurb: 'Capture, review and organise incoming requests' },
  projects: { icon: 'folder', blurb: 'Projects, tasks, members and documents' },
  minutes: { icon: 'clock', blurb: 'Capture meetings and turn them into work' },
  brief: { icon: 'notes', blurb: 'Draft a brief and push it to Taskmandu as tickets' },
  reports: { icon: 'chart', blurb: 'Progress and delivery reporting' },
  scope: { icon: 'target', blurb: 'Check requests against agreed scope' },
  git: { icon: 'branch', blurb: 'Repository activity and delivery signals' },
  'qa-reports': { icon: 'notes', blurb: 'Build developer-ready reports from recorded QA findings' },
  qa: { icon: 'target', blurb: 'Verify completed Taskmandu tasks and retest fixes' },
  checklist: { icon: 'check-square', blurb: 'Your repeatable daily PM routine' },
  'action-list': { icon: 'clipboard-list', blurb: 'Your personal follow-ups, rough notes and unresolved items' },
};

const GROUPS: { title: string; keys: PmPage[] }[] = [
  { title: '1 · Daily workflow', keys: ['today', 'tasks', 'minutes', 'projects', 'operations', 'brief', 'reports'] },
  { title: '2 · Quality assurance', keys: ['qa-reports', 'qa'] },
  { title: '3 · Project controls', keys: ['scope', 'git'] },
  { title: '4 · Daily routine', keys: ['checklist', 'action-list'] },
];

interface Props {
  page: PmPage;
  /** Overdue + blocked tasks; shown as a badge on the Command center link. */
  attention?: number;
  onOpenSearch: () => void;
  /** Global project (business) switcher. Hidden when there are no options. */
  businesses?: { id: string; name: string }[];
  businessId?: string;
  onBusinessChange?: (id: string) => void;
  children: ReactNode;
}

function NavItems({ page, attention, onGo }: { page: PmPage; attention: number; onGo?: () => void }) {
  return (
    <nav aria-label="Company operations sections" className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
      {GROUPS.map((group) => (
        <div key={group.title}>
          <div className="mb-1.5 px-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{group.title}</div>
          <ul className="space-y-0.5">
            {group.keys.map((key) => {
              const p = PM_PAGES.find((item) => item.key === key)!;
              const on = key === page;
              const badge = key === 'today' ? attention : 0;
              return (
                <li key={key}>
                  <a
                    href={p.href}
                    aria-current={on ? 'page' : undefined}
                    onClick={(e) => {
                      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                      e.preventDefault();
                      visitPm(key, on ? {} : undefined);
                      onGo?.();
                    }}
                    className={`group flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
                      on ? 'bg-white/10 text-white' : 'text-slate-400 hover:bg-white/5 hover:text-slate-100'
                    }`}
                  >
                    <Icon name={PM_LOOK[key].icon} className={`h-[18px] w-[18px] shrink-0 ${on ? 'text-indigo-300' : 'text-slate-500 group-hover:text-slate-300'}`} />
                    <span className="min-w-0 flex-1 truncate">{p.label}</span>
                    {badge > 0 && <span className="rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">{badge}</span>}
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function Brand() {
  return (
    <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-white/10 px-5">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500 text-white">
        <Icon name="grid" className="h-[18px] w-[18px]" />
      </span>
      <div className="min-w-0 leading-tight">
        <div className="truncate text-sm font-semibold text-white">Company Operations</div>
        <div className="text-[11px] text-slate-400">Project management</div>
      </div>
    </div>
  );
}

function UserCard({ name, email }: { name: string; email: string }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '?';
  return (
    <div className="shrink-0 border-t border-white/10 p-3">
      <div className="flex items-center gap-3 rounded-lg px-2 py-1.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-700 text-xs font-semibold text-slate-100">{initials}</span>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-sm font-medium text-slate-100">{name}</div>
          <div className="truncate text-xs text-slate-400">{email}</div>
        </div>
      </div>
      <div className="mt-1 grid grid-cols-2 gap-1">
        <Link href={route('profile.edit')} className="flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-slate-400 hover:bg-white/5 hover:text-slate-100">
          <Icon name="user" className="h-3.5 w-3.5" /> Profile
        </Link>
        <Link href={route('logout')} method="post" as="button" className="flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-slate-400 hover:bg-white/5 hover:text-slate-100">
          <Icon name="logout" className="h-3.5 w-3.5" /> Log out
        </Link>
      </div>
    </div>
  );
}

/**
 * The frame around the whole PM dashboard: a fixed dark sidebar on desktop, a top bar with a slide-over
 * menu on phones/tablets, and a sticky page header (title, search, shortcut) over the content.
 */
export default function PmShell({ page, attention = 0, onOpenSearch, businesses = [], businessId = 'all', onBusinessChange, children }: Props) {
  const user = usePage().props.auth.user;
  const [drawer, setDrawer] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [captureKind, setCaptureKind] = useState<'Action' | 'Rough note'>('Action');
  const [captureTitle, setCaptureTitle] = useState('');
  const [captureNotes, setCaptureNotes] = useState('');
  const [captureSaving, setCaptureSaving] = useState(false);
  const [captureError, setCaptureError] = useState('');
  const saveCapture = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!captureTitle.trim()) return;
    setCaptureSaving(true); setCaptureError('');
    try {
      await axios.post('/pm/api/action-items', { kind: captureKind, title: captureTitle.trim(), notes: captureNotes.trim() || null, source: current.label, priority: 'Medium' });
      setCaptureTitle(''); setCaptureNotes(''); setCaptureOpen(false);
    } catch { setCaptureError('Could not save this capture. Please try again.'); }
    finally { setCaptureSaving(false); }
  };
  const current = PM_PAGES.find((p) => p.key === page)!;

  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrawer(false);
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [drawer]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col bg-slate-900 lg:flex">
        <Brand />
        <NavItems page={page} attention={attention} />
        <UserCard name={user.name} email={user.email} />
      </aside>

      {/* Mobile / tablet drawer */}
      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-slate-950/50" onClick={() => setDrawer(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-slate-900 shadow-2xl">
            <div className="flex items-center justify-between pr-3">
              <Brand />
              <button type="button" aria-label="Close menu" onClick={() => setDrawer(false)} className="rounded-lg p-2 text-slate-400 hover:bg-white/10 hover:text-white">
                <Icon name="close" className="h-5 w-5" />
              </button>
            </div>
            <NavItems page={page} attention={attention} onGo={() => setDrawer(false)} />
            <UserCard name={user.name} email={user.email} />
          </aside>
        </div>
      )}

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-slate-200 bg-white/90 px-3 backdrop-blur sm:px-6">
          <button type="button" aria-label="Open menu" onClick={() => setDrawer(true)} className="-ml-1 rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden">
            <Icon name="menu" className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-semibold tracking-tight text-slate-900">{current.label}</h1>
            <p className="hidden truncate text-xs text-slate-500 sm:block">{PM_LOOK[page].blurb}</p>
          </div>
          {onBusinessChange && businesses.length > 0 && (
            <label className="flex shrink-0 items-center gap-2">
              <span className="sr-only">Project</span>
              <select
                value={businessId}
                onChange={(e) => onBusinessChange(e.target.value)}
                aria-label="Project"
                className={`max-w-[11rem] rounded-lg border px-2.5 py-1.5 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 sm:max-w-[14rem] ${
                  businessId === 'all' ? 'border-slate-200 bg-slate-50 text-slate-600' : 'border-indigo-300 bg-indigo-50 text-indigo-800'
                }`}
              >
                <option value="all">All projects</option>
                {businesses.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </label>
          )}
          <button type="button" onClick={() => setCaptureOpen(true)} className="shrink-0 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700">+ Capture</button>
          <button
            type="button"
            onClick={onOpenSearch}
            className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-sm text-slate-500 transition hover:border-slate-300 hover:bg-white sm:w-64 md:w-72"
            aria-label="Search"
          >
            <Icon name="search" className="h-4 w-4 shrink-0" />
            <span className="hidden flex-1 truncate text-left sm:block">Search or ask the assistant…</span>
            <kbd className="hidden rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-500 md:inline">Ctrl K</kbd>
          </button>
        </header>

        <main className="mx-auto w-full max-w-[1400px] px-3 py-4 sm:px-6 sm:py-6">{children}</main>
      </div>

      {captureOpen && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50 p-3" role="dialog" aria-modal="true" aria-label="Capture follow-up" onMouseDown={(e) => { if (e.target === e.currentTarget) setCaptureOpen(false); }}>
        <form onSubmit={saveCapture} className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl">
          <div className="flex items-start justify-between gap-3"><div><h2 className="text-lg font-semibold text-slate-900">Capture for later</h2><p className="mt-1 text-xs text-slate-500">Captured from: {current.label}</p></div><button type="button" onClick={() => setCaptureOpen(false)} className="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-100">✕</button></div>
          <div className="mt-4 flex gap-2">{(['Action', 'Rough note'] as const).map((v) => <button key={v} type="button" onClick={() => setCaptureKind(v)} className={`rounded-lg px-3 py-2 text-sm font-semibold ${captureKind === v ? 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200' : 'bg-slate-100 text-slate-600'}`}>{v}</button>)}</div>
          <label className="mt-4 block text-xs font-semibold text-slate-600">{captureKind === 'Action' ? 'What needs to be checked or done?' : 'What did you notice or want to remember?'}</label>
          <input autoFocus required maxLength={200} value={captureTitle} onChange={(e) => setCaptureTitle(e.target.value)} placeholder={captureKind === 'Action' ? 'e.g. Follow up on delayed task' : 'e.g. Clarify broker commission requirements'} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100" />
          <textarea value={captureNotes} onChange={(e) => setCaptureNotes(e.target.value)} rows={4} placeholder="Add rough context, questions, people to ask, or what to investigate later…" className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100" />
          {captureError && <p role="alert" className="mt-2 text-sm text-rose-600">{captureError}</p>}
          <div className="mt-4 flex justify-end gap-2"><button type="button" onClick={() => setCaptureOpen(false)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600">Cancel</button><button disabled={captureSaving || !captureTitle.trim()} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{captureSaving ? 'Saving…' : 'Save capture'}</button></div>
        </form>
      </div>}
      <ScrollToTop raised />
      <AssistantBubble />
    </div>
  );
}
