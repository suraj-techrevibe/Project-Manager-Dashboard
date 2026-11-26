import { useEffect, useState, type FormEvent } from 'react';
import type { InvAssignInput, InvChecklistItem, InvOptions, InvPriority, InvestigationFull } from '@/types/pmInvestigation';
import { Notice, btnPrimary, btnSecondary } from '../ui/kit';
import { Field, PRIORITIES, cap, inputCls } from './invShared';

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' });

/** Assign a new investigation, or edit one. When editing, the project is fixed and the developer is changed with Reassign. */
export default function InvAssignForm({ options, editing, preset, saving, error, onSave, onCancel, caution }: {
  /** Returns a warning when the chosen project doesn't need another investigation yet. Assigning anyway is a deliberate override. */
  caution?: (projectId: string) => string | null;
  options: InvOptions | null; editing?: InvestigationFull | null; preset?: { project_id?: string; developer_name?: string };
  saving: boolean; error: string | null; onSave: (d: InvAssignInput) => void; onCancel: () => void;
}) {
  const [f, setF] = useState<InvAssignInput>(() => ({
    project_id: editing?.project_id ?? preset?.project_id ?? '', developer_name: editing?.developer_name ?? preset?.developer_name ?? '',
    assigned_on: editing?.assigned_on ?? today(), due_date: editing?.due_date ?? null, priority: editing?.priority ?? 'medium',
    scope: editing?.scope ?? '', instructions: editing?.instructions ?? '', deliverables: editing?.deliverables ?? '',
    checklist: editing?.checklist ?? [],
  }));
  const set = <K extends keyof InvAssignInput>(k: K, v: InvAssignInput[K]) => setF((p) => ({ ...p, [k]: v }));

  // New assignments start from the default checklist; each one can then be changed freely.
  useEffect(() => {
    if (!editing && options && (f.checklist ?? []).length === 0) set('checklist', options.default_checklist.map((label) => ({ label, done: false })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options]);

  const list = f.checklist ?? [];
  const upd = (i: number, label: string) => set('checklist', list.map((c, j) => (j === i ? { ...c, label } : c)));
  const dev = options?.developers.find((d) => d.name === f.developer_name);
  const [override, setOverride] = useState(false);
  const warn = !editing && f.project_id && caution ? caution(f.project_id) : null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const project = options?.projects.find((p) => p.id === f.project_id);
    const data: InvAssignInput = { ...f, project_name: project?.name, developer_employee_id: dev?.employee_id ?? null, due_date: f.due_date || null, checklist: list.filter((c: InvChecklistItem) => c.label.trim()) };
    if (editing) { delete (data as Partial<InvAssignInput>).project_id; delete (data as Partial<InvAssignInput>).project_name; delete (data as Partial<InvAssignInput>).developer_name; delete (data as Partial<InvAssignInput>).developer_employee_id; }
    onSave(data);
  };

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-indigo-200 bg-indigo-50/30 p-4">
      <div className="text-sm font-semibold text-slate-800">{editing ? 'Edit assignment' : 'Assign investigation'}</div>
      {options?.warnings.map((w) => <Notice key={w} tone="warn">{w}</Notice>)}
      {error && <Notice tone="danger">{error}</Notice>}
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Project / business *">
          {editing ? <div className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-sm text-slate-700">{editing.project_name}</div> : (
            <select className={inputCls} value={f.project_id} onChange={(e) => set('project_id', e.target.value)} required>
              <option value="">Choose a Taskmandu project…</option>
              {options?.projects.map((p) => <option key={p.id} value={p.id}>{p.name}{p.business && p.business !== p.name ? ` · ${p.business}` : ''}</option>)}
            </select>
          )}
        </Field>
        <Field label="Developer *" hint={editing ? 'Use Reassign to change the developer.' : undefined}>
          {editing ? <div className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-sm text-slate-700">{editing.developer_name}</div> : (
            <select className={inputCls} value={f.developer_name} onChange={(e) => set('developer_name', e.target.value)} required>
              <option value="">Choose a developer…</option>
              {options?.developers.map((d) => <option key={d.name} value={d.name}>{d.name}{d.designation ? ` · ${d.designation}` : ''}</option>)}
            </select>
          )}
        </Field>
        <Field label="Priority"><select className={inputCls} value={f.priority} onChange={(e) => set('priority', e.target.value as InvPriority)}>{PRIORITIES.map((p) => <option key={p} value={p}>{cap(p)}</option>)}</select></Field>
        <Field label="Assignment date"><input type="date" className={inputCls} value={f.assigned_on ?? ''} onChange={(e) => set('assigned_on', e.target.value)} required /></Field>
        <Field label="Due date"><input type="date" className={inputCls} min={f.assigned_on} value={f.due_date ?? ''} onChange={(e) => set('due_date', e.target.value || null)} /></Field>
      </div>
      <Field label="Investigation scope" hint="What should be looked at, and what is out of scope."><textarea className={inputCls} rows={3} value={f.scope ?? ''} onChange={(e) => set('scope', e.target.value)} /></Field>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Additional instructions"><textarea className={inputCls} rows={3} value={f.instructions ?? ''} onChange={(e) => set('instructions', e.target.value)} /></Field>
        <Field label="Expected deliverables"><textarea className={inputCls} rows={3} value={f.deliverables ?? ''} onChange={(e) => set('deliverables', e.target.value)} /></Field>
      </div>
      <div>
        <div className="mb-1 text-xs font-medium text-slate-600">Checklist <span className="font-normal text-slate-400">(edit, remove or add steps for this project)</span></div>
        <div className="space-y-1.5">
          {list.map((c, i) => (
            <div key={c.id ?? i} className="flex gap-2">
              <input className={inputCls} value={c.label} onChange={(e) => upd(i, e.target.value)} maxLength={200} />
              <button type="button" className="px-1 text-xs text-rose-600 hover:underline" onClick={() => set('checklist', list.filter((_, j) => j !== i))}>Remove</button>
            </div>
          ))}
          <button type="button" className={btnSecondary} onClick={() => set('checklist', [...list, { label: '', done: false }])}>+ Add step</button>
        </div>
      </div>
      {warn && (
        <Notice tone="warn">
          {warn}
          <label className="mt-1 flex items-center gap-2 font-medium"><input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />Assign it anyway</label>
        </Notice>
      )}
      <div className="flex gap-2">
        <button className={btnPrimary} disabled={saving || (!f.project_id && !editing) || (!f.developer_name && !editing) || (!!warn && !override)}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Assign'}</button>
        <button type="button" className={btnSecondary} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
