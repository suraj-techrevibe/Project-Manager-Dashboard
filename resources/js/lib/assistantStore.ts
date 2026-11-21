import { useSyncExternalStore } from 'react';
import { pmApi } from '@/lib/pmApi';
import type { AssistantAction, AssistantEngine, AssistantStatus } from '@/types/pm';

/**
 * One shared assistant chat for the whole PM: the floating bubble (every page) and the full
 * "AI assistant" page read and write the same conversation, so they never disagree.
 */

export interface Msg {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  actions?: AssistantAction[];
  tools?: string[];
  suggestions?: string[];
  /** Who answered: the built-in rules, or the AI model. */
  engine?: AssistantEngine;
  /** Exact model ID returned by the provider for this answer. */
  model?: string;
  error?: boolean;
  /** Result notes ("✓ Done: …") — shown as a small status line and fed back to the model as context. */
  note?: boolean;
}

interface State {
  messages: Msg[];
  busy: boolean;
  open: boolean;
  unread: number;
  /** True while the full assistant page is on screen (the bubble hides itself and nothing counts as unread). */
  viewing: boolean;
  status: AssistantStatus | null;
}

const MSGS = 'pm.assistant.v1';
const OPEN = 'pm.assistant.open';
const uid = () => Math.random().toString(36).slice(2, 10);

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or unavailable — the chat still works for this visit */
  }
}

let state: State = {
  messages: read<Msg[]>(MSGS, []).map((m) => (m.actions?.some((a) => a.status === 'running') ? { ...m, actions: m.actions.map((a) => (a.status === 'running' ? { ...a, status: 'pending' as const } : a)) } : m)),
  busy: false,
  open: read<boolean>(OPEN, false),
  unread: 0,
  viewing: false,
  status: null,
};

const listeners = new Set<() => void>();

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  if ('messages' in patch) write(MSGS, state.messages.slice(-40));
  if ('open' in patch) write(OPEN, state.open);
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

const getState = () => state;

/* ---------- actions ---------- */

export function setOpen(open: boolean) {
  set({ open, unread: open ? 0 : state.unread });
}

export function setViewing(viewing: boolean) {
  set({ viewing, unread: viewing ? 0 : state.unread });
}

export function clearChat() {
  if (!state.busy) set({ messages: [], unread: 0 });
}

export async function loadStatus() {
  if (state.status) return;
  try {
    const { data } = await pmApi.assistantStatus();
    set({ status: data });
  } catch {
    /* the label just stays generic */
  }
}

function patchAction(msgId: string, actionId: string, patch: Partial<AssistantAction>) {
  set({ messages: state.messages.map((m) => (m.id === msgId ? { ...m, actions: m.actions?.map((a) => (a.id === actionId ? { ...a, ...patch } : a)) } : m)) });
}

export async function send(text: string) {
  const q = text.trim();
  if (!q || state.busy) return;
  const next: Msg[] = [...state.messages.filter((m) => !m.error), { id: uid(), role: 'user', content: q }];
  set({ messages: next, busy: true });
  try {
    const history = next.slice(-20).map((m) => ({ role: m.role, content: m.content }));
    const { data } = await pmApi.assistantChat(history);
    const reply: Msg = { id: uid(), role: 'assistant', content: data.reply, actions: data.actions, tools: data.tools, suggestions: data.suggestions, engine: data.engine, model: data.model };
    set({ messages: [...state.messages, reply], busy: false, unread: !state.open && !state.viewing ? state.unread + 1 : state.unread });
  } catch (e) {
    const msg = (e as { response?: { data?: { error?: string; message?: string } } })?.response?.data;
    set({
      messages: [...state.messages, { id: uid(), role: 'assistant', error: true, content: msg?.error ?? msg?.message ?? "Couldn't reach the assistant. Check your connection and try again." }],
      busy: false,
    });
  }
}

/** Open the bubble and ask — used by the search palette. */
export function ask(text: string) {
  setOpen(true);
  void send(text);
}

export async function runAction(msgId: string, a: AssistantAction, kind: 'confirm' | 'cancel') {
  patchAction(msgId, a.id, { status: 'running' });
  try {
    const { data } = kind === 'confirm' ? await pmApi.assistantConfirm(a.id) : await pmApi.assistantCancel(a.id);
    patchAction(msgId, a.id, { status: data.status, message: data.message });
    const line = data.status === 'done' ? `✓ Done: ${a.summary}` : data.status === 'cancelled' ? `Cancelled: ${a.summary}` : `✗ Failed: ${a.summary} — ${data.message}`;
    set({ messages: [...state.messages, { id: uid(), role: 'assistant', content: line, note: true }] });
  } catch (e) {
    const err = (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Something went wrong.';
    patchAction(msgId, a.id, { status: 'failed', message: err });
  }
}

export async function runAll(m: Msg) {
  for (const a of m.actions?.filter((x) => x.status === 'pending') ?? []) await runAction(m.id, a, 'confirm');
}

/* ---------- hook ---------- */

export function useAssistant() {
  const s = useSyncExternalStore(subscribe, getState, getState);
  const pending = s.messages.reduce((n, m) => n + (m.actions?.filter((a) => a.status === 'pending').length ?? 0), 0);
  return { ...s, pending };
}
