import { useEffect, useState } from 'react';
import { pmApi } from '../../lib/pmApi';
import type { DigestPreview } from '../../types/pm';

/** Pulls the most useful message out of a failed request. */
function errorText(e: any, fallback: string): string {
  return e?.response?.data?.error ?? fallback;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  }
}

/**
 * Preview of the morning digest (the message Slack / email gets at 9am), with
 * Copy and Send now. The text is built on the server so it matches what's sent.
 */
export default function DigestPanel({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<DigestPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  function load() {
    setLoading(true);
    setError(null);
    pmApi
      .digest()
      .then(({ data }) => setData(data))
      .catch((e) => setError(errorText(e, "Couldn't build the digest.")))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  const noChannel = data ? !data.channels.slack && !data.channels.email : false;
  const where = data ? [data.channels.slack && 'Slack', data.channels.email && 'email'].filter(Boolean).join(' and ') : '';

  async function send() {
    setSending(true);
    setStatus(null);
    try {
      const { data: res } = await pmApi.sendDigest();
      const failed = Object.entries(res.errors ?? {});
      setStatus(
        `Sent to ${res.sent.join(' and ')}.${failed.length ? ` Failed: ${failed.map(([k, v]) => `${k} (${v})`).join('; ')}` : ''}`
      );
    } catch (e) {
      setStatus(errorText(e, "Couldn't send the digest."));
    } finally {
      setSending(false);
    }
  }

  async function copy() {
    if (!data) return;
    setStatus((await copyText(data.text)) ? 'Copied' : "Couldn't copy — select the text manually");
  }

  return (
    <div className="mb-3 rounded-lg border border-slate-200 bg-white p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium text-slate-800">Morning digest</span>
        <button onClick={onClose} className="rounded px-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Close">
          ✕
        </button>
      </div>

      {loading && <div className="text-xs text-slate-500">Building…</div>}
      {error && <div className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

      {data && (
        <>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-slate-50 p-2.5 text-xs text-slate-700">{data.text}</pre>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button onClick={copy} className="rounded-md border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50">
              Copy
            </button>
            <button onClick={load} disabled={loading} className="rounded-md border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50">
              Refresh
            </button>
            <button
              onClick={send}
              disabled={sending || noChannel}
              className="rounded-md bg-slate-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              title={noChannel ? 'Set PM_DIGEST_SLACK_WEBHOOK and/or PM_DIGEST_EMAIL in .env first' : `Send to ${where} now`}
            >
              {sending ? 'Sending…' : noChannel ? 'Send now (not set up)' : `Send to ${where}`}
            </button>
            {status && <span className="text-xs text-slate-500">{status}</span>}
          </div>

          <p className="mt-2 text-xs text-slate-400">
            {noChannel
              ? 'To get this automatically at 9:00 on weekdays, add PM_DIGEST_SLACK_WEBHOOK and/or PM_DIGEST_EMAIL to .env and keep the scheduler running.'
              : `Also sent automatically on weekdays (default 9:00) to ${where} while the scheduler is running.`}
          </p>
        </>
      )}
    </div>
  );
}
