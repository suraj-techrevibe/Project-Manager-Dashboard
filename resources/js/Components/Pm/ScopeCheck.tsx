import { useState } from 'react';
import { pmApi } from '../../lib/pmApi';
import type { ScopeItem } from '../../types/pm';

const verdictClasses: Record<string, string> = {
  in_scope: 'bg-green-50 text-green-700',
  out_of_scope: 'bg-red-50 text-red-700',
  unclear: 'bg-amber-50 text-amber-700',
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

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-xl border border-slate-200 bg-white p-3">
        <label className="mb-1 block text-xs font-medium text-slate-500">Original signed brief</label>
        <textarea
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          placeholder="Paste the original scope / brief..."
          className="mb-2 min-h-[70px] w-full resize-y rounded-md border border-slate-200 p-2 text-sm"
        />
        <label className="mb-1 block text-xs font-medium text-slate-500">New client message</label>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Paste what the client just asked for..."
          className="min-h-[60px] w-full resize-y rounded-md border border-slate-200 p-2 text-sm"
        />
        {error && <div className="mt-1 text-xs text-red-600">{error}</div>}
        <div className="mt-2 flex justify-end">
          <button
            onClick={check}
            disabled={loading}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            {loading ? 'Comparing…' : 'Check against brief'}
          </button>
        </div>
      </div>

      {items && (
        <div className="flex flex-col gap-2">
          {items.map((it, i) => (
            <div key={i} className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm text-slate-900">{it.request}</div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    {it.reason}
                    {it.estimate_hours ? ` · ~${it.estimate_hours}h` : ''}
                  </div>
                </div>
                <span className={`shrink-0 rounded px-2 py-0.5 text-xs ${verdictClasses[it.verdict]}`}>
                  {verdictLabels[it.verdict]}
                </span>
              </div>
            </div>
          ))}

          {hasOutOfScope && (
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="mb-2 flex flex-wrap gap-2">
                <input
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  placeholder="Client name (optional)"
                  className="rounded-md border border-slate-200 px-3 py-1.5 text-sm"
                />
                <input
                  value={rate}
                  onChange={(e) => setRate(e.target.value)}
                  placeholder="Your rate, e.g. $80/hr (optional)"
                  className="rounded-md border border-slate-200 px-3 py-1.5 text-sm"
                />
                <button
                  onClick={draftEmail}
                  disabled={emailLoading}
                  className="ml-auto rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  {emailLoading ? 'Drafting…' : 'Draft change request'}
                </button>
              </div>
              {email && (
                <pre className="whitespace-pre-wrap rounded-md bg-slate-50 p-3 font-sans text-sm leading-relaxed text-slate-800">
                  {email}
                </pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
