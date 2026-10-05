import type { Employee, ExistingTitle, TaskPriority } from '../types/pm';

export const BRIEF_MAX_CHARS = 8000;
export const MAX_TICKETS = 30;

export interface EditableSubtask {
  uid: string;
  title: string;
  description: string;
  assigneeId: string;
  dueDate: string;
}

export interface EditableTicket {
  uid: string;
  title: string;
  description: string;
  level: string;
  estimate_hours: number | '';
  priority: TaskPriority;
  assigneeId: string;
  dueDate: string;
  projectId: string;
  projectName: string;
  projectNeedsConfirmation: boolean;
  projectConfirmed: boolean;
  subtasks: EditableSubtask[];
  state: 'draft' | 'pushed' | 'failed';
  error?: string;
}

let counter = 0;
export function blankTicket(partial: Partial<EditableTicket> = {}): EditableTicket {
  return { uid:`t${Date.now().toString(36)}${counter++}`, title:'', description:'', level:'intern', estimate_hours:2, priority:'Medium', assigneeId:'', dueDate:'', projectId:'', projectName:'', projectNeedsConfirmation:false, projectConfirmed:false, subtasks:[], state:'draft', ...partial };
}
export function blankSubtask(partial: Partial<EditableSubtask> = {}): EditableSubtask {
  return { uid:`s${Date.now().toString(36)}${counter++}`, title:'', description:'', assigneeId:'', dueDate:'', ...partial };
}

