import { useState } from 'react';
import { pmApi } from '../../../lib/pmApi';
import type { Project, SharedVariable, VariableType } from '../../../types/pm';
import { VARIABLE_TYPES } from '../../../types/pm';
import { Badge, ConfirmModal, ErrorNote, Field, Modal, formatTimestamp, ghostBtn, inputCls, primaryBtn, useRunner, err } from './ui';

export default function SecretsTab({ project, onChanged }: { project: Project; onChanged: (p: Project) => void }) {
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState<SharedVariable | null>(null);
  const [deleting, setDeleting] = useState<SharedVariable | null>(null);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const { busy, error, run } = useRunner(onChanged);

  async function copy(v: SharedVariable) {
    try {
      await navigator.clipboard.writeText(v.value);
      setCopied(v._id);
      setTimeout(() => setCopied((c) => (c === v._id ? null : c)), 1500);
    } catch {
      /* clipboard unavailable (non-HTTPS / permissions) — ignore */
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    const ok = await run(deleting._id, () => pmApi.deleteVariable(project._id, deleting._id), "Couldn't delete that variable.");
    if (ok) setDeleting(null);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">
          {project.sharedVariables.length} shared variable{project.sharedVariables.length === 1 ? '' : 's'}
        </p>
        <button onClick={() => setShowNew(true)} className={primaryBtn}>Add variable</button>
      </div>

      <ErrorNote message={error} />

      {project.sharedVariables.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">No shared variables yet.</div>
      )}

      <div className="flex flex-col gap-2">
        {project.sharedVariables.map((v) => {
          const hidden = v.isSecret && !revealed[v._id];
          return (
            <div key={v._id} className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-medium text-slate-900">{v.key}</span>
                  <Badge className="bg-slate-100 text-slate-600">{v.type}</Badge>
                  {v.isSecret && <Badge className="bg-amber-50 text-amber-700">Secret</Badge>}
                </div>
                <div className="flex items-center gap-2 text-xs">
                  {v.isSecret && (
                    <button onClick={() => setRevealed((r) => ({ ...r, [v._id]: !r[v._id] }))} className="rounded border border-slate-200 px-2 py-1 text-slate-700 hover:bg-slate-50">
                      {revealed[v._id] ? 'Hide' : 'Reveal'}
                    </button>
                  )}
                  <button onClick={() => copy(v)} className="rounded border border-slate-200 px-2 py-1 text-slate-700 hover:bg-slate-50">
                    {copied === v._id ? 'Copied' : 'Copy'}
                  </button>
                  <button onClick={() => setEditing(v)} className="rounded border border-slate-200 px-2 py-1 text-slate-700 hover:bg-slate-50">Edit</button>
                  <button onClick={() => setDeleting(v)} disabled={busy === v._id} className="rounded border border-red-200 px-2 py-1 text-red-600 hover:bg-red-50 disabled:opacity-50">
                    Delete
                  </button>
                </div>
              </div>
              <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-slate-50 p-2 font-mono text-xs text-slate-700">
                {hidden ? '••••••••••••' : v.value || '—'}
              </pre>
              {v.description && <div className="mt-1 text-xs text-slate-500">{v.description}</div>}
              <div className="mt-1 text-xs text-slate-400">
                {v.updatedBy && `Updated by ${v.updatedBy}`}
                {v.updatedAt && ` · ${formatTimestamp(v.updatedAt)}`}
              </div>
            </div>
          );
        })}
      </div>

      {showNew && (
        <VariableModal
          title="Add variable"
          onClose={() => setShowNew(false)}
          onSubmit={async (input) => {
            const { data } = await pmApi.addVariable(project._id, input);
            onChanged(data.project);
            setShowNew(false);
          }}
        />
      )}

      {editing && (
        <VariableModal
          title="Edit variable"
          initial={editing}
          onClose={() => setEditing(null)}
          onSubmit={async (input) => {
            const { data } = await pmApi.updateVariable(project._id, editing._id, input);
            onChanged(data.project);
            setEditing(null);
          }}
        />
      )}

      {deleting && (
        <ConfirmModal
          title="Delete variable"
          message={`Delete ${deleting.key}? Anyone relying on it will lose access.`}
          busy={busy === deleting._id}
          onConfirm={confirmDelete}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}

function VariableModal({
  title,
  initial,
  onClose,
  onSubmit,
}: {
  title: string;
  initial?: SharedVariable;
  onClose: () => void;
  onSubmit: (input: { key: string; value: string; isSecret: boolean; type: VariableType; description: string }) => Promise<void>;
}) {
  const [key, setKey] = useState(initial?.key ?? '');
  const [value, setValue] = useState(initial?.value ?? '');
  const [isSecret, setIsSecret] = useState(initial?.isSecret ?? false);
  const [type, setType] = useState<VariableType>(initial?.type ?? 'Environment');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!key.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await onSubmit({
        // Same normalisation Taskmandu applies: UPPER_SNAKE_CASE keys.
        key: key.trim().toUpperCase().replace(/\s+/g, '_'),
        value,
        isSecret,
        type,
        description: description.trim(),
      });
    } catch (e) {
      setError(err(e, "Couldn't save that variable."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={title} onClose={onClose} wide>
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Key">
            <input value={key} onChange={(e) => setKey(e.target.value)} maxLength={200} placeholder="e.g. MONGO_URI" className={`${inputCls} font-mono uppercase`} autoFocus />
          </Field>
          <Field label="Type">
            <select value={type} onChange={(e) => setType(e.target.value as VariableType)} className={inputCls}>
              {VARIABLE_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Value">
          <textarea value={value} onChange={(e) => setValue(e.target.value)} rows={6} maxLength={5000} className={`${inputCls} font-mono`} />
        </Field>
        <Field label="Description">
          <input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} className={inputCls} />
        </Field>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={isSecret} onChange={(e) => setIsSecret(e.target.checked)} />
          Mask this value by default (secret)
        </label>
        <ErrorNote message={error} />
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={ghostBtn}>Cancel</button>
          <button onClick={submit} disabled={saving || !key.trim()} className={primaryBtn}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </Modal>
  );
}
