import type { ActionItem, Employee, MeetingWorkItem, MeetingWorkItemAction, MinutesTopic } from '../types/pm';
import { findDueDate, matchEmployee } from './meetingNotes';

/**
 * Turns a pasted block like
 *
 *   MEETING / Title: / Date: / Attendees:
 *   AGENDA / DISCUSSION / (DECISIONS) / FOLLOW-UPS
 *   WORK ITEM 1 / Owner: / Project: / Requirement: / Discussion: / Action Items: / Due Date:   (optional Taskmandu tasks)
 *
 * into the wizard's fields. Every section is optional — a meeting with no tasks is normal. It is forgiving on purpose: labels in any order and case, markdown
 * (**bold**, # headings, * bullets), ──── rules, and text that sits under no label (folded into
 * Discussion). No AI involved — the same text always gives the same result.
 */

export interface OwnerResult {
  /** The matched employee's exact name, or '' when nobody fits. */
  owner: string;
  /** What to tell the user next to the owner box. */
  hint: string | null;
  /** 'warn' = red box, pick someone; 'info' = we picked, just so you know how. */
  tone: 'warn' | 'info' | null;
}

export interface PastedMeeting {
  title: string;
  /** YYYY-MM-DD or null when the notes had no readable date. */
  date: string | null;
  attendees: string[];
  /** Agenda titles with their discussion notes (and decision, when one was written). */
  topics: MinutesTopic[];
  followUps: ActionItem[];
  /** Optional Taskmandu tasks (WORK ITEM blocks). */
  workItems: MeetingWorkItem[];
  /** One entry per work item, same order. */
  owners: OwnerResult[];
  /** Problems with the paste as a whole (shown above the wizard). */
  notes: string[];
}

type FieldKey = 'title' | 'date' | 'attendees' | 'owner' | 'project' | 'requirement' | 'discussion' | 'actions' | 'due';

const LABELS: { re: RegExp; key: FieldKey }[] = [
  { re: /^title|^meeting\s*title|^meeting\s*name$/i, key: 'title' },
  { re: /^date|^meeting\s*date$/i, key: 'date' },
  { re: /^attendees?|^participants?|^present$/i, key: 'attendees' },
  { re: /^owner|^person(?:\s*\/\s*owner)?|^assignee|^assigned\s*to$/i, key: 'owner' },
  { re: /^project|^business(?:\s*\/\s*project)?$/i, key: 'project' },
  { re: /^requirement|^task(?:\s*title)?$/i, key: 'requirement' },
  { re: /^discussion|^description|^notes?$/i, key: 'discussion' },
  { re: /^action\s*items?|^actions?|^sub-?tasks?$/i, key: 'actions' },
  { re: /^due(?:\s*date)?$/i, key: 'due' },
];

const BULLET = /^\s*(?:[-*•–—]|\d+[.)])\s+/;
const RULE = /^[\s\u2500-\u257f\-_=*~]{3,}$/;
const WORK_ITEM = /^\s*(?:#+\s*)?(?:\*\*)?WORK\s*ITEM\b\s*#?\s*\d*\s*[:.\-–]?\s*(?:\*\*)?\s*$/i;

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const pad = (n: number) => String(n).padStart(2, '0');

/** "6 Oct 2026", "Oct 6, 2026", "2026-10-06", "06/10/2026" (day first) → "2026-10-06". */
export function parseDate(text: string, now: Date = new Date()): string | null {
  const t = text.trim().replace(/\s+/g, ' ');
  if (!t) return null;
  const valid = (y: number, m: number, d: number) => {
    const dt = new Date(y, m, d);
    return dt.getFullYear() === y && dt.getMonth() === m && dt.getDate() === d ? `${y}-${pad(m + 1)}-${pad(d)}` : null;
  };

  let m = t.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (m) return valid(+m[1], +m[2] - 1, +m[3]);

  m = t.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})\b/);
  if (m) {
    const mi = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
    if (mi >= 0) return valid(+m[3], mi, +m[1]);
  }

  m = t.match(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/);
  if (m) {
    const mi = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
    if (mi >= 0) return valid(+m[3], mi, +m[2]);
  }

  m = t.match(/\b(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})\b/);
  if (m) return valid(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2] - 1, +m[1]);

  // "12 Oct" / "next Friday" / "tomorrow" — the same reader Brief to tickets uses.
  return findDueDate(t, now)?.date ?? null;
}

