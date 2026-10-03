import { useCallback, useEffect, useState } from 'react';

/**
 * Tiny URL-backed state for the /pm page. The whole PM dashboard is one
 * Inertia page, so navigation inside it (tab → project → project tab → task →
 * sub-task) used to live only in React state and the address bar never moved.
 * This keeps that state in the query string instead:
 *
 *   /pm?tab=projects&project=<id>&ptab=tasks&task=<id>&sub=<id>
 *
 * so Back/Forward, reload and copy-paste links all work. It uses the History
 * API directly (no Inertia visit), so nothing is re-fetched from the server
 * just because the URL changed.
 */

const EVENT = 'pm:urlchange';

export type UrlPatch = Record<string, string | null | undefined>;

const read = () => (typeof window === 'undefined' ? new URLSearchParams() : new URLSearchParams(window.location.search));

export function setUrlParams(patch: UrlPatch, opts: { replace?: boolean } = {}) {
  const params = read();
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined || v === '') params.delete(k);
    else params.set(k, v);
  }
  const qs = params.toString();
  const url = `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`;
  if (url === `${window.location.pathname}${window.location.search}${window.location.hash}`) return;
  // Reuse the current history.state so Inertia's own bookkeeping stays valid.
  const method = opts.replace ? 'replaceState' : 'pushState';
  window.history[method](window.history.state, '', url);
  window.dispatchEvent(new Event(EVENT));
}

export function useUrlParam(key: string): string | null {
  const [value, setValue] = useState<string | null>(() => read().get(key));

  useEffect(() => {
    const sync = () => setValue(read().get(key));
    sync();
    window.addEventListener('popstate', sync);
    window.addEventListener(EVENT, sync);
    return () => {
      window.removeEventListener('popstate', sync);
      window.removeEventListener(EVENT, sync);
    };
  }, [key]);

  return value;
}

export function useSetUrlParams() {
  return useCallback((patch: UrlPatch, opts?: { replace?: boolean }) => setUrlParams(patch, opts), []);
}
