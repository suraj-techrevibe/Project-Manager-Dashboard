import { useEffect, useState } from 'react';

/**
 * The PM dashboard is one Inertia page (Pages/Pm/App) that shows one panel per tab.
 * Each tab still has its own address (/pm, /pm/projects, ...) so Back / Forward / refresh /
 * bookmarks work, but switching tabs only changes the browser history and React state —
 * nothing is requested from Laravel. Nested state inside a tab (open project / task /
 * sub-task, selected meeting…) lives in that tab's query string, e.g.
 * /pm/projects?project=<id>&ptab=tasks&task=<id>&sub=<id>.
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

/** Fired after every URL change made by the app (tab switch or query-string change). */
export const URL_EVENT = 'pm:urlchange';
const NAV_EVENT = 'pm:navigate';

type Params = Record<string, string | null | undefined>;

/** "/pm/projects" -> 'projects', "/pm" -> 'today'. */
export function pageFromPath(pathname: string = window.location.pathname): PmPage {
  const seg = pathname.replace(/\/+$/, '').split('/')[2];
  return seg && isPmPage(seg) ? seg : 'today';
}

const toSearch = (params: Params): string => {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => v && qs.set(k, v));
  const s = qs.toString();
  return s ? `?${s}` : '';
};

export function pmUrl(page: PmPage, params: Params = {}): string {
  return PM_PAGES.find((p) => p.key === page)!.href + toSearch(params);
}

/** Reuses Inertia's history.state (so its bookkeeping stays valid) but points its url at the new address. */
export function nextHistoryState(url: string): unknown {
  const s = window.history.state;
  return s && typeof s === 'object' && typeof (s as { url?: unknown }).url === 'string' ? { ...s, url } : s;
}

/** Where each tab was left (query string), so coming back to a tab restores its open project / meeting. */
const remembered: Partial<Record<PmPage, string>> = {};

/**
 * Switch tab without a server request.
 *  - params omitted  -> return to where that tab was left
 *  - params given    -> exactly those params ({} = the tab's start screen)
 */
export function visitPm(page: PmPage, params?: Params, opts: { replace?: boolean } = {}) {
  remembered[pageFromPath()] = window.location.search;

  const url = PM_PAGES.find((p) => p.key === page)!.href + (params ? toSearch(params) : (remembered[page] ?? ''));
  if (url === `${window.location.pathname}${window.location.search}`) return;

  window.history[opts.replace ? 'replaceState' : 'pushState'](nextHistoryState(url), '', url + window.location.hash);
  window.dispatchEvent(new Event(URL_EVENT));
  window.dispatchEvent(new Event(NAV_EVENT));
}

/** The tab the address bar is on right now. Updates on tab clicks and Back / Forward. */
export function usePmPage(initial: PmPage = 'today'): PmPage {
  const [page, setPage] = useState<PmPage>(() => (typeof window === 'undefined' ? initial : pageFromPath()));

  useEffect(() => {
    const sync = () => setPage(pageFromPath());
    sync();
    window.addEventListener('popstate', sync);
    window.addEventListener(NAV_EVENT, sync);
    return () => {
      window.removeEventListener('popstate', sync);
      window.removeEventListener(NAV_EVENT, sync);
    };
  }, []);

  return page;
}