const clean = (line: string) =>
  line
    .replace(/\*\*|__|`/g, '')
    .replace(/^\s*#+\s*/, '')
    .replace(/\s+$/, '');

interface Section {
  preamble: string[];
  fields: Partial<Record<FieldKey, string[]>>;
}

/** Fields that hold one value. Text after that value belongs to the discussion, not to the field. */
const SINGLE: FieldKey[] = ['title', 'date', 'owner', 'project', 'requirement', 'due'];

/** Splits lines into labelled fields. Anything before the first label (or left over after a one-line field) is the preamble. */
function sections(lines: string[], allowed: FieldKey[]): Section {
  const out: Section = { preamble: [], fields: {} };
  let current: FieldKey | null = null;

  for (const raw of lines) {
    const line = clean(raw);
    if (RULE.test(line)) continue;

    const m = line.match(/^\s*([A-Za-z][A-Za-z /-]{1,24}?)\s*[:：]\s*(.*)$/);
    const key = m ? LABELS.find((l) => l.re.test(m[1].trim()))?.key : undefined;

    if (m && key && allowed.includes(key)) {
      out.fields[key] = m[2].trim() ? [m[2].trim()] : [];
      // A one-line field with its value on the label line is complete.
      current = SINGLE.includes(key) && m[2].trim() ? null : key;
      continue;
    }
    if (!line.trim()) {
      if (current && !SINGLE.includes(current) && out.fields[current]?.length) out.fields[current]!.push('');
      continue;
    }
    if (current) {
      out.fields[current]!.push(line.trim());
      if (SINGLE.includes(current)) current = null; // value taken from the line below the label
    } else {
      out.preamble.push(line.trim());
    }
  }

  // Trim the blank lines we kept as paragraph breaks.
  (Object.keys(out.fields) as FieldKey[]).forEach((k) => {
    const f = out.fields[k]!;
    while (f.length && !f[f.length - 1]) f.pop();
  });
  return out;
}

/** The app's own "Copy as text" prints these for empty fields — read them back as empty. */
const PLACEHOLDER = /^\(?\s*(?:unassigned|not\s*set|not\s*specified|none|n\/a|tbd|untitled)\s*\)?\.?$/i;
const real = (v: string) => (PLACEHOLDER.test(v.trim()) ? '' : v.trim());

const firstLine = (f?: string[]) => real((f ?? []).find((l) => l.trim()) ?? '');
const stripBullet = (l: string) => l.replace(BULLET, '').trim();

/* ------------------------------------------------------------------ */
/* Owners                                                               */
/* ------------------------------------------------------------------ */

const HONORIFICS = /\b(?:sir|madam|mam|ma'am|mr|mrs|ms|dr|dai|didi|bhai|ji|saheb)\b\.?/gi;

/** Nepali/English spelling drift: Sooraj/Suraj, Sehraz/Shahraz, Pankaj/Pankaz … */
const phon = (s: string) =>
  s
    .toLowerCase()
    .replace(/oo|ou/g, 'u')
    .replace(/ee/g, 'i')
    .replace(/aa/g, 'a')
    .replace(/ph/g, 'f')
    .replace(/sh/g, 's')
    .replace(/z/g, 's')
    .replace(/w/g, 'v');

function matchOne(name: string, employees: Employee[]): { e: Employee | 'ambiguous' | null; fuzzy: boolean } {
  const direct = matchEmployee(name, employees);
  if (direct) return { e: direct, fuzzy: false };
  // Same names, spelled by sound. Map back to the real employee afterwards.
  const phonetic = employees.map((e) => ({ ...e, name: phon(e.name) }));
  const hit = matchEmployee(phon(name), phonetic);
  if (hit && hit !== 'ambiguous') return { e: employees[phonetic.findIndex((p) => p.employeeId === hit.employeeId)], fuzzy: true };
  return { e: hit, fuzzy: false };
}

export function resolveOwner(text: string, employees: Employee[]): OwnerResult {
  const typed = text.trim();
  if (!typed) return { owner: '', hint: null, tone: null }; // empty is flagged by the red box itself
  if (!employees.length) return { owner: '', hint: `Pasted as “${typed}” — team list not loaded, pick the person.`, tone: 'warn' };

  const parts = typed
    .replace(HONORIFICS, ' ')
    .split(/\s*(?:&|\band\b|,|\/|\+)\s*/i)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const results = parts.map((p) => matchOne(p, employees));
  const firstOk = results.findIndex((r) => r.e && r.e !== 'ambiguous');

  if (firstOk === -1) {
    const ambiguous = results.some((r) => r.e === 'ambiguous');
    return {
      owner: '',
      hint: ambiguous ? `“${typed}” fits more than one person — pick the right one.` : `Pasted as “${typed}” — no team member matches. Pick the right person.`,
      tone: 'warn',
    };
  }

  const picked = results[firstOk].e as Employee;
  if (parts.length > 1) {
    const others = parts.filter((_, i) => i !== firstOk).join(' & ');
    return { owner: picked.name, hint: `Pasted owners “${typed}”. A work item has one owner, so it is set to ${picked.name}; ${others} is not assigned here.`, tone: 'warn' };
  }
  return results[firstOk].fuzzy
    ? { owner: picked.name, hint: `“${typed}” was matched to ${picked.name} by similar spelling.`, tone: 'info' }
    : { owner: picked.name, hint: null, tone: null };
}

/* ------------------------------------------------------------------ */
/* Action items                                                         */
/* ------------------------------------------------------------------ */

function actionItems(lines: string[], now: Date): MeetingWorkItemAction[] {
  const rows = lines.map((l) => l.trim()).filter(Boolean);
  const hasBullets = rows.some((l) => BULLET.test(l));
  const joined: string[] = [];

  rows.forEach((l) => {
    if (!hasBullets || BULLET.test(l) || !joined.length) joined.push(stripBullet(l));
    else joined[joined.length - 1] += ` ${l}`; // a wrapped line belongs to the bullet above
  });

  return joined
    .map((text) => {
      // "(due 14 Oct 2026)" or a trailing "due 14 Oct 2026"
      const m = text.match(/\(?\s*\bdue(?:\s+(?:on|by))?\s+([^()]+?)\s*\)?\s*$/i);
      const date = m ? parseDate(m[1], now) : null;
      const task = (m && date ? text.slice(0, m.index) : text).replace(/[\s,;:\-–—]+$/, '').trim();
      return { task: task.slice(0, 300), due_date: date };
    })
    .filter((a) => a.task);
}

/* ------------------------------------------------------------------ */
/* Agenda / Discussion / Follow-ups                                     */
/* ------------------------------------------------------------------ */

const normKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const bulletText = (lines: string[]) => lines.map((l) => l.trim()).filter(Boolean).map((l) => real(stripBullet(l))).filter(Boolean);

/** Agenda titles, plus the discussion under each. A heading is an agenda title (numbered or not, with or without ": notes"),
 *  or an unindented "3. Something" line. Text before any heading becomes a "Discussion" topic. */
function buildTopics(agenda: string[], discussion: string[], decisions: string[]): MinutesTopic[] {
  const topics: MinutesTopic[] = bulletText(agenda).map((title) => ({ title: title.slice(0, 200), notes: '', decision: '' }));
  const find = (t: string) => topics.find((x) => normKey(x.title) === normKey(t));
  const loose: string[] = [];
  let cur: MinutesTopic | null = null;
  const add = (topic: MinutesTopic | null, text: string) => {
    if (!text) return;
    if (topic) topic.notes = topic.notes ? `${topic.notes}\n${text}` : text;
    else loose.push(text);
  };

  for (const raw of discussion) {
    const line = clean(raw).trim();
    if (!line || RULE.test(line) || PLACEHOLDER.test(line)) continue;

    const dec = line.match(/^decisions?\s*[:：]\s*(.+)$/i);
    if (dec && cur) { cur.decision = cur.decision ? `${cur.decision}; ${dec[1].trim()}` : dec[1].trim(); continue; }

    const plain = stripBullet(line);
    let hit = find(plain.replace(/[:：]\s*$/, ''));
    let rest = '';
    if (!hit) {
      const m = plain.match(/^(.{2,120}?)\s*[:：]\s+(.+)$/);
      if (m && find(m[1])) { hit = find(m[1]); rest = m[2].trim(); }
    }
    if (!hit && /^\d+[.)]\s+/.test(raw.trim()) && !/^\s/.test(raw) && plain.length <= 120) {
      hit = { title: plain, notes: '', decision: '' };
      topics.push(hit);
    }
    if (hit) { cur = hit; add(cur, rest); continue; }
    add(cur, BULLET.test(line) ? `- ${stripBullet(line)}` : line);
  }
  if (loose.length) topics.unshift({ title: 'Discussion', notes: loose.join('\n').slice(0, 8000), decision: '' });

  const decs = bulletText(decisions);
  if (decs.length) topics.push({ title: 'Decisions', notes: '', decision: decs.join('; ') });
  return topics.map((t) => ({ ...t, notes: t.notes.slice(0, 8000) }));
}

/** "Ashim — fix login (due 14 Oct 2026)", "fix login — Ashim", "Ashim: fix login", "fix login (Ashim)", "@Ashim fix login [done]". */
function followUpFrom(text: string, employees: Employee[], now: Date): ActionItem | null {
  let t = text.trim();
  let done = false;
  t = t.replace(/\s*[[(]\s*done\s*[\])]\s*$/i, () => { done = true; return ''; });

  let due: string | null = null;
  const dm = t.match(/\(?\s*\bdue(?:\s+(?:on|by))?\s+([^()]+?)\s*\)?\s*$/i);
  if (dm) {
    const d = parseDate(dm[1], now);
    if (d) { due = d; t = t.slice(0, dm.index).replace(/[\s,;:\-–—]+$/, '').trim(); }
  }

  const who = (name: string): string | null => {
    const n = name.replace(/^@/, '').replace(HONORIFICS, ' ').replace(/\s+/g, ' ').trim();
    if (!n || n.length > 40) return null;
    const r = matchOne(n, employees);
    return r.e && r.e !== 'ambiguous' ? r.e.name : null;
  };

  let owner = '';
  let task = t;
  const colon = t.match(/^@?([^:：]{1,40}?)\s*[:：]\s+(.+)$/);
  const parts = t.split(/\s+[—–-]\s+/);
  const paren = t.match(/^(.*\S)\s*\(([^()]{2,40})\)\s*$/);
  const at = t.match(/^@(\S+)\s+(.+)$/);
  if (colon && who(colon[1])) { owner = who(colon[1])!; task = colon[2]; }
  else if (at && who(at[1])) { owner = who(at[1])!; task = at[2]; }
  else if (parts.length > 1 && who(parts[0])) { owner = who(parts[0])!; task = parts.slice(1).join(' — '); }
  else if (parts.length > 1 && who(parts[parts.length - 1])) { owner = who(parts[parts.length - 1])!; task = parts.slice(0, -1).join(' — '); }
  else if (paren && who(paren[2])) { owner = who(paren[2])!; task = paren[1]; }

  task = task.replace(/[\s,;:\-–—]+$/, '').trim().slice(0, 300);
  return task ? { task, owner, due_date: due, done } : null;
}

function followUps(lines: string[], employees: Employee[], now: Date): ActionItem[] {
  const rows = lines.map((l) => l.trim()).filter((l) => l && !RULE.test(l));
  const hasBullets = rows.some((l) => BULLET.test(l));
  const joined: string[] = [];
  rows.forEach((l) => {
    if (!hasBullets || BULLET.test(l) || !joined.length) joined.push(stripBullet(l));
    else joined[joined.length - 1] += ` ${l}`;
  });
  return joined.map(real).filter(Boolean).map((t) => followUpFrom(t, employees, now)).filter((x): x is ActionItem => !!x);
}

/* ------------------------------------------------------------------ */
/* Main                                                                 */
/* ------------------------------------------------------------------ */

type Mode = 'head' | 'agenda' | 'discussion' | 'decisions' | 'followups' | 'work';

/** Top-level headings. Inside a WORK ITEM only the follow-ups / tasks headings count, because "Discussion:" and "Action Items:" are that item's own labels. */
const SECTION = /^(?:#+\s*)?(agenda|discussion|decisions?|follow[\s-]*ups?|action\s*items?)\s*[:：]?\s*$/i;
const FOLLOW_ONLY = /^(?:#+\s*)?follow[\s-]*ups?\s*[:：]?\s*$/i;
const TASKS_HEADING = /^(?:#+\s*)?(?:tasks?\s*\(taskmandu\)|taskmandu\s*tasks?|tasks|work\s*items)\s*[:：]?\s*$/i;
const MEETING_HEADING = /^(?:meeting(?:\s*minutes)?)\s*[:：]?$/i;

export function parseMeetingText(text: string, employees: Employee[], now: Date = new Date()): PastedMeeting {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const notes: string[] = [];

  const buckets: Record<Exclude<Mode, 'work'>, string[]> = { head: [], agenda: [], discussion: [], decisions: [], followups: [] };
  const blocks: string[][] = [];
  let mode: Mode = 'head';

  for (const raw of lines) {
    const line = clean(raw).trim();
    if (WORK_ITEM.test(clean(raw))) { mode = 'work'; blocks.push([]); continue; }
    if (mode === 'work') {
      if (FOLLOW_ONLY.test(line)) { mode = 'followups'; continue; }
      if (TASKS_HEADING.test(line)) continue;
      blocks[blocks.length - 1].push(raw);
      continue;
    }
    if (TASKS_HEADING.test(line)) continue;
    const sec = line.match(SECTION);
    if (sec) {
      const k = sec[1].toLowerCase();
      mode = k.startsWith('agenda') ? 'agenda' : k.startsWith('discussion') ? 'discussion' : k.startsWith('decision') ? 'decisions' : 'followups';
      continue;
    }
    buckets[mode].push(raw);
  }

  const head = sections(buckets.head.filter((l) => !MEETING_HEADING.test(clean(l).trim())), ['title', 'date', 'attendees']);
  // The standard layout prints the title on its own line under "MEETING MINUTES".
  const title = firstLine(head.fields.title) || real(head.preamble.find((l) => l.trim()) ?? '');
  const dateText = firstLine(head.fields.date);
  const date = dateText ? parseDate(dateText, now) : null;
  if (dateText && !date) notes.push(`Couldn't read the date “${dateText}” — set it in Basics.`);

  const rawAttendees = (head.fields.attendees ?? []).flatMap((l) => stripBullet(l).split(/\s*,\s*/)).map((a) => a.trim()).filter(Boolean);
  const attendees = Array.from(
    new Set(
      rawAttendees.map((a) => {
        const hit = matchEmployee(a, employees);
        return hit && hit !== 'ambiguous' ? hit.name : a;
      })
    )
  );

  const topics = buildTopics(buckets.agenda, buckets.discussion, buckets.decisions);
  const followUpItems = followUps(buckets.followups, employees, now);

  const workItems: MeetingWorkItem[] = [];
  const owners: OwnerResult[] = [];

  blocks.forEach((block, n) => {
    const s = sections(block, ['owner', 'project', 'requirement', 'discussion', 'actions', 'due']);

    // Text under no label is the discussion (that's where it was meant to live).
    const talk = [...s.preamble, ...(s.preamble.length && s.fields.discussion?.length ? [''] : []), ...(s.fields.discussion ?? [])]
      .map((l) => (BULLET.test(l) ? `- ${stripBullet(l)}` : l))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    const ownerText = firstLine(s.fields.owner);
    const dueText = firstLine(s.fields.due);
    const due = dueText ? parseDate(dueText, now) : null;
    if (dueText && !due) notes.push(`Task ${n + 1}: couldn't read the due date “${dueText}”.`);

    const o = resolveOwner(ownerText, employees);
    owners.push(o);
    workItems.push({
      owner: o.owner,
      project: (s.fields.project ?? []).map((l) => real(stripBullet(l))).filter(Boolean).join(', '),
      project_id: null,
      requirement: (s.fields.requirement ?? []).map((l) => real(stripBullet(l))).filter(Boolean).join(' ').slice(0, 500),
      discussion: talk.slice(0, 8000),
      action_items: actionItems(s.fields.actions ?? [], now),
      due_date: due,
    });
  });

  if (!topics.length && !followUpItems.length && !workItems.length) {
    notes.push('Nothing to import. Use AGENDA, DISCUSSION and FOLLOW-UPS headings (and WORK ITEM 1 … only for things that should become Taskmandu tasks).');
  }

  return { title, date, attendees, topics, followUps: followUpItems, workItems, owners, notes };
}
