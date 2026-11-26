import { useEffect, useState } from 'react';
import { pmApi } from '@/lib/pmApi';
import type { InvAction, InvAssignInput, InvFindingsInput, InvFollowup, InvOptions, InvestigationFull } from '@/types/pmInvestigation';
import { Notice, Section, btnPrimary, btnSecondary } from '../ui/kit';
import InvAssignForm from './InvAssignForm';
import { EVENT_LABEL, Field, PRIORITIES, PriorityBadge, StatusPill, cap, errText, fmtDate, fmtDateTime, inputCls } from './invShared';

const Read = ({ label, value }: { label: string; value: string | null | undefined }) => (
  <div><div className="text-xs font-medium text-slate-500">{label}</div><p className="whitespace-pre-wrap text-sm text-slate-700">{value?.trim() ? value : <span className="text-slate-400">—</span>}</p></div>
);

export default function InvDetail({ id, options, onBack, onChanged }: { id: number; options: InvOptions | null; onBack: () => void; onChanged: () => void }) {
  const [inv, setInv] = useState<InvestigationFull | null>(null);
  const [f, setF] = useState<InvFindingsInput>({});
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [reassigning, setReassigning] = useState(false);
  const [newDev, setNewDev] = useState('');
  const [note, setNote] = useState('');
  const [comments, setComments] = useState('');
  const [flags, setFlags] = useState<Record<string, { convert: boolean; reference: string }>>({});

  const adopt = (i: InvestigationFull) => {
    setInv(i);
    setF({ areas_reviewed: i.areas_reviewed, findings: i.findings, issues: i.issues, recommendations: i.recommendations, notes: i.notes, effort_estimate: i.effort_estimate, checklist: i.checklist, evidence: i.evidence, followups: i.followups });
    setComments(i.review_comments ?? '');
    setFlags(Object.fromEntries(i.followups.filter((x) => x.uid).map((x) => [x.uid!, { convert: !!x.convert, reference: x.reference ?? '' }])));
    setDirty(false);
  };

  useEffect(() => {
    let live = true;
    pmApi.invShow(id).then((r) => live && adopt(r.data.investigation)).catch((e) => live && setError(errText(e, 'Could not load this investigation.')));
    return () => { live = false; };
  }, [id]);

  const run = async (key: string, fn: () => Promise<InvestigationFull>, ok?: string) => {
    setBusy(key); setError(null); setMsg(null);
    try { adopt(await fn()); if (ok) setMsg(ok); onChanged(); } catch (e) { setError(errText(e, 'Something went wrong.')); } finally { setBusy(null); }
  };

  if (!inv) return <div className="space-y-3"><button className={btnSecondary} onClick={onBack}>← Back</button>{error ? <Notice tone="danger">{error}</Notice> : <p className="text-sm text-slate-500">Loading…</p>}</div>;

  const editable = inv.findings_editable;
  const set = <K extends keyof InvFindingsInput>(k: K, v: InvFindingsInput[K]) => { setF((p) => ({ ...p, [k]: v })); setDirty(true); };
  const can = (a: InvAction) => inv.actions.includes(a);
  const reviewing = inv.status === 'awaiting_review' || inv.status === 'reviewed';
  const followups = (f.followups ?? []) as InvFollowup[];
  const evidence = f.evidence ?? [];
  const checklist = f.checklist ?? [];
  const done = checklist.filter((c) => c.done).length;

  const saveFindings = () => run('save', async () => (await pmApi.invFindings(id, f)).data.investigation, 'Draft saved.');
  const act = (a: InvAction, ok: string, c?: string) => run(a, async () => {
    if (a === 'submit' && dirty) await pmApi.invFindings(id, f);
    return (await pmApi.invTransition(id, a, c)).data.investigation;
  }, ok);
  const saveReview = () => run('review_notes', async () => (await pmApi.invReview(id, { review_comments: comments, followups: Object.entries(flags).map(([uid, v]) => ({ uid, convert: v.convert, reference: v.reference })) })).data.investigation, 'Review notes saved.');

  // Copy workflow: nothing is created in Taskmandu from here.
  const copyTasks = async () => {
    const picked = inv.followups.filter((x) => flags[x.uid ?? '']?.convert);
    const text = picked.map((x) => `- ${x.title}${x.priority ? ` [${cap(x.priority)}]` : ''}${x.effort ? ` (${x.effort})` : ''}${x.description ? `\n  ${x.description.replace(/\n/g, '\n  ')}` : ''}`).join('\n');
    try { await navigator.clipboard.writeText(`Project: ${inv.project_name}\nFrom investigation by ${inv.developer_name}\n\n${text}`); setMsg('Copied. Paste it into Taskmandu or the Brief tool when you are ready. Nothing was created.'); } catch { setError('Could not copy to the clipboard.'); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button className={btnSecondary} onClick={onBack}>← All investigations</button>
        <div className="flex flex-wrap items-center gap-2"><StatusPill status={inv.status} /><PriorityBadge value={inv.priority} />{inv.overdue && <span className="text-xs font-medium text-rose-600">Overdue</span>}</div>
      </div>
      <div>
        <h3 className="text-base font-semibold text-slate-900">{inv.project_name}</h3>
        <div className="text-xs text-slate-500">{[`Developer: ${inv.developer_name}`, `Assigned ${fmtDate(inv.assigned_on)}`, inv.due_date ? `Due ${fmtDate(inv.due_date)}` : 'No due date', inv.submitted_at ? `Submitted ${fmtDateTime(inv.submitted_at)}` : null, inv.reviewed_at ? `Reviewed ${fmtDateTime(inv.reviewed_at)}${inv.reviewer_name ? ` by ${inv.reviewer_name}` : ''}` : null].filter(Boolean).join(' · ')}</div>
      </div>
      {error && <Notice tone="danger">{error}</Notice>}
      {msg && <Notice tone="ok">{msg}</Notice>}
      {inv.status === 'returned' && inv.review_comments && <Notice tone="warn"><b>Returned:</b> {inv.review_comments}</Notice>}

      {editing ? (
        <InvAssignForm options={options} editing={inv} saving={busy === 'edit'} error={null} onCancel={() => setEditing(false)}
          onSave={(d: InvAssignInput) => void run('edit', async () => { const r = (await pmApi.invUpdate(id, d)).data.investigation; setEditing(false); return r; }, 'Assignment updated.')} />
      ) : (
        <Section id="inv-assignment" title="Assignment" persist={false} actions={inv.status !== 'completed' && <span className="flex gap-1.5"><button className={btnSecondary} onClick={() => setEditing(true)}>Edit</button><button className={btnSecondary} onClick={() => { setReassigning((v) => !v); setNewDev(''); }}>Reassign</button></span>}>
          {reassigning && (
            <div className="mb-3 flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <Field label="New developer"><select className={inputCls} value={newDev} onChange={(e) => setNewDev(e.target.value)}><option value="">Choose…</option>{options?.developers.filter((d) => d.name !== inv.developer_name).map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}</select></Field>
              <Field label="Reason (optional)" className="min-w-[14rem] flex-1"><input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
              <button className={btnPrimary} disabled={!newDev || busy === 'reassign'} onClick={() => void run('reassign', async () => { const r = (await pmApi.invReassign(id, { developer_name: newDev, developer_employee_id: options?.developers.find((d) => d.name === newDev)?.employee_id ?? null, note: note || undefined })).data.investigation; setReassigning(false); setNote(''); return r; }, 'Reassigned.')}>Reassign</button>
            </div>
          )}
          <div className="grid gap-3 md:grid-cols-3"><Read label="Scope" value={inv.scope} /><Read label="Additional instructions" value={inv.instructions} /><Read label="Expected deliverables" value={inv.deliverables} /></div>
        </Section>
      )}

      <Section id="inv-checklist" title="Checklist" count={`${done}/${checklist.length}`} persist={false}>
        <ul className="space-y-1">
          {checklist.map((c, i) => (
            <li key={c.id ?? i}><label className="flex items-start gap-2 text-sm text-slate-700"><input type="checkbox" className="mt-0.5" checked={!!c.done} disabled={!editable} onChange={(e) => set('checklist', checklist.map((x, j) => (j === i ? { ...x, done: e.target.checked } : x)))} />{c.label}</label></li>
          ))}
        </ul>
      </Section>

      <Section id="inv-findings" title="Findings" persist={false} subtitle={editable ? 'Save as a draft any time. Submit when you are done.' : 'Submitted. These are locked while under review.'}>
        <div className="space-y-3">
          <Field label="Areas / pages reviewed"><textarea className={inputCls} rows={2} disabled={!editable} value={f.areas_reviewed ?? ''} onChange={(e) => set('areas_reviewed', e.target.value)} /></Field>
          <Field label="Findings"><textarea className={inputCls} rows={4} disabled={!editable} value={f.findings ?? ''} onChange={(e) => set('findings', e.target.value)} /></Field>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Issues discovered"><textarea className={inputCls} rows={4} disabled={!editable} value={f.issues ?? ''} onChange={(e) => set('issues', e.target.value)} /></Field>
            <Field label="Improvement recommendations"><textarea className={inputCls} rows={4} disabled={!editable} value={f.recommendations ?? ''} onChange={(e) => set('recommendations', e.target.value)} /></Field>
          </div>
          <div>
            <div className="mb-1 text-xs font-medium text-slate-600">Evidence and URLs</div>
            <div className="space-y-1.5">
              {evidence.map((ev, i) => (
                <div key={i} className="flex gap-2">
                  <input className={`${inputCls} max-w-[14rem]`} placeholder="Label" disabled={!editable} value={ev.label ?? ''} onChange={(e) => set('evidence', evidence.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                  <input className={inputCls} placeholder="https://…" disabled={!editable} value={ev.url ?? ''} onChange={(e) => set('evidence', evidence.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} />
                  {ev.url && /^https?:\/\//.test(ev.url) && <a href={ev.url} target="_blank" rel="noreferrer noopener" className="self-center text-xs text-indigo-600 hover:underline">Open</a>}
                  {editable && <button className="px-1 text-xs text-rose-600 hover:underline" onClick={() => set('evidence', evidence.filter((_, j) => j !== i))}>Remove</button>}
                </div>
              ))}
              {editable && <button className={btnSecondary} onClick={() => set('evidence', [...evidence, { label: '', url: '' }])}>+ Add evidence</button>}
            </div>
          </div>
          <Field label="Notes"><textarea className={inputCls} rows={2} disabled={!editable} value={f.notes ?? ''} onChange={(e) => set('notes', e.target.value)} /></Field>
        </div>
      </Section>

      <Section id="inv-followups" title="Proposed follow-up tasks" count={followups.length} persist={false}
        subtitle="Recommendations only. Nothing is created in Taskmandu from here."
        actions={reviewing && inv.followups.some((x) => flags[x.uid ?? '']?.convert) ? <button className={btnSecondary} onClick={() => void copyTasks()}>Copy selected as task list</button> : undefined}>
        <div className="space-y-2">
          {followups.length === 0 && <p className="text-sm text-slate-400">No follow-up tasks proposed.</p>}
          {followups.map((x, i) => (
            <div key={x.uid ?? i} className="space-y-1.5 rounded-lg border border-slate-200 bg-slate-50/50 p-3">
              <div className="flex flex-wrap gap-2">
                <input className={`${inputCls} flex-1`} placeholder="Task title" disabled={!editable} value={x.title} onChange={(e) => set('followups', followups.map((y, j) => (j === i ? { ...y, title: e.target.value } : y)))} />
                <select className={`${inputCls} max-w-[8rem]`} disabled={!editable} value={x.priority ?? 'medium'} onChange={(e) => set('followups', followups.map((y, j) => (j === i ? { ...y, priority: e.target.value as InvFollowup['priority'] } : y)))}>{PRIORITIES.map((p) => <option key={p} value={p}>{cap(p)}</option>)}</select>
                <input className={`${inputCls} max-w-[8rem]`} placeholder="Effort (e.g. 4h)" disabled={!editable} value={x.effort ?? ''} onChange={(e) => set('followups', followups.map((y, j) => (j === i ? { ...y, effort: e.target.value } : y)))} />
                {editable && <button className="px-1 text-xs text-rose-600 hover:underline" onClick={() => set('followups', followups.filter((_, j) => j !== i))}>Remove</button>}
              </div>
              <textarea className={inputCls} rows={2} placeholder="Description" disabled={!editable} value={x.description ?? ''} onChange={(e) => set('followups', followups.map((y, j) => (j === i ? { ...y, description: e.target.value } : y)))} />
              {reviewing && x.uid && (
                <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 pt-1.5 text-sm">
                  <label className="flex items-center gap-1.5"><input type="checkbox" checked={flags[x.uid]?.convert ?? false} onChange={(e) => setFlags((p) => ({ ...p, [x.uid!]: { convert: e.target.checked, reference: p[x.uid!]?.reference ?? '' } }))} />Should become a task</label>
                  <input className={`${inputCls} max-w-xs`} placeholder="Taskmandu task reference (once created)" value={flags[x.uid]?.reference ?? ''} onChange={(e) => setFlags((p) => ({ ...p, [x.uid!]: { convert: p[x.uid!]?.convert ?? false, reference: e.target.value } }))} />
                </div>
              )}
            </div>
          ))}
          {editable && <button className={btnSecondary} onClick={() => set('followups', [...followups, { title: '', priority: 'medium' }])}>+ Add follow-up task</button>}
          <Field label="Rough effort estimate (overall)"><input className={`${inputCls} max-w-xs`} disabled={!editable} value={f.effort_estimate ?? ''} onChange={(e) => set('effort_estimate', e.target.value)} placeholder="e.g. about 3 days" /></Field>
        </div>
      </Section>

      {reviewing && (
        <Section id="inv-review" title="Review" tone="info" persist={false} subtitle="Add comments, flag recommendations that should become tasks, then decide.">
          <div className="space-y-3">
            <Field label="Review comments"><textarea className={inputCls} rows={3} value={comments} onChange={(e) => setComments(e.target.value)} /></Field>
            <div className="flex flex-wrap gap-2">
              <button className={btnSecondary} disabled={!!busy} onClick={() => void saveReview()}>Save review notes</button>
              {can('review') && <button className={btnPrimary} disabled={!!busy} onClick={() => void run('review', async () => { await pmApi.invReview(id, { review_comments: comments, followups: Object.entries(flags).map(([uid, v]) => ({ uid, convert: v.convert, reference: v.reference })) }); return (await pmApi.invTransition(id, 'review', comments)).data.investigation; }, 'Marked as reviewed.')}>Mark reviewed</button>}
              {can('return') && <button className={btnSecondary} disabled={!!busy || !comments.trim()} title={comments.trim() ? undefined : 'Say what needs more investigation first'} onClick={() => void act('return', 'Returned for further investigation.', comments)}>Return for further investigation</button>}
              {can('close') && <button className={btnSecondary} disabled={!!busy} onClick={() => void act('close', 'Investigation closed.', comments)}>Close investigation</button>}
            </div>
          </div>
        </Section>
      )}
      {!reviewing && inv.review_comments && inv.status !== 'returned' && <Section id="inv-review-read" title="Review comments" persist={false}><p className="whitespace-pre-wrap text-sm text-slate-700">{inv.review_comments}</p></Section>}

      <div className="sticky bottom-2 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white/95 p-3 shadow-md backdrop-blur">
        {can('start') && <button className={btnPrimary} disabled={!!busy} onClick={() => void act('start', inv.status === 'returned' ? 'Resumed.' : 'Started.')}>{inv.status === 'returned' ? 'Resume investigation' : 'Start investigation'}</button>}
        {editable && <button className={btnSecondary} disabled={!!busy || !dirty} onClick={() => void saveFindings()}>{busy === 'save' ? 'Saving…' : 'Save draft'}</button>}
        {can('submit') && <button className={btnPrimary} disabled={!!busy} onClick={() => void act('submit', 'Findings submitted for review.')}>Submit findings for review</button>}
        {can('reopen') && <button className={btnSecondary} disabled={!!busy} onClick={() => void act('reopen', 'Reopened. It is back with the developer.')}>Reopen</button>}
        {dirty && editable && <span className="text-xs text-amber-600">Unsaved changes</span>}
        <span className="flex-1" />
        <button className={btnSecondary} onClick={onBack}>Close</button>
      </div>

      <Section id="inv-history" title="History" count={inv.events.length} defaultOpen={false} persist={false}>
        <ul className="divide-y divide-slate-100">
          {inv.events.map((e) => (
            <li key={e.id} className="py-1.5 text-sm"><span className="font-medium text-slate-800">{EVENT_LABEL[e.event] ?? e.event}</span> <span className="text-xs text-slate-500">· {e.actor ?? 'system'} · {fmtDateTime(e.at)}</span>{e.detail && <div className="whitespace-pre-wrap text-xs text-slate-600">{e.detail}</div>}</li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