interface Rule { re:RegExp; senior:boolean; hours:number; questions:string[]; }
const RULES:Rule[]=[
 {re:/payment|stripe|razorpay|paypal|checkout|gateway|invoice|subscription|billing|refund/i,senior:true,hours:8,questions:['Which payment gateway and currency?','Are refunds, taxes or invoices needed?']},
 {re:/\blog ?in\b|sign ?in|sign ?up|register|\bauth|oauth|\bsso\b|password|\botp\b|\b2fa\b/i,senior:true,hours:5,questions:['Which sign-in methods are needed (email/password, Google, SSO, OTP)?']},
 {re:/\bapi\b|integrat|webhook|third[- ]party|\bcrm\b|\berp\b|\bsync/i,senior:true,hours:6,questions:['Which third-party systems or APIs are involved, and do we have their docs and credentials?']},
 {re:/database|migrat|\bimport\b|schema|existing data/i,senior:true,hours:5,questions:['Where does the existing data live, and in what format?']},
 {re:/deploy|hosting|server|domain|\bssl\b|\baws\b|devops|security/i,senior:true,hours:4,questions:['Who provides hosting and the domain, and what is the go-live date?']},
 {re:/mobile|\bios\b|android|app store/i,senior:true,hours:8,questions:['Is this mobile web only, or native iOS/Android apps?']},
 {re:/admin|\brole|permission|dashboard/i,senior:false,hours:4,questions:['Which user roles are needed, and what can each one do?']},
 {re:/report|analytics|chart|\bexport|\bcsv\b|\bpdf\b/i,senior:false,hours:4,questions:['Which reports or exports are needed, and in what format?']},
 {re:/e-?mail|notification|newsletter|\bsms\b/i,senior:false,hours:2,questions:['Which email/SMS provider should be used, and what triggers each message?']},
 {re:/\bform\b|contact us|survey|validation/i,senior:false,hours:2,questions:['What fields and validation does each form need?']},
 {re:/\bpage\b|landing|\bui\b|\bux\b|design|layout|responsive|homepage|banner|footer|header|menu|theme/i,senior:false,hours:3,questions:['Are designs (Figma or brand assets) provided, or do we design from scratch?']},
 {re:/content|\bcopy\b|\btext\b|image|\bblog\b|\bseo\b/i,senior:false,hours:2,questions:['Who provides the final copy and images?']},
 {re:/multi[- ]?lang|translation|language|locale|i18n/i,senior:false,hours:3,questions:['Which languages are needed?']},
 {re:/\blist\b|\btable\b|crud|search|filter|manage/i,senior:false,hours:3,questions:[]},
];
export function keywordQuestions(text:string):string[]{const out:string[]=[];RULES.forEach(r=>{if(r.re.test(text))r.questions.forEach(q=>out.push(q));});return out;}
export function guessTicket(line:string):{level:string;estimate_hours:number}{const hits=RULES.filter(r=>r.re.test(line));if(!hits.length)return{level:'intern',estimate_hours:2};return{level:hits.some(h=>h.senior)?'senior dev':'intern',estimate_hours:Math.max(...hits.map(h=>h.hours))};}
export function splitBrief(text:string):{tickets:EditableTicket[];dropped:number}{const lines=text.split(/\r?\n/).map(l=>l.replace(/^\s*(?:[-*•–—]|\d+[.)]|\[[ xX]?\])\s+/,'').trim()).filter(l=>l.length>=4&&!(l.endsWith(':')&&l.length<40));const tickets=lines.slice(0,MAX_TICKETS).map(line=>{const long=line.length>160;const title=long?(line.split(/(?<=[.!?])\s/)[0]??line).slice(0,120):line.slice(0,190);const guess=guessTicket(line);return blankTicket({title,description:long?line:'',level:guess.level,estimate_hours:guess.estimate_hours});});return{tickets,dropped:Math.max(0,lines.length-MAX_TICKETS)};}
export function questionsEmail(questions:string[]):string{return['Hi,','','Thanks for the brief. Before we start, a few quick questions so we build the right thing:','',...questions.map((q,i)=>`${i+1}. ${q}`),'','Once we have these we can confirm the plan and timeline.','','Thanks,'].join('\n');}
const norm=(s:string)=>s.toLowerCase().replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim();
function similar(a:string,b:string):boolean{const x=norm(a),y=norm(b);if(x.length<4||y.length<4)return false;if(x===y)return true;const wx=new Set(x.split(' ')),wy=new Set(y.split(' '));const shared=Array.from(wx).filter(w=>wy.has(w)).length;const union=new Set([...Array.from(wx),...Array.from(wy)]).size;return union>=3&&shared/union>=0.8;}
export function findExisting(title:string,existing:ExistingTitle[]):ExistingTitle|null{return existing.find(e=>similar(title,e.title))??null;}
export function sameTitle(a:string,b:string):boolean{return similar(a,b);}
const SENIOR_RE=/senior|\bsr\b|lead|architect|principal|manager|head|director|\bcto\b/i;
const JUNIOR_RE=/intern|junior|\bjr\b|trainee|associate|fresher/i;
export function autoAssign(tickets:EditableTicket[],employees:Employee[]):Record<string,string>{const out:Record<string,string>={};if(!employees.length)return out;const hours=new Map(employees.map(e=>[e.employeeId,e.week_hours??0]));const count=new Map(employees.map(e=>[e.employeeId,e.open??0]));const open=tickets.filter(t=>t.state!=='pushed').sort((a,b)=>Number(b.level==='senior dev')-Number(a.level==='senior dev'));const lighter=(a:Employee,b:Employee)=>{const dh=(hours.get(a.employeeId)??0)-(hours.get(b.employeeId)??0);return dh!==0?dh:(count.get(a.employeeId)??0)-(count.get(b.employeeId)??0);};for(const t of open){const want=t.level==='senior dev'?SENIOR_RE:JUNIOR_RE;let pool=employees.filter(e=>want.test(e.designation??''));if(!pool.length)pool=employees;const pick=pool.reduce((best,e)=>lighter(e,best)<0?e:best);out[t.uid]=pick.employeeId;hours.set(pick.employeeId,(hours.get(pick.employeeId)??0)+(Number(t.estimate_hours)||0));count.set(pick.employeeId,(count.get(pick.employeeId)??0)+1);}return out;}
