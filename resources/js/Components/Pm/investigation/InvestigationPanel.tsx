import { useCallback, useEffect, useMemo, useState } from 'react';
import { pmApi } from '@/lib/pmApi';
import type { InvAssignInput, InvCoverage, InvFilters, InvListResponse, InvOptions, InvStatus } from '@/types/pmInvestigation';
import { EmptyState, Notice, Pill, Section, StatTile, btnChip, btnPrimary, btnSecondary } from '../ui/kit';
import InvAssignForm from './InvAssignForm';
import InvDetail from './InvDetail';
import { PRIORITIES, PriorityBadge, STATUS_LABEL, StatusPill, cap, errText, fmtDate, inputCls } from './invShared';

type View = 'assignments' | 'coverage';

export default function InvestigationPanel() {
  const [view, setView] = useState<View>('assignments');
  const [data, setData] = useState<InvListResponse | null>(null);
  const [cov, setCov] = useState<InvCoverage | null>(null);
  const [options, setOptions] = useState<InvOptions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<number | null>(null);
  const [form, setForm] = useState<null | { project_id?: string }>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [developer, setDeveloper] = useState('');
  const [project, setProject] = useState('');
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);

  const filters: InvFilters = useMemo(() => ({ search, developer, project_id: project, status, priority, date_from: from, date_to: to, page }), [search, developer, project, status, priority, from, to, page]);
  useEffect(() => { setPage(1); }, [search, developer, project, status, priority, from, to]);

  const load = useCallback(async () => {
    setLoading(true);
    try { setError(null); setData((await pmApi.invList(filters)).data); } catch (e) { setError(errText(e, 'Could not load investigations.')); } finally { setLoading(false); }
  }, [filters]);
  const loadCoverage = useCallback(async () => { try { setCov((await pmApi.invCoverage()).data); } catch (e) { setError(errText(e, 'Could not load coverage.')); } }, []);

  useEffect(() => { const t = setTimeout(() => void load(), search ? 250 : 0); return () => clearTimeout(t); }, [load, search]);
  useEffect(() => { void loadCoverage(); pmApi.invOptions().then((r) => setOptions(r.data)).catch(() => undefined); }, [loadCoverage]);

  const refresh = () => { void load(); void loadCoverage(); };

  const caution = (projectId: string): string | null => {
    const row = cov?.rows.find((r) => r.project_id === projectId);
    if (!row) return null;
    if (row.active.length) return `${row.project_name} already has an active investigation (${row.active.map((a) => `${a.developer_name}: ${a.status_label}`).join(', ')}).`;
    if (row.last_investigated_on && !row.due_for_review) return `${row.project_name} was investigated ${row.days_since} day${row.days_since === 1 ? '' : 's'} ago by ${row.last_investigator}. It is not due for another review yet (every ${cov?.interval_days} days).`;
    return null;
  };

  const create = async (d: InvAssignInput) => {
    setSaving(true); setFormError(null);
    try { const r = await pmApi.invCreate(d); setForm(null); refresh(); setOpenId(r.data.investigation.id); } catch (e) { setFormError(errText(e, 'Could not create the assignment.')); } finally { setSaving(false); }
  };

  if (openId !== null) return <InvDetail id={openId} options={options} onBack={() => { setOpenId(null); refresh(); }} onChanged={refresh} />;

  const s = data?.summary;
  const projectChoices = options?.projects ?? [];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        <StatTile label="Active assignments" value={s?.active ?? '–'} />
        <StatTile label="Not started" value={s?.not_started ?? '–'} />
        <StatTile label="In progress" value={s?.in_progress ?? '–'} />
        <StatTile label="Awaiting review" value={s?.awaiting_review ?? '–'} tone={s?.awaiting_review ? 'warn' : 'neutral'} />
        <StatTile label="Completed this week" value={s?.completed_this_week ?? '–'} />
        {s && s.projects_needing !== null && <StatTile label="Projects needing investigation" value={s.projects_needing} tone={s.projects_needing ? 'info' : 'neutral'} hint={`None active and not investigated in ${cov?.interval_days ?? 90} days`} />}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1.5">
          <button className={btnChip(view === 'assignments')} onClick={() => setView('assignments')}>Assignments</button>
          <button className={btnChip(view === 'coverage')} onClick={() => setView('coverage')}>Coverage &amp; rotation</button>
        </div>
        <button className={btnPrimary} onClick={() => { setFormError(null); setForm({}); }}>+ Assign investigation</button>
      </div>

      {data?.warnings.map((w) => <Notice key={w} tone="warn">{w}</Notice>)}
      {error && <Notice tone="danger">{error} <button className="underline" onClick={refresh}>Try again</button></Notice>}
      {form && <InvAssignForm options={options} preset={form} saving={saving} error={formError} onSave={(d) => void create(d)} onCancel={() => setForm(null)} caution={caution} />}

      {view === 'assignments' ? (
        <>
          <div className="grid gap-2 rounded-xl border border-slate-200/80 bg-white p-3 sm:grid-cols-2 lg:grid-cols-4">
            <input className={inputCls} placeholder="Search project, developer, findings…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search investigations" />
            <select className={inputCls} value={developer} onChange={(e) => setDeveloper(e.target.value)} aria-label="Developer"><option value="">All developers</option>{options?.developers.map((d) => <option key={d.name}>{d.name}</option>)}</select>
            <select className={inputCls} value={project} onChange={(e) => setProject(e.target.value)} aria-label="Project"><option value="">All projects</option>{projectChoices.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
            <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">All statuses</option>{(Object.keys(STATUS_LABEL) as InvStatus[]).map((k) => <option key={k} value={k}>{STATUS_LABEL[k]}</option>)}</select>
            <select className={inputCls} value={priority} onChange={(e) => setPriority(e.target.value)} aria-label="Priority"><option value="">Any priority</option>{PRIORITIES.map((p) => <option key={p} value={p}>{cap(p)}</option>)}</select>
            <label className="flex items-center gap-2 text-xs text-slate-500">Assigned from <input type="date" className={inputCls} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
            <label className="flex items-center gap-2 text-xs text-slate-500">to <input type="date" className={inputCls} value={to} onChange={(e) => setTo(e.target.value)} /></label>
          </div>

          <Section id="inv-table" title="Investigation assignments" count={data?.meta.total ?? 0} persist={false} bare>
            {loading && !data ? <p className="p-4 text-sm text-slate-500">Loading…</p> : !data?.investigations.length ? (
              <div className="p-4"><EmptyState title="No investigations">{search || developer || project || status || priority || from || to ? 'Nothing matches those filters.' : 'Assign a Taskmandu project to a developer to review it.'}</EmptyState></div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[780px] text-left text-sm">
                  <thead className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-500">
                    <tr><th className="px-3 py-2">Project</th><th className="px-3 py-2">Developer</th><th className="px-3 py-2">Assigned</th><th className="px-3 py-2">Due</th><th className="px-3 py-2">Priority</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Last investigated</th><th className="px-3 py-2 text-right">Actions</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.investigations.map((i) => (
                      <tr key={i.id} className="hover:bg-slate-50/60">
                        <td className="px-3 py-2 font-medium text-slate-800"><button className="text-left hover:underline" onClick={() => setOpenId(i.id)}>{i.project_name}</button></td>
                        <td className="px-3 py-2 text-slate-700">{i.developer_name}</td>
                        <td className="px-3 py-2 text-slate-600">{fmtDate(i.assigned_on)}</td>
                        <td className={`px-3 py-2 ${i.overdue ? 'font-medium text-rose-600' : 'text-slate-600'}`}>{fmtDate(i.due_date)}{i.overdue ? ' · overdue' : ''}</td>
                        <td className="px-3 py-2"><PriorityBadge value={i.priority} /></td>
                        <td className="px-3 py-2"><StatusPill status={i.status} /></td>
                        <td className="px-3 py-2 text-slate-600">{fmtDate(i.last_investigated_on)}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right">
                          <button className="text-xs font-medium text-indigo-600 hover:underline" onClick={() => setOpenId(i.id)}>{i.status === 'awaiting_review' ? 'Review findings' : 'View details'}</button>
                          {i.status !== 'completed' && <> · <button className="text-xs font-medium text-indigo-600 hover:underline" onClick={() => setOpenId(i.id)}>Edit / reassign</button></>}
                          {(i.status === 'awaiting_review' || i.status === 'reviewed') && <> · <button className="text-xs font-medium text-indigo-600 hover:underline" onClick={() => setOpenId(i.id)}>Close</button></>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {data && data.meta.last_page > 1 && (
              <div className="flex items-center justify-between border-t border-slate-100 px-3 py-2 text-xs text-slate-500">
                <span>Page {data.meta.page} of {data.meta.last_page}</span>
                <span className="flex gap-1.5"><button className={btnSecondary} disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><button className={btnSecondary} disabled={page >= data.meta.last_page} onClick={() => setPage(page + 1)}>Next</button></span>
              </div>
            )}
          </Section>
        </>
      ) : (
        <Section id="inv-coverage" title="Coverage and rotation" persist={false} count={cov?.rows.length ?? 0} bare
          subtitle={`Projects due for review have no active investigation and haven't been investigated in ${cov?.interval_days ?? 90} days. Rotation is manual: nothing is assigned automatically.`}>
          {cov?.warnings.map((w) => <div key={w} className="p-3"><Notice tone="warn">{w}</Notice></div>)}
          {!cov ? <p className="p-4 text-sm text-slate-500">Loading…</p> : cov.rows.length === 0 ? <div className="p-4"><EmptyState title="No projects found">Projects come from Taskmandu.</EmptyState></div> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-2">Project</th><th className="px-3 py-2">Last investigated</th><th className="px-3 py-2">Last investigator</th><th className="px-3 py-2">Active</th><th className="px-3 py-2">Past investigations</th><th className="px-3 py-2 text-right">Action</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {cov.rows.map((r) => (
                    <tr key={r.project_id} className="align-top hover:bg-slate-50/60">
                      <td className="px-3 py-2"><div className="font-medium text-slate-800">{r.project_name}</div>{r.business && r.business !== r.project_name && <div className="text-xs text-slate-500">{r.business}</div>}{r.unavailable && <Pill tone="neutral" title="No longer listed in Taskmandu. History is kept.">Unavailable</Pill>}</td>
                      <td className="px-3 py-2 text-slate-700">{r.last_investigated_on ? <>{fmtDate(r.last_investigated_on)} <span className="text-xs text-slate-400">({r.days_since}d ago)</span></> : <span className="text-slate-400">Never</span>}{r.due_for_review && <div><Pill tone="warn">Due for review</Pill></div>}</td>
                      <td className="px-3 py-2 text-slate-700">{r.last_investigator ?? '—'}</td>
                      <td className="px-3 py-2">{r.active.length ? r.active.map((a) => <button key={a.id} className="block text-left text-xs text-indigo-700 hover:underline" onClick={() => setOpenId(a.id)}>{a.developer_name} · {a.status_label}</button>) : <span className="text-slate-400">—</span>}</td>
                      <td className="px-3 py-2 text-xs text-slate-600">{r.investigated_count === 0 ? '—' : r.history.map((h) => <button key={h.id} className="block text-left hover:underline" onClick={() => setOpenId(h.id)}>{fmtDate(h.date)} · {h.developer_name}</button>)}</td>
                      <td className="px-3 py-2 text-right">{!r.unavailable && <button className={btnSecondary} onClick={() => { setView('assignments'); setFormError(null); setForm({ project_id: r.project_id }); }}>Assign</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      )}
    </div>
  );
}
