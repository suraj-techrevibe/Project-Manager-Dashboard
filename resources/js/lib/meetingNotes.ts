import type { Employee, TaskPriority } from '../types/pm';
import { MAX_TICKETS, blankTicket, guessTicket, type EditableTicket } from './briefHeuristics';

/**
 * Meeting-notes mode: turns the action items in pasted notes into tickets, with the
 * assignee and due date already filled in. Everything else (discussion, attendees,
 * decisions) is ignored.
 *
 * A line becomes a ticket when it
 *   - has a marker: "TODO", "Action:", "AI:", "Follow-up:", "Task:", a "[ ]" checkbox, or
 *   - mentions someone with @name, or
 *   - sits under an "Action items" / "Next steps" / "To do" heading.
 *
 * Assignee:  "@rahul" (first name, full name, or a unique prefix of the name)
 * Due date:  "by Friday", "due 12 Oct", "before 2026-10-12", "by 12/10", "tomorrow",
 *            "EOD", "end of week", "next week", "next Tuesday"  (day first: 12/10 = 12 Oct)
 */

export interface MeetingParse {
  tickets: EditableTicket[];
  /** Lines that were not action items. */
  ignored: number;
  /** Action items past the ticket limit. */
  dropped: number;
  /** @mentions that matched nobody, or more than one person. */
  unmatched: string[];
  /** Things worth telling the user (past dates left blank, etc). */
  warnings: string[];
}

const DAY_ABBR = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const DAY_RE = '(?:sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?)';
const MONTH_RE = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';

