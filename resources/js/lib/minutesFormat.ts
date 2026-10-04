import type { ActionItem, MeetingMinutesFull, MinutesTopic } from '../types/pm';
import { localISO } from './meetingNotes';

export const MEETING_TYPES = ['Weekly sync', 'Client call', 'Planning', 'Review / Retro', 'Daily standup', 'Kick-off', 'Other'];

/** One-tap topic starters, so a normal meeting is mostly clicking. */
export const TOPIC_SUGGESTIONS = ['Status update', 'Blockers', 'Client feedback', 'Timeline / deadlines', 'Scope changes', 'Next steps'];

export const blankTopic = (title = ''): MinutesTopic => ({ title, notes: '', decision: '' });

export function autoTitle(type: string, project: string): string {
  return project.trim() ? `${type} — ${project.trim()}` : type;
}

/** 'YYYY-MM-DD' -> local Date (new Date('YYYY-MM-DD') would be UTC and can show the wrong day). */
function parseISO(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function longDate(iso: string): string {
  return parseISO(iso).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

export function monthLabel(iso: string): string {
  return parseISO(iso).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

export function shortDate(iso: string): string {
  return parseISO(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Due-date shortcuts for action items. */
export function quickDates(): { label: string; value: string }[] {
  const now = new Date();
  const plus = (n: number) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    d.setDate(d.getDate() + n);
    return localISO(d);
  };
  const toFriday = ((5 - now.getDay() + 7) % 7) || 7; // next Friday, never "today"
  return [
    { label: 'Tomorrow', value: plus(1) },
    { label: 'Friday', value: plus(toFriday) },
    { label: '+1 week', value: plus(7) },
    { label: '+2 weeks', value: plus(14) },
  ];
}

/** Topics for an entry. Entries made before the guided form only have the flat fields. */
/** Laravel turns "" into null on the way in, so any text field can come back null. */
export const cleanTopic = (t: Partial<MinutesTopic>): MinutesTopic => ({
  title: t.title ?? '',
  notes: t.notes ?? '',
  decision: t.decision ?? '',
});

/** Topics for an entry. Entries made before the guided form only have the flat fields. */
export function topicsFor(m: MeetingMinutesFull): MinutesTopic[] {
  if (m.topics && m.topics.length > 0) return m.topics.map(cleanTopic);
  const out: MinutesTopic[] = (m.agenda_items ?? []).map((t) => blankTopic(t));
  if (m.discussion?.trim()) out.push({ title: 'Discussion', notes: m.discussion.trim(), decision: '' });
  if (m.decisions?.length > 0) {
    if (out.length === 0) out.push(blankTopic('General'));
    out[out.length - 1] = { ...out[out.length - 1], decision: m.decisions.join('; ') };
  }
  return out;
}

/** Drops empty rows and fills the flat columns the rest of the app (and older code) reads. */
export function deriveFields(topics: MinutesTopic[], actionItems: ActionItem[]) {
  const kept = topics
    .map(cleanTopic)
    .map((t, i) => ({ ...t, title: t.title.trim() || (t.notes.trim() || t.decision.trim() ? `Topic ${i + 1}` : '') }))
    .filter((t) => t.title);
  return {
    topics: kept,
    agenda_items: kept.map((t) => t.title),
    discussion: kept.filter((t) => t.notes.trim()).map((t) => `${t.title}\n${t.notes.trim()}`).join('\n\n'),
    decisions: kept.map((t) => t.decision.trim()).filter(Boolean),
    action_items: actionItems
      .filter((a) => (a.task ?? '').trim())
      .map((a) => ({ ...a, task: a.task.trim(), owner: a.owner ?? '' })),
  };
}

interface TextInput {
  title: string;
  meeting_date: string;
  attendees: string[];
  topics: MinutesTopic[];
  action_items: ActionItem[];
}

/** The standard layout, as plain text that pastes cleanly into email or Slack. */
export function minutesToText(m: TextInput): string {
  const f = deriveFields(m.topics, m.action_items);
  const L: string[] = ['MEETING MINUTES', m.title, `Date: ${longDate(m.meeting_date)}`];
  if (m.attendees.length) L.push(`Attendees: ${m.attendees.join(', ')}`);

  if (f.topics.length) {
    L.push('', 'AGENDA');
    f.topics.forEach((t, i) => L.push(`${i + 1}. ${t.title}`));
  }
  const withNotes = f.topics.map((t, i) => ({ t, i })).filter(({ t }) => t.notes.trim());
  if (withNotes.length) {
    L.push('', 'DISCUSSION');
    withNotes.forEach(({ t, i }) => {
      L.push(`${i + 1}. ${t.title}`);
      t.notes.trim().split('\n').forEach((line) => L.push(`   ${line.trim()}`));
    });
  }
  if (f.decisions.length) {
    L.push('', 'DECISIONS');
    f.decisions.forEach((d) => L.push(`• ${d}`));
  }
  if (f.action_items.length) {
    L.push('', 'ACTION ITEMS');
    f.action_items.forEach((a, i) => {
      const parts = [a.task.trim(), a.owner?.trim() || 'Unassigned', a.due_date ? `Due ${shortDate(a.due_date)}` : 'No due date'];
      L.push(`${i + 1}. ${parts.join(' — ')}`);
    });
  }
  return L.join('\n');
}

/** Non-blocking nudges shown before saving as final. */
export function minutesWarnings(m: TextInput): string[] {
  const w: string[] = [];
  const f = deriveFields(m.topics, m.action_items);
  if (m.attendees.length === 0) w.push('No attendees added.');
  if (f.topics.length === 0) w.push('No topics added.');
  if (f.action_items.some((a) => !a.owner?.trim())) w.push('Some action items have no owner.');
  if (f.action_items.some((a) => !a.due_date)) w.push('Some action items have no due date.');
  return w;
}
