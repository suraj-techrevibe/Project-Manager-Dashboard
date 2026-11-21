import axios from 'axios';
import { useEffect, useMemo, useState } from 'react';
import type { PmPage } from '@/lib/pmNav';
import type { TodayData } from '@/types/pm';

type Params = Record<string, string | null | undefined>;
type Step = { id: string; title: string; explanation: string; page: PmPage; params?: Params; button: string; optional?: boolean };
const STEPS: Step[] = [
 { id:'health', title:'Check system health', explanation:'Confirm the dashboard data is loading and Taskmandu sync is recent. If authentication errors appear, stop retrying sync and investigate.', page:'today', button:'Check system status' },
 { id:'triage', title:'Handle urgent issues first', explanation:'Review overdue, blocked and stalled tasks. Identify who owns the next action and what needs escalation.', page:'tasks', params:{tq:'overdue'}, button:'Open overdue tasks' },
 { id:'qa', title:'Do your QA work', explanation:'Test submissions against the requirement. Record Pass or Fail, evidence and notes in QA Center. QA does not change Taskmandu status.', page:'qa', button:'Open QA Center' },
 { id:'team', title:'Check team progress', explanation:'Review workload, blockers, progress and interruptions across businesses. Clarify what must move and what is being delayed.', page:'today', button:'Review team workload' },
 { id:'intake', title:'Capture new requests', explanation:'Capture new requests from your boss, clients or team in Operations. Assign a business, clarify priority and record decisions.', page:'operations', button:'Open Operations' },
 { id:'plan', title:'Set today’s priorities', explanation:'Choose up to three outcomes. Align them with the boss and Senior Dev and ensure owners and delivery expectations are clear.', page:'reports', button:'Plan and report' },
];
function dateKey(){const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
function syncLabel(v?:string|null){if(!v)return 'No successful sync recorded';const d=new Date(v);return Number.isNaN(d.getTime())?'Sync time unavailable':d.toLocaleString(undefined,{weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});}
export default function DailyChecklistPanel({today,loading,error,onRetry,onNavigate}:{today:TodayData|null;loading:boolean;error:string|null;onRetry:()=>void;onNavigate:(page:PmPage,params?:Params)=>void}){
 const key=useMemo(dateKey,[]);
 const [stepIndex,setStepIndex]=useState(()=>{try{return Math.min(Number(localStorage.getItem('pm-myday-step:'+key)||0),STEPS.length-1)}catch{return 0}});
 const [completed,setCompleted]=useState<Record<string,boolean>>(()=>{try{return JSON.parse(localStorage.getItem('pm-myday-done:'+key)||'{}')}catch{return {}}});
 const [qa,setQa]=useState<any[]|null>(null); const [qaErr,setQaErr]=useState<string|null>(null); const [qaLoading,setQaLoading]=useState(true);
 useEffect(()=>{let active=true;const load=async()=>{try{const {data}=await axios.get('/pm/api/qa/task-inbox');if(active){setQa(data.reviews??[]);setQaErr(null)}}catch(e:any){if(active)setQaErr(e?.response?.data?.message||'QA data unavailable')}finally{if(active)setQaLoading(false)}};void load();const timer=window.setInterval(()=>void load(),60000);return()=>{active=false;window.clearInterval(timer)}},[]);
 useEffect(()=>{try{localStorage.setItem('pm-myday-step:'+key,String(stepIndex))}catch{}},[stepIndex,key]);
 useEffect(()=>{try{localStorage.setItem('pm-myday-done:'+key,JSON.stringify(completed))}catch{}},[completed,key]);
 const sync=today?.operations_summary?.sync; const syncAt=sync?.last_synced_at??today?.lastSyncedAt??null;
 const qaWaiting=qa?.filter(x=>x.qa_status==='Awaiting QA'&&['Completed','Review'].includes(x.task_status)).length;
 const qaFailed=qa?.filter(x=>x.qa_status==='Failed').length;
 const metrics=today?.metrics; const active=STEPS[stepIndex]; const done=STEPS.filter(s=>completed[s.id]).length;
 const advance=()=>{setCompleted(c=>({...c,[active.id]:true}));setStepIndex(i=>Math.min(i+1,STEPS.length-1));};
 return <div className="space-y-4">
  <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
   <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-indigo-600">Daily operations guide</p><h2 className="mt-1 text-2xl font-bold text-slate-900">My Day</h2><p className="mt-1 text-sm text-slate-500">Follow the next action. You can jump to any stage, and your progress is saved for today in this browser.</p></div><div className="text-sm font-medium text-slate-600">{done} of {STEPS.length} stages done</div></div>
   <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-indigo-500" style={{width:(done/STEPS.length*100)+'%'}}/></div>
   <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">{STEPS.map((s,i)=><button key={s.id} onClick={()=>setStepIndex(i)} className={'rounded-lg border p-2 text-left text-xs font-semibold '+(i===stepIndex?'border-indigo-400 bg-indigo-50 text-indigo-800':'border-slate-200 bg-white text-slate-600')}><span className="block text-[10px] text-slate-400">STEP {i+1}</span>{completed[s.id]?'✓ ':''}{s.title}</button>)}</div>
  </section>
  <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
   {[['Overdue',metrics?.overdue??'—','tasks',{tq:'overdue'}],['Blocked',metrics?.blocked??'—','tasks',{tq:'blocked'}],['Awaiting QA',qaLoading?'…':qaWaiting??'—','qa',{}],['Failed QA',qaLoading?'…':qaFailed??'—','qa',{}]].map(([label,value,page,params]:any)=><button key={label} onClick={()=>onNavigate(page,params)} className="rounded-xl border border-slate-200 bg-white p-3 text-left hover:border-indigo-300"><div className="text-xs text-slate-500">{label}</div><div className="mt-1 text-2xl font-bold text-slate-900">{value}</div><div className="text-xs text-indigo-600">Open details →</div></button>)}
  </section>
  <section className="rounded-2xl border border-indigo-200 bg-white p-5 shadow-sm">
   <div className="text-xs font-semibold uppercase tracking-wide text-indigo-600">Your next step · {stepIndex+1} of {STEPS.length}</div><h3 className="mt-2 text-xl font-bold text-slate-900">{active.title}</h3><p className="mt-2 text-sm leading-6 text-slate-600">{active.explanation}</p>
   {active.id==='health'&&<div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm"><div>Dashboard: {error?'Needs attention':loading?'Loading…':today?'Data loaded':'Not verified'}</div><div className="mt-1">Taskmandu last sync: {syncLabel(syncAt)}</div>{sync?.error&&<div className="mt-1 text-rose-700">Sync error: {sync.error.message}</div>}{sync?.warning&&<div className="mt-1 text-amber-700">Sync warning: {sync.warning.message}</div>}{error&&<div className="mt-1 text-rose-700">{error}</div>}<button onClick={onRetry} className="mt-2 text-xs font-semibold text-indigo-600">Refresh dashboard data</button></div>}
   {active.id==='triage'&&<div className="mt-3 text-sm text-slate-600">Stalled items: {metrics?.stuck??'—'} · Unassigned: {metrics?.unassigned??'—'} · Due today: {metrics?.due_today??'—'}</div>}
   {active.id==='qa'&&<div className="mt-3 text-sm text-slate-600">{qaErr?'QA data error: '+qaErr:qaLoading?'Loading QA inbox…':(qaWaiting??0)+' waiting for QA · '+(qaFailed??0)+' failed/retest items'}</div>}
   {active.id==='team'&&<div className="mt-3 text-sm text-slate-600">{today?today.workload.map(w=>w.name+': '+w.open+' open, '+w.overdue+' overdue'+(w.blocked?' · '+w.blocked+' blocked':'')).join(' · '):'Workload data not loaded'}</div>}
   <div className="mt-5 flex flex-wrap gap-2"><button onClick={()=>onNavigate(active.page,active.params)} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700">{active.button} →</button><button onClick={advance} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700">Mark reviewed & continue</button><button onClick={()=>setCompleted(c=>({...c,[active.id]:false}))} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600">Unmark</button></div>
   <div className="mt-4 flex justify-between"><button disabled={stepIndex===0} onClick={()=>setStepIndex(i=>Math.max(i-1,0))} className="text-sm text-slate-500 disabled:opacity-40">← Previous</button><button onClick={()=>setStepIndex(i=>Math.min(i+1,STEPS.length-1))} className="text-sm font-semibold text-indigo-600">Skip / next →</button></div>
  </section>
  {done===STEPS.length&&<section className="rounded-xl border border-slate-200 p-4"><h3 className="font-semibold">Daily routine reviewed</h3><p className="mt-1 text-sm text-slate-500">You marked all stages reviewed. Issues can still change during the day—use the live counters above to revisit them.</p><button onClick={()=>{setCompleted({});setStepIndex(0)}} className="mt-2 text-sm font-semibold text-indigo-600">Start a new pass</button></section>}
 </div>;
}
