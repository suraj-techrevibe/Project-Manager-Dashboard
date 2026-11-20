import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { clearChat, loadStatus, runAction, runAll, send, setViewing, useAssistant } from '@/lib/assistantStore';
import { Icon } from '@/Components/Pm/ui/kit';
import type { AssistantAction, AssistantEngine } from '@/types/pm';

const TOOL_LABEL: Record<string, string> = {
  board_overview: 'Checked board overview',
  search_tasks: 'Searched tasks',
  list_flags: 'Checked flags',
  team_workload: 'Checked workload',
  list_projects: 'Looked up projects',
  get_project: 'Opened a project',
  list_employees: 'Looked up people',
  list_intakes: 'Checked requests & ideas',
  list_meeting_minutes: 'Searched meeting minutes',
  recent_activity: 'Checked recent activity',
  lookup_pm_data: 'Looked up PM data',
  meeting_follow_up: 'Checked meeting follow-up',
};

const TOOL_NAME: Record<string, string> = {
  create_task: 'Create task',
  update_task: 'Update task',
  add_task_comment: 'Add comment',
  create_subtask: 'Add sub-task',
  update_subtask: 'Update sub-task',
  create_intake: 'Log request / idea',
  snooze_task: 'Snooze task',
  sync_board: 'Sync from Taskmandu',
};

const SUGGESTIONS: { title: string; items: string[] }[] = [
  { title: 'Ask', items: ['Give me an overview', "What's overdue?", 'Show meeting templates', 'What did we decide in the last meeting?', 'Open QA issues', 'What do you know?'] },
  { title: 'Do', items: ['Create task "…" in … due friday', 'Mark "…" as done', 'Log a client request: …', 'Move all my overdue tasks to next monday'] },
];

/* ---------- tiny, safe markdown (bold, code, bullets, numbers) ---------- */

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) return <code key={i} className="rounded bg-slate-100 px-1 py-0.5 text-[0.85em]">{part.slice(1, -1)}</code>;
    return part;
  });
}

