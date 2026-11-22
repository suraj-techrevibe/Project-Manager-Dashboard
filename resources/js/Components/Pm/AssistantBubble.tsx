import { useEffect, type KeyboardEvent } from 'react';
import { ChatBody } from '@/Components/Pm/AssistantPanel';
import { Icon } from '@/Components/Pm/ui/kit';
import { clearChat, loadStatus, setOpen, useAssistant } from '@/lib/assistantStore';

/**
 * The assistant, always one click away: its button lives in the bottom dock (bottom-right) on every PM page and opens
 * this chat window above it.
 * Ctrl/Cmd + / toggles it; Esc minimises.
 */
export default function AssistantBubble() {
  const { open, unread, pending, busy, messages, status } = useAssistant();

  useEffect(() => {
    if (open) void loadStatus();
  }, [open]);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === '/') {
        e.preventDefault();
        setOpen(!open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const onPanelKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') setOpen(false);
  };

  const badge = pending > 0 ? pending : unread;

  return (
    <>
      {open && (
        <div
          role="dialog"
          aria-label="PM assistant"
          onKeyDown={onPanelKey}
          className="fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] right-3 z-40 flex h-[min(640px,calc(100dvh-9rem))] w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl sm:right-6 sm:w-[400px]"
        >
          <header className="flex items-center gap-2.5 border-b border-slate-100 bg-white px-3 py-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 ring-1 ring-inset ring-indigo-100">
              <Icon name="spark" className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1 leading-tight">
              <div className="truncate text-sm font-semibold text-slate-900">PM assistant</div>
              <div className="truncate text-[11px] text-slate-500">{status?.label ?? 'Gemini'}</div>
            </div>
            {messages.length > 0 && (
              <button type="button" onClick={clearChat} disabled={busy} className="rounded-lg px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 disabled:opacity-50">
                New
              </button>
            )}
            <button
              type="button"
              title="Minimise (Esc)"
              aria-label="Minimise assistant"
              onClick={() => setOpen(false)}
              className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
          </header>
          <ChatBody active={open} compact />
        </div>
      )}

    </>
  );
}