const ACTION_HEADING = /^\s*(?:#+\s*)?(?:action items?|actions|next steps?|to-?dos?|follow[- ]?ups?|tasks)\s*:?\s*$/i;
const OTHER_HEADING = /^\s*(?:#+\s+.+|[A-Za-z][\w &/-]{1,40}:)\s*$/;
const MARKER = /^\s*(?:todo|to-do|action(?:\s*item)?|ai|task|follow[- ]?up)\s*[:\-–—]\s*/i;
const TODO_ANYWHERE = /\b(?:todo|to-do)\b/i;
const CHECKBOX = /^\s*(?:[-*•]\s*)?\[\s?\]\s*/;
const MENTION = /(^|[\s(])@([A-Za-z][\w.\-]*)/;

/** Local yyyy-mm-dd (toISOString would shift the day for anyone east of UTC). */
export function localISO(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + n);
  return x;
}

function dayIndex(word: string): number {
  const w = word.toLowerCase().slice(0, 3);
  return DAY_ABBR.indexOf(w);
}

function monthIndex(word: string): number {
  return MONTHS.indexOf(word.toLowerCase().slice(0, 3));
}

/** Next occurrence of a weekday strictly after today ("by Friday" on a Friday means next Friday). */
function nextWeekday(today: Date, dow: number): Date {
  const diff = ((dow - today.getDay() + 7) % 7) || 7;
  return addDays(today, diff);
}

/** The given weekday in the next calendar week (Mon–Sun), for "next Tuesday". */
function weekdayNextWeek(today: Date, dow: number): Date {
  const mondayThisWeek = addDays(today, -((today.getDay() + 6) % 7));
  return addDays(mondayThisWeek, 7 + ((dow + 6) % 7));
}

export interface ParsedDue {
  date: string | null;
  /** The text to cut out of the title, including the leading "by"/"due". */
  matched: string;
  past: boolean;
}

/** Finds the first due date in a line. Exported for testing. */
export function findDueDate(line: string, now: Date = new Date()): ParsedDue | null {
  const today = startOfDay(now);
  const lead = '(?:\\b(?:by|due(?:\\s+(?:on|by))?|before|until|on|for)\\s+)?';
  const tests: { re: RegExp; resolve: (m: RegExpMatchArray) => Date | null }[] = [
    // ISO date
    {
      re: new RegExp(`${lead}\\b(\\d{4})-(\\d{1,2})-(\\d{1,2})\\b`, 'i'),
      resolve: (m) => validDate(+m[1], +m[2] - 1, +m[3]),
    },
    // 12/10 or 12/10/2026 (day first)
    {
      re: new RegExp(`${lead}\\b(\\d{1,2})[/.](\\d{1,2})(?:[/.](\\d{2,4}))?\\b`, 'i'),
      resolve: (m) => {
        const y = m[3] ? (+m[3] < 100 ? 2000 + +m[3] : +m[3]) : yearFor(today, +m[2] - 1, +m[1]);
        return validDate(y, +m[2] - 1, +m[1]);
      },
    },
    // 12 Oct, 12th October
    {
      re: new RegExp(`${lead}\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_RE})\\b(?:,?\\s+(\\d{4}))?`, 'i'),
      resolve: (m) => {
        const mo = monthIndex(m[2]);
        return validDate(m[3] ? +m[3] : yearFor(today, mo, +m[1]), mo, +m[1]);
      },
    },
    // Oct 12, October 12th
    {
      re: new RegExp(`${lead}\\b(${MONTH_RE})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4}))?`, 'i'),
      resolve: (m) => {
        const mo = monthIndex(m[1]);
        return validDate(m[3] ? +m[3] : yearFor(today, mo, +m[2]), mo, +m[2]);
      },
    },
    // next Tuesday
    {
      re: new RegExp(`${lead}\\bnext\\s+(${DAY_RE})\\b`, 'i'),
      resolve: (m) => weekdayNextWeek(today, dayIndex(m[1])),
    },
    // Friday / by Friday / this Friday
    {
      re: new RegExp(`${lead}\\b(?:this\\s+)?(${DAY_RE})\\b`, 'i'),
      resolve: (m) => nextWeekday(today, dayIndex(m[1])),
    },
    // relative words
    {
      re: new RegExp(`${lead}\\b(?:end of (?:the )?week|eow)\\b`, 'i'),
      // This Friday (today if it is Friday; the coming one on a weekend).
      resolve: () => (today.getDay() === 5 ? today : nextWeekday(today, 5)),
    },
    { re: new RegExp(`${lead}\\bnext\\s+week\\b`, 'i'), resolve: () => weekdayNextWeek(today, 5) },
    { re: new RegExp(`${lead}\\b(?:tomorrow|tmrw|tmr)\\b`, 'i'), resolve: () => addDays(today, 1) },
    { re: new RegExp(`${lead}\\b(?:today|eod|end of (?:the )?day|asap)\\b`, 'i'), resolve: () => today },
  ];

  // Take the earliest-positioned match so "by Friday ... tomorrow" picks the first one stated.
  let best: { index: number; text: string; date: Date | null } | null = null;
  for (const t of tests) {
    const m = line.match(t.re);
    if (!m || m.index === undefined) continue;
    const date = t.resolve(m);
    if (best && m.index >= best.index) continue;
    best = { index: m.index, text: m[0], date };
  }
  if (!best) return null;
  // Looked like a date but isn't a real one (e.g. 31/02): drop the text, keep no date.
  if (!best.date) return { date: null, matched: best.text, past: false };

  const past = best.date.getTime() < today.getTime();
  return { date: past ? null : localISO(best.date), matched: best.text, past };
}

function validDate(y: number, m: number, d: number): Date | null {
  const dt = new Date(y, m, d);
  return dt.getFullYear() === y && dt.getMonth() === m && dt.getDate() === d ? dt : null;
}

/** A day/month with no year means the coming one, unless it's only just gone by. */
function yearFor(today: Date, month: number, day: number): number {
  const thisYear = new Date(today.getFullYear(), month, day);
  const daysAgo = (today.getTime() - thisYear.getTime()) / 86_400_000;
  return daysAgo > 60 ? today.getFullYear() + 1 : today.getFullYear();
}

/* ------------------------------------------------------------------ */
/* Assignee matching                                                    */
/* ------------------------------------------------------------------ */

const alnum = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** @returns the employee, 'ambiguous' (several fit), or null (nobody fits). */
export function matchEmployee(handle: string, employees: Employee[]): Employee | 'ambiguous' | null {
  const h = alnum(handle);
  if (!h) return null;

  const tiers: ((e: Employee) => boolean)[] = [
    (e) => alnum(e.name) === h, // @rahul.sharma
    (e) => alnum(e.name.split(/\s+/)[0] ?? '') === h, // @rahul
    (e) => alnum(e.name.split(/\s+/).slice(-1)[0] ?? '') === h && e.name.includes(' '), // @sharma
    (e) => h.length >= 3 && alnum(e.name).startsWith(h), // @rah
  ];

  for (const test of tiers) {
    const hits = employees.filter(test);
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) return 'ambiguous';
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* The parser                                                           */
/* ------------------------------------------------------------------ */

const BULLET = /^\s*(?:[-*•–—]|\d+[.)])\s+/;
const URGENT = /\b(?:urgent|asap|critical|high priority)\b|!!/i;

function tidyTitle(s: string): string {
  const t = s
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/^[\s,;:.\-–—]+/, '')
    .replace(/[\s,;:\-–—]+$/, '')
    .replace(/\b(?:by|due|before|until|on|for)$/i, '')
    .replace(/[\s,;:\-–—]+$/, '')
    .trim();
  return t ? t[0].toUpperCase() + t.slice(1) : t;
}

export function parseMeetingNotes(text: string, employees: Employee[], now: Date = new Date()): MeetingParse {
  const out: MeetingParse = { tickets: [], ignored: 0, dropped: 0, unmatched: [], warnings: [] };
  let inActionSection = false;
  let pastDates = 0;

  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue; // blank lines don't end an "Action items" section

    if (ACTION_HEADING.test(raw)) {
      inActionSection = true;
      continue;
    }
    if (OTHER_HEADING.test(raw) && !BULLET.test(raw)) {
      inActionSection = false;
      out.ignored++;
      continue;
    }

    const hasMarker = MARKER.test(raw.replace(BULLET, '')) || TODO_ANYWHERE.test(raw) || CHECKBOX.test(raw);
    const mention = raw.match(MENTION);

    if (!hasMarker && !mention && !inActionSection) {
      out.ignored++;
      continue;
    }

    if (out.tickets.length >= MAX_TICKETS) {
      out.dropped++;
      continue;
    }

    let line = raw.replace(CHECKBOX, '').replace(BULLET, '').replace(MARKER, '').replace(/\b(?:todo|to-do)\b\s*[:\-–—]?\s*/gi, '');

    // assignee
    let assigneeId = '';
    let description = '';
    const m = line.match(MENTION);
    if (m) {
      const hit = matchEmployee(m[2], employees);
      if (hit && hit !== 'ambiguous') {
        assigneeId = hit.employeeId;
      } else {
        out.unmatched.push(`@${m[2].replace(/[.\-]+$/, '')}`);
        description = `Owner in the notes: @${m[2]}`;
      }
      line = line.replace(MENTION, '$1');
    }

    // due date
    let dueDate = '';
    const due = findDueDate(line, now);
    if (due) {
      if (due.past) pastDates++;
      else if (due.date) dueDate = due.date;
      line = line.replace(due.matched, ' ');
    }

    // Priority comes from the whole original line (the due-date step can swallow "asap").
    const urgent = URGENT.test(raw);
    line = line
      .replace(/!!+/g, '')
      .replace(/\b(?:urgent(?:ly)?|asap|high priority)\b/gi, '')
      .replace(/^\s*(?:will|to|should|needs? to|must|can|shall|please)\s+/i, '');

    const title = tidyTitle(line) || tidyTitle(raw.replace(BULLET, ''));
    const long = title.length > 160;
    const guess = guessTicket(title);
    const priority: TaskPriority = urgent ? 'High' : 'Medium';

    out.tickets.push(
      blankTicket({
        title: long ? (title.split(/(?<=[.!?])\s/)[0] ?? title).slice(0, 120) : title.slice(0, 190),
        description: long ? title : description,
        level: guess.level,
        estimate_hours: guess.estimate_hours,
        priority,
        assigneeId,
        dueDate,
      })
    );
  }

  out.unmatched = Array.from(new Set(out.unmatched));
  if (pastDates) {
    out.warnings.push(`${pastDates} due date${pastDates === 1 ? ' was' : 's were'} already in the past, so I left ${pastDates === 1 ? 'it' : 'them'} blank.`);
  }
  return out;
}

