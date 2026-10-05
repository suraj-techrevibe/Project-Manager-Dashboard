import { useState } from 'react';
import { pmApi } from '../../lib/pmApi';
import type { ScopeItem } from '../../types/pm';
import { EmptyState, JumpNav, Notice, PageHeader, Pill, Section, btnPrimary, btnSecondary } from './ui/kit';

const verdictClasses: Record<string, string> = {
  in_scope: 'bg-emerald-100 text-emerald-700',
  out_of_scope: 'bg-red-100 text-red-700',
  unclear: 'bg-amber-100 text-amber-800',
};

const verdictLabels: Record<string, string> = {
  in_scope: 'In scope',
  out_of_scope: 'Out of scope',
  unclear: 'Unclear',
};

export default function ScopeCheck() {
  const [brief, setBrief] = useState('');
  const [message, setMessage] = useState('');
  const [items, setItems] = useState<ScopeItem[] | null>(null);
  const [email, setEmail] = useState('');
  const [rate, setRate] = useState('');
  const [clientName, setClientName] = useState('');
  const [loading, setLoading] = useState(false);
  const [emailLoading, setEmailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function check() {
    if (!brief.trim() || !message.trim()) {
      setError('Add both the original brief and the new message');
      return;
    }
    setError(null);
    setLoading(true);
    setEmail('');
    try {
      const { data } = await pmApi.scopeCheck(brief, message);
      setItems(data.items);
    } finally {
      setLoading(false);
    }
  }

  async function draftEmail() {
    const outOfScope = items?.filter((i) => i.verdict === 'out_of_scope') ?? [];
    if (!outOfScope.length) return;
    setEmailLoading(true);
    try {
      const { data } = await pmApi.scopeEmail(outOfScope, clientName || undefined, rate || undefined);
      setEmail(data.email);
    } finally {
      setEmailLoading(false);
    }
  }

  const hasOutOfScope = items?.some((i) => i.verdict === 'out_of_scope');
  const tally = (v: string) => items?.filter((i) => i.verdict === v).length ?? 0;
  const field =
    'w-full resize-y rounded-lg border border-slate-300 p-2.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500';
  const input =
    'rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500';

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        icon="target"
        title="Scope check"
        description="Compare a new client message with the signed brief — spot extras before they become free work."
        links={[
          { label: 'Brief to tickets', tab: 'brief' },
          { label: 'Projects', tab: 'projects' },
        ]}
      />

      <JumpNav
        items={[
          { id: 'scope-compare', label: '1 · Compare' },
          ...(items ? [{ id: 'scope-results', label: '2 · Verdicts', count: items.length }] : []),
          ...(hasOutOfScope ? [{ id: 'scope-change', label: '3 · Change request', tone: 'warn' as const }] : []),
        ]}
      />

      <Section id="scope-compare" title="1 · Compare" subtitle="Paste the brief and what the client just asked for" tone="brand">
        <div className="grid gap-3 lg:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="scope-brief">
              Original signed brief
            </label>
            <textarea
              id="scope-brief"
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              placeholder="Paste the original scope / brief…"
              className={`${field} min-h-[120px]`}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="scope-message">
              New client message
            </label>
            <textarea
              id="scope-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Paste what the client just asked for…"
              className={`${field} min-h-[120px]`}
            />
          </div>
        </div>
        {error && (
          <div className="mt-3">
            <Notice tone="danger">{error}</Notice>
          </div>
        )}
        <div className="mt-3 flex justify-end">
          <button onClick={check} disabled={loading} className={btnPrimary}>
            {loading ? 'Comparing…' : 'Check against brief'}
          </button>
        </div>
      </Section>

      {items ? (
        <Section
          id="scope-results"
          title="2 · Verdicts"
          count={items.length}
          tone={tally('out_of_scope') ? 'danger' : 'ok'}
          badges={
            <>
              {tally('in_scope') > 0 && <Pill tone="ok">{tally('in_scope')} in scope</Pill>}
              {tally('out_of_scope') > 0 && <Pill tone="danger">{tally('out_of_scope')} out of scope</Pill>}
              {tally('unclear') > 0 && <Pill tone="warn">{tally('unclear')} unclear</Pill>}
            </>
          }
        >
          <div className="flex flex-col gap-2">
            {items.map((it, i) => (
              <div key={i} className="rounded-lg border border-slate-200 bg-white p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-slate-900">{it.request}</div>
                    <div className="mt-0.5 text-xs text-slate-500">
                      {it.reason}
                      {it.estimate_hours ? ` · ~${it.estimate_hours}h` : ''}
                    </div>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${verdictClasses[it.verdict]}`}>{verdictLabels[it.verdict]}</span>
                </div>
              </div>
            ))}
          </div>
        </Section>
      ) : (
        <EmptyState title="No comparison yet">Fill in both boxes above and run the check — verdicts appear here.</EmptyState>
      )}

      {items && hasOutOfScope && (
        <Section id="scope-change" title="3 · Change request" subtitle="Turn the out-of-scope items into a polite email" tone="warn">
          <div className="flex flex-wrap items-center gap-2">
            <input value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Client name (optional)" className={`${input} min-w-[10rem] flex-1`} />
            <input value={rate} onChange={(e) => setRate(e.target.value)} placeholder="Your rate, e.g. $80/hr (optional)" className={`${input} min-w-[12rem] flex-1`} />
            <button onClick={draftEmail} disabled={emailLoading} className={btnSecondary}>
              {emailLoading ? 'Drafting…' : 'Draft change request'}
            </button>
          </div>
          {email && (
            <pre className="mt-3 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 font-sans text-sm leading-relaxed text-slate-800">{email}</pre>
          )}
        </Section>
      )}
    </div>
  );
}
