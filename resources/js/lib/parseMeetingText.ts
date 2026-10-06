import type { Employee, MeetingWorkItem, MeetingWorkItemAction } from '../types/pm';
import { findDueDate, matchEmployee } from './meetingNotes';

/**
 * Turns a pasted block like
 *
 *   MEETING / Title: / Date: / Attendees: / WORK ITEM 1 / Owner: / Project: /
 *   Requirement: / Discussion: / Action Items: / Due Date:
 *
 * into the wizard's fields. It is forgiving on purpose: labels in any order and case, markdown
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
/* Main                                                                 */
/* ------------------------------------------------------------------ */

export function parseMeetingText(text: string, employees: Employee[], now: Date = new Date()): PastedMeeting {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const starts = lines.map((l, i) => (WORK_ITEM.test(clean(l)) ? i : -1)).filter((i) => i >= 0);
  const notes: string[] = [];

  const head = sections(starts.length ? lines.slice(0, starts[0]) : lines, ['title', 'date', 'attendees']);
  const title = firstLine(head.fields.title);
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

  if (!starts.length) notes.push('No “WORK ITEM 1 / 2 …” headings found, so no work items were created. Add them and paste again.');

  const workItems: MeetingWorkItem[] = [];
  const owners: OwnerResult[] = [];

  starts.forEach((start, n) => {
    const block = lines.slice(start + 1, starts[n + 1] ?? lines.length);
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
    if (dueText && !due) notes.push(`Work Item ${n + 1}: couldn't read the due date “${dueText}”.`);

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

  return { title, date, attendees, workItems, owners, notes };
}
