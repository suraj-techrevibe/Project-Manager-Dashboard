import { useState } from 'react';
import { pmApi } from '../../lib/pmApi';

export default function ClientUpdate() {
  const [tone, setTone] = useState<'formal' | 'casual'>('formal');
  const [clientName, setClientName] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  async function generate(nextTone: 'formal' | 'casual' = tone) {
    setTone(nextTone);
    setLoading(true);
    setCopied(false);
    try {
      const { data } = await pmApi.clientUpdate(nextTone, clientName || undefined);
      setEmail(data.email);
    } finally {
      setLoading(false);
    }
  }

  function copy() {
    navigator.clipboard.writeText(email);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={clientName}
          onChange={(e) => setClientName(e.target.value)}
          placeholder="Client name (optional)"
          className="rounded-md border border-slate-200 px-3 py-1.5 text-sm"
        />
        <div className="flex gap-1.5">
          <button
            onClick={() => generate('formal')}
            className={`rounded-md px-3 py-1.5 text-sm ${
              tone === 'formal' ? 'bg-indigo-600 text-white' : 'border border-slate-200 text-slate-600'
            }`}
          >
            Formal
          </button>
          <button
            onClick={() => generate('casual')}
            className={`rounded-md px-3 py-1.5 text-sm ${
              tone === 'casual' ? 'bg-indigo-600 text-white' : 'border border-slate-200 text-slate-600'
            }`}
          >
            Casual
          </button>
        </div>
        <button
          onClick={() => generate()}
          disabled={loading}
          className="ml-auto rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {loading ? 'Writing…' : email ? 'Regenerate' : 'Generate update'}
        </button>
      </div>

      {email ? (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-slate-800">{email}</pre>
          <div className="mt-3 flex items-center justify-between">
            <span className="text-xs text-slate-400">Review before sending. Nothing is sent automatically.</span>
            <button
              onClick={copy}
              className="rounded-md bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200"
            >
              {copied ? 'Copied ✓' : 'Copy'}
            </button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-slate-500">Generate a draft update from this week's board activity.</p>
      )}
    </div>
  );
}