function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const Tag = list.ordered ? 'ol' : 'ul';
    blocks.push(
      <Tag key={blocks.length} className={`my-1.5 space-y-1 pl-5 ${list.ordered ? 'list-decimal' : 'list-disc'}`}>
        {list.items.map((it, i) => <li key={i}>{inline(it)}</li>)}
      </Tag>
    );
    list = null;
  };

  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    const number = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (bullet || number) {
      const ordered = Boolean(number);
      if (!list || list.ordered !== ordered) { flush(); list = { ordered, items: [] }; }
      list.items.push((bullet ?? number)![1]);
    } else {
      flush();
      if (line.trim()) blocks.push(<p key={blocks.length} className="my-1.5 first:mt-0 last:mb-0">{inline(line.replace(/^#{1,6}\s+/, ''))}</p>);
    }
  }
  flush();
  return <div className="break-words text-sm leading-relaxed text-slate-800">{blocks}</div>;
}

/* ---------- action card ---------- */

const fmtKey = (k: string) => k.replace(/_/g, ' ');
const fmtVal = (v: unknown) => (Array.isArray(v) ? v.join(', ') : typeof v === 'object' && v ? JSON.stringify(v) : String(v));

function ActionCard({ a, onConfirm, onCancel }: { a: AssistantAction; onConfirm: () => void; onCancel: () => void }) {
  const entries = Object.entries(a.details ?? {}).filter(([, v]) => v !== null && v !== '');
  const tone =
    a.status === 'done' ? 'border-emerald-200 bg-emerald-50/60'
    : a.status === 'failed' ? 'border-red-200 bg-red-50/60'
    : a.status === 'cancelled' ? 'border-slate-200 bg-slate-50'
    : 'border-indigo-200 bg-indigo-50/50';

  return (
    <div className={`mt-2 rounded-xl border p-3 ${tone}`}>
      <div className="flex items-start gap-2">
        <span className="mt-0.5 rounded-md bg-white px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-700 ring-1 ring-inset ring-indigo-100">{TOOL_NAME[a.tool] ?? a.tool}</span>
        <p className="min-w-0 flex-1 text-sm font-medium text-slate-900">{a.summary}</p>
      </div>

      {entries.length > 0 && (
        <details className="mt-2 text-xs text-slate-600">
          <summary className="cursor-pointer select-none text-slate-500 hover:text-slate-800">Details</summary>
          <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            {entries.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="capitalize text-slate-400">{fmtKey(k)}</dt>
                <dd className="min-w-0 break-words">{fmtVal(v)}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {a.status === 'pending' && (
          <>
            <button type="button" onClick={onConfirm} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700">Confirm</button>
            <button type="button" onClick={onCancel} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
            <span className="text-[11px] text-slate-400">Nothing changes until you confirm.</span>
          </>
        )}
        {a.status === 'running' && <span className="text-xs text-slate-500">Applying…</span>}
        {a.status === 'done' && <span className="text-xs font-semibold text-emerald-700">✓ Done</span>}
        {a.status === 'cancelled' && <span className="text-xs text-slate-500">Cancelled</span>}
        {a.status === 'failed' && <span className="text-xs font-medium text-red-700">{a.message ?? 'Failed'}</span>}
      </div>
    </div>
  );
}

/* ---------- who answered ---------- */

const ENGINE: Record<AssistantEngine, { label: string; tone: string }> = {
  builtin: { label: 'Built-in', tone: 'bg-slate-100 text-slate-600 ring-slate-200' },
  gemini: { label: 'Gemini', tone: 'bg-sky-50 text-sky-700 ring-sky-200' },
  claude: { label: 'Claude', tone: 'bg-amber-50 text-amber-700 ring-amber-200' },
};

export function EngineBadge({ engine }: { engine?: AssistantEngine }) {
  if (!engine || !ENGINE[engine]) return null;
  return (
    <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${ENGINE[engine].tone}`} title={engine === 'builtin' ? 'Answered by the built-in rules — no AI model' : `Answered by ${ENGINE[engine].label}`}>
      {ENGINE[engine].label}
    </span>
  );
}

/* ---------- the conversation + composer (shared by the page and the floating bubble) ---------- */

export function ChatBody({ active, compact = false }: { active: boolean; compact?: boolean }) {
  const { messages, busy, status } = useAssistant();
  const [input, setInput] = useState('');
  const scroller = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    void loadStatus();
  }, []);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy, active]);

  useEffect(() => {
    if (active) field.current?.focus({ preventScroll: true });
  }, [active]);

  // auto-grow composer
  useEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input]);

  const submit = (text: string) => {
    if (!text.trim() || busy) return;
    setInput('');
    void send(text);
  };

  const lastAssistantId = [...messages].reverse().find((m) => m.role === 'assistant' && !m.note)?.id;

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit(input);
    }
  };

  const empty = messages.length === 0;
  const groups = compact ? SUGGESTIONS.map((g) => ({ ...g, items: g.items.slice(0, 3) })) : SUGGESTIONS;

  return (
    <>
      <div ref={scroller} className="flex-1 space-y-4 overflow-y-auto bg-slate-50/50 px-3 py-4 sm:px-5" aria-live="polite">
        {empty && (
          <div className={`mx-auto max-w-2xl ${compact ? 'py-1' : 'py-4 sm:py-8'}`}>
            <h2 className={`${compact ? 'text-base' : 'text-lg'} font-semibold tracking-tight text-slate-900`}>What do you want to know or do?</h2>
            <p className="mt-1 text-sm text-slate-500">
              Ask about tasks, people, projects, requests, meetings, templates, reports or QA — or tell me to create, assign, update or log things. I show every change and wait for your confirmation. Type “help” for everything I understand.
            </p>
            <div className={`mt-4 grid gap-4 ${compact ? '' : 'sm:grid-cols-2'}`}>
              {groups.map((g) => (
                <div key={g.title}>
                  <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{g.title}</div>
                  <div className="space-y-1.5">
                    {g.items.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => (s.includes('…') ? (setInput(s), field.current?.focus()) : submit(s))}
                        className="block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm text-slate-700 transition hover:border-indigo-300 hover:bg-indigo-50/50"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, idx) =>
          m.note ? (
            <div key={m.id} className="text-center text-xs text-slate-500">{m.content}</div>
          ) : m.role === 'user' ? (
            <div key={m.id} className="flex justify-end">
              <div className="max-w-[88%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-indigo-600 px-3.5 py-2 text-sm text-white shadow-sm sm:max-w-[75%]">{m.content}</div>
            </div>
          ) : (
            <div key={m.id} className="flex items-start gap-2.5">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-indigo-600 ring-1 ring-slate-200">
                <Icon name="spark" className="h-3.5 w-3.5" />
              </span>
              <div className="min-w-0 max-w-[92%] flex-1 sm:max-w-[82%]">
                {m.tools && m.tools.length > 0 && (
                  <div className="mb-1.5 flex flex-wrap gap-1">
                    {m.tools.filter((t) => TOOL_LABEL[t]).map((t) => (
                      <span key={t} className="rounded-full bg-white px-2 py-0.5 text-[10px] font-medium text-slate-500 ring-1 ring-inset ring-slate-200">{TOOL_LABEL[t]}</span>
                    ))}
                  </div>
                )}
                <div className={`rounded-2xl rounded-tl-md border px-3.5 py-2.5 shadow-sm ${m.error ? 'border-red-200 bg-red-50 text-red-800' : 'border-slate-200 bg-white'}`}>
                  {m.error ? <p className="text-sm">{m.content}</p> : <Markdown text={m.content} />}
                </div>
                {!m.error && m.engine && (
                  <div className="mt-1 flex flex-wrap items-center gap-2 pl-1">
                    <EngineBadge engine={m.engine} />
                    {m.engine === 'builtin' && status?.ai_ready && !busy && messages[idx - 1]?.role === 'user' && (
                      <button
                        type="button"
                        onClick={() => submit(`/ai ${messages[idx - 1].content.replace(/^\/ai\s+/i, '')}`)}
                        className="text-[11px] font-medium text-sky-700 hover:underline"
                      >
                        Not right? Ask {status.provider === 'anthropic' ? 'Claude' : 'Gemini'} instead
                      </button>
                    )}
                  </div>
                )}
                {(m.actions?.filter((a) => a.status === 'pending').length ?? 0) > 1 && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <button type="button" onClick={() => void runAll(m)} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700">
                      Confirm all {m.actions!.filter((a) => a.status === 'pending').length}
                    </button>
                    <span className="text-[11px] text-slate-400">or review each one below</span>
                  </div>
                )}
                {m.actions?.map((a) => (
                  <ActionCard key={a.id} a={a} onConfirm={() => void runAction(m.id, a, 'confirm')} onCancel={() => void runAction(m.id, a, 'cancel')} />
                ))}
                {!busy && m.id === lastAssistantId && m.suggestions && m.suggestions.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {m.suggestions.map((s) => (
                      <button key={s} type="button" onClick={() => submit(s)} className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600 transition hover:border-indigo-300 hover:text-indigo-700">
                        {s}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )
        )}

        {busy && (
          <div className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-indigo-600 ring-1 ring-slate-200"><Icon name="spark" className="h-3.5 w-3.5" /></span>
            <div className="flex items-center gap-1 rounded-2xl border border-slate-200 bg-white px-3.5 py-3 shadow-sm" role="status" aria-label="Assistant is working">
              {[0, 150, 300].map((d) => <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" style={{ animationDelay: `${d}ms` }} />)}
            </div>
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); submit(input); }}
        className="border-t border-slate-100 bg-white p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
      >
        <div className="flex items-end gap-2 rounded-xl border border-slate-200 bg-white p-1.5 focus-within:border-indigo-400 focus-within:ring-1 focus-within:ring-indigo-400">
          <textarea
            ref={field}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKey}
            rows={1}
            maxLength={4000}
            placeholder="Ask anything, or tell me what to do…"
            className="max-h-40 min-h-[2.25rem] flex-1 resize-none border-0 bg-transparent px-2 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-0"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            aria-label="Send"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Icon name="send" className="h-4 w-4" />
          </button>
        </div>
        {!compact && <p className="mt-1.5 px-1 text-[11px] text-slate-400">Enter to send · Shift+Enter for a new line. Always check a change before you confirm it.</p>}
      </form>
    </>
  );
}

/* ---------- full page ---------- */

export default function AssistantPanel({ active }: { active: boolean }) {
  const { messages, busy, status } = useAssistant();

  useEffect(() => {
    void loadStatus();
  }, []);

  // While this page is showing, the floating bubble steps aside.
  useEffect(() => {
    setViewing(active);
    return () => setViewing(false);
  }, [active]);

  return (
    <section className="mx-auto flex h-[calc(100dvh-8rem)] min-h-[420px] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 ring-1 ring-inset ring-indigo-100">
            <Icon name="spark" className="h-4 w-4" />
          </span>
          <div className="min-w-0 leading-tight">
            <div className="truncate text-sm font-semibold text-slate-900">PM assistant</div>
            <div className="truncate text-xs text-slate-500">{status?.label ?? 'Built-in assistant'} · reads live data · changes need your confirmation</div>
          </div>
        </div>
        {messages.length > 0 && (
          <button type="button" onClick={clearChat} disabled={busy} className="shrink-0 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50">
            New chat
          </button>
        )}
      </header>
      <ChatBody active={active} />
    </section>
  );
}
