import { useEffect, useState } from 'react';
import { pmApi } from '../../lib/pmApi';
import type { Contact } from '../../types/pm';
import { ErrorNote, Modal, err, ghostBtn, inputCls, primaryBtn } from './Projects/ui';

interface Row {
  name: string;
  email: string;
  include: boolean;
  /** Email was typed here (or edited), so it gets remembered after sending. */
  dirty: boolean;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** "Priya Nair (Acme)" -> "Priya Nair" (custom attendees are saved with their company). */
const bareName = (n: string) => n.replace(/\s*\(.*\)\s*$/, '').trim();

/**
 * Review-then-send email. Recipients are names (team members or custom attendees); emails come
 * from the saved list, and any you type here are remembered for next time.
 */
export default function EmailModal({
  title,
  names,
  subject: initialSubject,
  body: initialBody,
  cardId,
  onClose,
  onSent,
}: {
  title: string;
  names: string[];
  subject: string;
  body: string;
  cardId?: number;
  onClose: () => void;
  onSent: (count: number) => void;
}) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState(initialBody);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    pmApi
      .contacts()
      .then(({ data }) => live && setRows(build(names, data.contacts)))
      .catch(() => live && setRows(build(names, [])));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function build(list: string[], contacts: Contact[]): Row[] {
    const byName = new Map(contacts.map((c) => [c.name.toLowerCase(), c.email]));
    const seen = new Set<string>();
    const out: Row[] = [];
    for (const n of list) {
      const key = n.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const email = byName.get(key) ?? byName.get(bareName(n).toLowerCase()) ?? '';
      out.push({ name: n, email, include: true, dirty: false });
    }
    return out;
  }

  const update = (i: number, patch: Partial<Row>) =>
    setRows((rs) => (rs ?? []).map((r, j) => (j === i ? { ...r, ...patch } : r)));

  function addExtra() {
    setRows((rs) => [...(rs ?? []), { name: '', email: '', include: true, dirty: true }]);
  }

  const chosen = (rows ?? []).filter((r) => r.include);
  const bad = chosen.filter((r) => !EMAIL_RE.test(r.email.trim()));

  async function send() {
    if (chosen.length === 0) return setError('Pick at least one recipient.');
    if (bad.length) return setError(`Add a valid email for ${bad.map((r) => r.name || 'the extra recipient').join(', ')}.`);
    if (!subject.trim() || !body.trim()) return setError('Subject and message can’t be empty.');

    setSending(true);
    setError(null);
    try {
      await pmApi.sendEmail({
        to: chosen.map((r) => r.email.trim()),
        subject: subject.trim(),
        body,
        card_id: cardId,
      });
      // Remember typed emails (only ones with a name). A failure here must not undo a sent email.
      const toSave = chosen.filter((r) => r.dirty && r.name.trim()).map((r) => ({ name: r.name.trim(), email: r.email.trim() }));
      if (toSave.length) await pmApi.saveContacts(toSave).catch(() => {});
      onSent(chosen.length);
    } catch (e) {
      setError(err(e, "Couldn't send the email."));
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal title={title} onClose={onClose} wide>
      <div className="flex flex-col gap-3">
        <div>
          <div className="mb-1 text-xs font-medium text-slate-500">To</div>
          {rows === null && <p className="text-sm text-slate-500">Loading…</p>}
          <div className="flex flex-col gap-1.5">
            {rows?.map((r, i) => (
              <div key={i} className="flex items-center gap-2">
                <input type="checkbox" checked={r.include} onChange={(e) => update(i, { include: e.target.checked })} />
                {r.dirty && !r.name ? (
                  <input value={r.name} onChange={(e) => update(i, { name: e.target.value })} placeholder="Name" className="w-40 rounded-md border border-slate-300 px-2 py-1 text-sm" />
                ) : (
                  <span className="w-40 shrink-0 truncate text-sm text-slate-700" title={r.name}>{r.name}</span>
                )}
                <input
                  type="email"
                  value={r.email}
                  onChange={(e) => update(i, { email: e.target.value, dirty: true })}
                  placeholder="name@gmail.com"
                  className={`flex-1 rounded-md border px-2 py-1 text-sm ${r.include && !EMAIL_RE.test(r.email.trim()) ? 'border-amber-400 bg-amber-50' : 'border-slate-300'}`}
                />
              </div>
            ))}
          </div>
          <button onClick={addExtra} className="mt-1.5 text-xs text-slate-500 hover:text-slate-700">+ Add another recipient</button>
          <p className="mt-1 text-xs text-slate-400">Emails you type are remembered for next time.</p>
        </div>

        <div>
          <div className="mb-1 text-xs font-medium text-slate-500">Subject</div>
          <input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} className={inputCls} />
        </div>
        <div>
          <div className="mb-1 text-xs font-medium text-slate-500">Message (edit freely)</div>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={12} maxLength={20000} className={`${inputCls} font-mono`} />
        </div>

        <ErrorNote message={error} />
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={ghostBtn}>Cancel</button>
          <button onClick={send} disabled={sending || rows === null} className={primaryBtn}>
            {sending ? 'Sending…' : `Send to ${chosen.length}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
