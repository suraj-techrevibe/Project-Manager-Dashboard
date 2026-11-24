import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import ReviewPanel from './QA/ReviewPanel';
import SummaryTable from './QA/SummaryTable';
import { BusinessPanel, ItemPanel, SitePanel } from './QA/AddPanels';
import { button, dateTime, errorMessage, input, primary, SOURCES, STAGES, stageClass, type Payload, type QAItem, type Source, type Stage } from './QA/types';

type Panel = 'none' | 'business' | 'site' | 'item' | 'summary';
type Sort = 'newest' | 'oldest' | 'code';

const tab = (active: boolean) => (active ? primary : button);
const EMPTY: Payload = { items: [], sites: [], businesses: [], members: [], projects: [] };
const stageTone: Record<Stage, string> = { Queue: 'text-blue-700', Testing: 'text-amber-700', Failed: 'text-rose-700', Passed: 'text-emerald-700' };

export default function QACenter() {
  const [data, setData] = useState<Payload>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>('none');
  const [search, setSearch] = useState('');
  const [business, setBusiness] = useState('');
  const [site, setSite] = useState('');
  const [source, setSource] = useState<'' | Source>('');
  const [assignee, setAssignee] = useState('');
  const [stage, setStage] = useState<'' | Stage>('');
  const [sort, setSort] = useState<Sort>('newest');
  const rootRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const res = await axios.get<Payload>('/pm/api/qa-center');
      setData(res.data);
      setError('');
    } catch (e) { setError(errorMessage(e, 'Could not load QA Center.')); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Refresh in the background, only while this tab is actually on screen.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible' && rootRef.current && rootRef.current.offsetParent !== null) void load(true);
    }, 60000);
    return () => window.clearInterval(id);
  }, [load]);

  const replaceItem = (item: QAItem) => setData(d => ({ ...d, items: d.items.map(i => (i.key === item.key ? item : i)) }));

  const assignees = useMemo(() => [...new Set(data.items.map(i => i.assignee).filter((v): v is string => !!v))].sort(), [data.items]);
  const siteNames = useMemo(() => [...new Set(data.items.filter(i => !business || i.business === business).map(i => i.site).filter((v): v is string => !!v))].sort(), [data.items, business]);

  // Everything except the stage filter, so the stage cards always show true counts for the other filters.
  const scoped = useMemo(() => {
    const q = search.trim().toLowerCase();
    return data.items.filter(i =>
      (!business || i.business === business) && (!site || i.site === site) && (!source || i.source === source) && (!assignee || i.assignee === assignee)
      && (!q || [i.code, i.title, i.business, i.site, i.url, i.assignee].some(v => (v ?? '').toLowerCase().includes(q))));
  }, [data.items, search, business, site, source, assignee]);

  const visible = useMemo(() => {
    const list = stage ? scoped.filter(i => i.stage === stage) : scoped;
    const by: Record<Sort, (a: QAItem, b: QAItem) => number> = {
      newest: (a, b) => b.updated_at.localeCompare(a.updated_at),
      oldest: (a, b) => a.updated_at.localeCompare(b.updated_at),
      code: (a, b) => (a.code ?? '').localeCompare(b.code ?? '', undefined, { numeric: true }),
    };
    return [...list].sort(by[sort]);
  }, [scoped, stage, sort]);

  const selected = data.items.find(i => i.key === selectedKey) ?? null;
  const counts = (s: Stage) => scoped.filter(i => i.stage === s).length;
  const filtered = !!(search || business || site || source || assignee || stage);
  const scope = [business || 'All projects', site || null, source || null, assignee || null, stage || null].filter(Boolean).join(' · ');

  function clear() { setSearch(''); setBusiness(''); setSite(''); setSource(''); setAssignee(''); setStage(''); }
  const toggle = (p: Panel) => setPanel(cur => (cur === p ? 'none' : p));

  const form = panel === 'business'
    ? <BusinessPanel businesses={data.businesses} sites={data.sites} items={data.items} onChanged={() => load(true)} onClose={() => setPanel('none')}/>
    : panel === 'site'
    ? <SitePanel businesses={data.businesses} projects={data.projects} sites={data.sites} onSaved={() => load(true)} onClose={() => setPanel('none')}/>
    : panel === 'item'
      ? <ItemPanel members={data.members} businesses={data.businesses} sites={data.sites} onClose={() => setPanel('none')}
          onCreated={item => { setData(d => ({ ...d, items: [item, ...d.items] })); setSelectedKey(item.key); setPanel('none'); void load(true); }}/>
      : null;

  return <div ref={rootRef} className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h2 className="text-lg font-semibold text-slate-900">QA Center</h2><p className="text-sm text-slate-500">Queue, test, then pass or send back.</p></div>
      <div className="flex flex-wrap gap-2">
        <button className={tab(panel === 'business')} aria-pressed={panel === 'business'} onClick={() => toggle('business')}>+ Project</button>
        <button className={tab(panel === 'site')} aria-pressed={panel === 'site'} onClick={() => toggle('site')}>+ Site or app</button>
        <button className={tab(panel === 'item')} aria-pressed={panel === 'item'} onClick={() => toggle('item')}>+ QA item</button>
        <button className={tab(panel === 'summary')} aria-pressed={panel === 'summary'} onClick={() => toggle('summary')}>Summary</button>
        <button className={button} onClick={() => void load()}>Refresh</button>
      </div>
    </div>

    {error && <div role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}

    <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
      {STAGES.map(s => <button key={s} onClick={() => setStage(cur => (cur === s ? '' : s))}
        className={`rounded-xl border bg-white p-3 text-left transition hover:border-indigo-300 ${stage === s ? 'border-indigo-600 ring-1 ring-indigo-600' : ''}`} aria-pressed={stage === s}>
        <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{s}</div>
        <div className={`text-2xl font-semibold ${stageTone[s]}`}>{counts(s)}</div>
      </button>)}
    </div>

    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
      <input className={input + ' lg:col-span-2'} type="search" placeholder="Search code, title, URL" value={search} onChange={e => setSearch(e.target.value)}/>
      <select className={input} aria-label="Project" value={business} onChange={e => { setBusiness(e.target.value); setSite(''); }}><option value="">All projects</option>{data.businesses.map(b => <option key={b}>{b}</option>)}</select>
      <select className={input} aria-label="Site or app" value={site} onChange={e => setSite(e.target.value)}><option value="">All sites / apps</option>{siteNames.map(s => <option key={s}>{s}</option>)}</select>
      <select className={input} aria-label="Source" value={source} onChange={e => setSource(e.target.value as '' | Source)}><option value="">All sources</option>{SOURCES.map(s => <option key={s}>{s}</option>)}</select>
      <select className={input} aria-label="Assignee" value={assignee} onChange={e => setAssignee(e.target.value)}><option value="">Everyone</option>{assignees.map(a => <option key={a}>{a}</option>)}</select>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-500">
      <span>{visible.length} of {data.items.length} items</span>
      <div className="flex items-center gap-2">
        <select className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm" aria-label="Sort" value={sort} onChange={e => setSort(e.target.value as Sort)}><option value="newest">Recently updated</option><option value="oldest">Oldest updated</option><option value="code">QA code</option></select>
        {filtered && <button className="font-medium text-indigo-700 hover:underline" onClick={clear}>Clear filters</button>}
      </div>
    </div>

    {panel === 'summary'
      ? <SummaryTable members={data.members} items={visible} scope={scope} onChange={replaceItem}/>
      : <div className="grid gap-4 md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <div className="space-y-2">
        {loading && <p className="text-sm text-slate-500">Loading…</p>}
        {!loading && visible.length === 0 && <div className="rounded-xl border border-dashed bg-white p-6 text-center text-sm text-slate-500">{data.items.length === 0 ? 'No QA items yet. Add a site or app, then a QA item. Taskmandu tasks arrive on their own.' : 'Nothing matches these filters.'}</div>}
        {visible.map(i => {
          const done = i.checks.filter(c => c.is_done).length;
          return <button key={i.key} onClick={() => { setSelectedKey(i.key); if (panel === 'business' || panel === 'site' || panel === 'item') setPanel('none'); }}
            className={`block w-full rounded-xl border bg-white p-3 text-left transition hover:border-indigo-300 ${selected?.key === i.key ? 'border-indigo-600 ring-1 ring-indigo-600' : ''}`}>
            <div className="flex flex-wrap items-center gap-2"><span className="font-mono text-xs font-semibold text-slate-600">{i.code ?? '—'}</span><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${stageClass[i.stage]}`}>{i.stage}</span><span className="text-xs text-slate-400">{i.source}</span></div>
            <div className="mt-1 break-words text-sm font-medium text-slate-900">{i.title}</div>
            <div className="mt-0.5 truncate text-xs text-slate-500">{[i.business, i.site, i.assignee].filter(Boolean).join(' · ') || 'No business or site'}</div>
            <div className="mt-1 flex items-center justify-between text-xs text-slate-400"><span>{i.checks.length ? `${done}/${i.checks.length} checked` : 'No checks'}{i.screenshots.length ? ` · ${i.screenshots.length} shot${i.screenshots.length > 1 ? 's' : ''}` : ''}</span><span>{dateTime(i.updated_at)}</span></div>
          </button>;
        })}
      </div>

      {/* Desktop: side panel. Mobile: full-screen overlay. */}
      <div className="hidden md:block">
        {form ? <div className="sticky top-4">{form}</div> : selected
          ? <div className="sticky top-4"><ReviewPanel members={data.members} businesses={data.businesses} sites={data.sites} item={selected} onChange={replaceItem} onClose={() => setSelectedKey(null)} onDeleted={key => { setData(d => ({ ...d, items: d.items.filter(i => i.key !== key) })); setSelectedKey(null); }}/></div>
          : <div className="rounded-xl border border-dashed bg-white p-8 text-center text-sm text-slate-500">Select an item to review it.</div>}
      </div>
    </div>}

    {(form || selected) && panel !== 'summary' && <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-100 p-3 md:hidden">
      {form ?? (selected && <ReviewPanel members={data.members} businesses={data.businesses} sites={data.sites} item={selected} onChange={replaceItem} onClose={() => setSelectedKey(null)} onDeleted={key => { setData(d => ({ ...d, items: d.items.filter(i => i.key !== key) })); setSelectedKey(null); }}/>)}
    </div>}
  </div>;
}
