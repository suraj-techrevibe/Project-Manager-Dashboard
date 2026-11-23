import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';

type Website = {
  id: number; business: string; name: string; url: string; status: string;
  last_http_status: number | null; last_response_ms: number | null;
  last_result: string | null; last_checked_at: string | null; is_active: boolean;
};
const field = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm';
const button = 'rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50';
const dateLabel = (value: string | null) => value ? new Date(value).toLocaleString() : 'Never checked';

export default function WebsiteQA() {
  const [websites, setWebsites] = useState<Website[]>([]);
  const [businesses, setBusinesses] = useState<string[]>([]);
  const [business, setBusiness] = useState('');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [filter, setFilter] = useState('All businesses');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState<number | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const { data } = await axios.get('/pm/api/qa/websites');
      setWebsites(data.websites ?? []);
      setBusinesses(data.businesses ?? []);
      setBusiness(current => current || data.businesses?.[0] || '');
    } catch {
      setError('Could not load registered websites.');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const grouped = useMemo(() => {
    const rows = filter === 'All businesses' ? websites : websites.filter(site => site.business === filter);
    return rows.reduce<Record<string, Website[]>>((groups, site) => {
      (groups[site.business] ??= []).push(site);
      return groups;
    }, {});
  }, [websites, filter]);

  async function addWebsite(event: FormEvent) {
    event.preventDefault();
    if (!business || !name.trim() || !url.trim()) return;
    setSaving(true); setError('');
    try {
      await axios.post('/pm/api/qa/websites', { business, name: name.trim(), url: url.trim() });
      setName(''); setUrl('');
      await load();
    } catch (e) {
      const message = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(message || 'Could not register this website. Check the business and URL.');
    } finally { setSaving(false); }
  }

  async function runCheck(site: Website) {
    setRunning(site.id); setError('');
    try {
      const { data } = await axios.post('/pm/api/qa/websites/'+site.id+'/run');
      setWebsites(current => current.map(item => item.id === site.id ? data.website : item));
    } catch (e) {
      const message = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(message || 'Website check failed to run.');
    } finally { setRunning(null); }
  }

  async function remove(site: Website) {
    if (!window.confirm('Remove '+site.name+' from the website QA registry?')) return;
    try {
      await axios.delete('/pm/api/qa/websites/'+site.id);
      setWebsites(current => current.filter(item => item.id !== site.id));
    } catch { setError('Could not remove this website.'); }
  }

  return <div className="space-y-4">
    <section className="rounded-xl border bg-white p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h2 className="text-lg font-semibold">Website QA</h2><p className="text-sm text-slate-500">Register websites under their Taskmandu business and run a live availability check.</p></div>
        <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">Website registry</span>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg bg-slate-50 p-3"><div className="text-xs text-slate-500">Websites</div><div className="text-2xl font-semibold">{websites.length}</div></div>
        <div className="rounded-lg bg-emerald-50 p-3"><div className="text-xs text-emerald-700">Healthy</div><div className="text-2xl font-semibold">{websites.filter(s=>s.status==='Healthy').length}</div></div>
        <div className="rounded-lg bg-rose-50 p-3"><div className="text-xs text-rose-700">Issues found</div><div className="text-2xl font-semibold">{websites.filter(s=>s.status==='Issues found').length}</div></div>
        <div className="rounded-lg bg-slate-50 p-3"><div className="text-xs text-slate-500">Not checked</div><div className="text-2xl font-semibold">{websites.filter(s=>s.status==='Not checked').length}</div></div>
      </div>
    </section>

    <section className="rounded-xl border bg-white p-4 space-y-3">
      <h3 className="font-semibold">Add a website</h3>
      {businesses.length === 0 ? <p className="text-sm text-slate-500">Add a business in Operations first. Website QA uses the existing Taskmandu business list.</p> : (
        <form onSubmit={addWebsite} className="grid gap-3 md:grid-cols-2">
          <select className={field} value={business} onChange={e=>setBusiness(e.target.value)} required>
            {businesses.map(item=><option key={item} value={item}>{item}</option>)}
          </select>
          <input className={field} value={name} onChange={e=>setName(e.target.value)} placeholder="Website name" required maxLength={200}/>
          <input className={field+' md:col-span-2'} type="url" value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://example.com" required/>
          <div><button disabled={saving} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white">{saving?'Saving…':'＋ Add website'}</button></div>
        </form>
      )}
    </section>

    <section className="rounded-xl border bg-white p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-semibold">Registered websites by business</h3><p className="text-xs text-slate-500">Run QA Now performs an HTTP availability and response check.</p></div><button className={button} onClick={()=>void load()}>Refresh</button></div>
      <select className={field} value={filter} onChange={e=>setFilter(e.target.value)}><option>All businesses</option>{businesses.map(item=><option key={item}>{item}</option>)}</select>
      {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
      {loading ? <p className="py-6 text-center text-sm text-slate-500">Loading websites…</p> : Object.keys(grouped).length === 0 ? <p className="py-6 text-center text-sm text-slate-500">No websites registered yet. Add your first website above.</p> : Object.entries(grouped).map(([group, rows])=><div key={group} className="space-y-2"><h4 className="border-b pb-2 text-sm font-semibold text-slate-700">{group}</h4>{rows.map(site=><article key={site.id} className="rounded-lg border p-3 space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><div className="font-medium">{site.name}</div><a className="break-all text-xs text-indigo-700" href={site.url} target="_blank" rel="noreferrer">{site.url}</a></div><span className={'rounded-full px-2 py-1 text-xs font-medium '+(site.status==='Healthy'?'bg-emerald-50 text-emerald-700':site.status==='Issues found'?'bg-rose-50 text-rose-700':'bg-slate-100 text-slate-600')}>{site.status}</span></div>
        {site.last_result && <p className="text-sm text-slate-600">{site.last_result}</p>}
        <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-xs text-slate-500">Last checked: {dateLabel(site.last_checked_at)}{site.last_http_status ? ' · HTTP '+site.last_http_status : ''}{site.last_response_ms !== null ? ' · '+site.last_response_ms+' ms' : ''}</span><div className="flex gap-2"><button className={button} disabled={running!==null} onClick={()=>void runCheck(site)}>{running===site.id?'Checking…':'Run QA now'}</button><button className="px-2 py-2 text-xs text-rose-600" onClick={()=>void remove(site)}>Remove</button></div></div>
      </article>)}</div>)}
    </section>
    <p className="text-xs text-slate-500">Current automated check: public-site reachability, HTTP response and response time. It does not yet test links, forms, checkout, login, page layout or business workflows. Redirects are reported but not followed.</p>
  </div>;
}
