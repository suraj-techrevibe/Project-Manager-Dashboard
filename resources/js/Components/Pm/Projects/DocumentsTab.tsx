import { useState } from 'react';
import { pmApi } from '../../../lib/pmApi';
import type { Project, ProjectDocument } from '../../../types/pm';
import { ConfirmModal, ErrorNote, Field, Modal, formatTimestamp, ghostBtn, inputCls, primaryBtn, useRunner, err } from './ui';

const MAX_BYTES = 5 * 1024 * 1024; // Taskmandu's upload limit

export default function DocumentsTab({ project, onChanged }: { project: Project; onChanged: (p: Project) => void }) {
  const [showUpload, setShowUpload] = useState(false);
  const [editing, setEditing] = useState<ProjectDocument | null>(null);
  const [deleting, setDeleting] = useState<ProjectDocument | null>(null);
  const { busy, error, run } = useRunner(onChanged);

  async function confirmDelete() {
    if (!deleting) return;
    const ok = await run(deleting._id, () => pmApi.deleteDocument(project._id, deleting._id), "Couldn't delete that document.");
    if (ok) setDeleting(null);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">{project.documents.length} document{project.documents.length === 1 ? '' : 's'}</p>
        <button onClick={() => setShowUpload(true)} className={primaryBtn}>Upload document</button>
      </div>

      <ErrorNote message={error} />

      {project.documents.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">No documents yet.</div>
      )}

      <div className="flex flex-col gap-2">
        {project.documents.map((d) => (
          <div key={d._id} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-slate-900">{d.name}</div>
              {d.description && <div className="mt-0.5 text-xs text-slate-500">{d.description}</div>}
              <div className="mt-1 text-xs text-slate-400">
                {[d.size, d.uploadedBy && `by ${d.uploadedBy}`, d.uploadedAt && formatTimestamp(d.uploadedAt)].filter(Boolean).join(' · ')}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2 text-xs">
              {d.url ? (
                <a href={d.url} target="_blank" rel="noreferrer" download={d.name} className="rounded border border-slate-200 px-2 py-1 text-slate-700 hover:bg-slate-50">
                  Download
                </a>
              ) : (
                <span className="text-slate-400" title="Legacy reference with no uploaded file. Re-upload to enable downloads.">No file</span>
              )}
              <button onClick={() => setEditing(d)} className="rounded border border-slate-200 px-2 py-1 text-slate-700 hover:bg-slate-50">Edit</button>
              <button onClick={() => setDeleting(d)} disabled={busy === d._id} className="rounded border border-red-200 px-2 py-1 text-red-600 hover:bg-red-50 disabled:opacity-50">
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      {showUpload && (
        <UploadModal
          onClose={() => setShowUpload(false)}
          onSubmit={async (input) => {
            const { data } = await pmApi.addDocument(project._id, input);
            onChanged(data.project);
            setShowUpload(false);
          }}
        />
      )}

      {editing && (
        <EditModal
          doc={editing}
          onClose={() => setEditing(null)}
          onSubmit={async (patch) => {
            const { data } = await pmApi.updateDocument(project._id, editing._id, patch);
            onChanged(data.project);
            setEditing(null);
          }}
        />
      )}

      {deleting && (
        <ConfirmModal
          title="Delete document"
          message={`Delete "${deleting.name}"? This can't be undone.`}
          busy={busy === deleting._id}
          onConfirm={confirmDelete}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}

function UploadModal({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (input: { file: File; name?: string; description?: string }) => Promise<void>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function pick(f: File | null) {
    setError(null);
    if (f && f.size > MAX_BYTES) {
      setFile(null);
      setError('That file is over the 5 MB limit.');
      return;
    }
    setFile(f);
    if (f && !name) setName(f.name);
  }

  async function submit() {
    if (!file) return;
    setSaving(true);
    setError(null);
    try {
      await onSubmit({ file, name: name.trim() || undefined, description: description.trim() || undefined });
    } catch (e) {
      setError(err(e, "Couldn't upload that document."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Upload document" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <Field label="File (max 5 MB)">
          <input type="file" onChange={(e) => pick(e.target.files?.[0] ?? null)} className="block w-full text-sm" />
        </Field>
        <Field label="Display name">
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} className={inputCls} />
        </Field>
        <Field label="Description">
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={1000} className={inputCls} />
        </Field>
        <ErrorNote message={error} />
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={ghostBtn}>Cancel</button>
          <button onClick={submit} disabled={saving || !file} className={primaryBtn}>{saving ? 'Uploading…' : 'Upload'}</button>
        </div>
      </div>
    </Modal>
  );
}

function EditModal({
  doc,
  onClose,
  onSubmit,
}: {
  doc: ProjectDocument;
  onClose: () => void;
  onSubmit: (patch: { name: string; description: string }) => Promise<void>;
}) {
  const [name, setName] = useState(doc.name);
  const [description, setDescription] = useState(doc.description ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await onSubmit({ name: name.trim(), description: description.trim() });
    } catch (e) {
      setError(err(e, "Couldn't save that document."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Edit document" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <Field label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} className={inputCls} autoFocus />
        </Field>
        <Field label="Description">
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={1000} className={inputCls} />
        </Field>
        <ErrorNote message={error} />
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={ghostBtn}>Cancel</button>
          <button onClick={submit} disabled={saving || !name.trim()} className={primaryBtn}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </Modal>
  );
}
