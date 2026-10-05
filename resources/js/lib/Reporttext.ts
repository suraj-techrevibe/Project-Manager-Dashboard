import type { DailyContent, Report, ReportItem, WeeklyContent } from '../types/pm';

type Content = DailyContent | WeeklyContent;

const RULE = '─'.repeat(40);

const item = (t: ReportItem) => `${t.title}${t.project ? ` [${t.project}]` : ''} — ${t.assignee ?? 'unassigned'}`;

function section(out: string[], title: string, lines: string[], empty: string | null = 'None.') {
  if (!lines.length && empty === null) return;
  out.push(title.toUpperCase(), lines.length ? lines.map((l) => `• ${l}`).join('\n') : empty!, '');
}

/**
 * Part 1: the plain-language summary — anyone can read this, no project-board
 * jargon. What got done, what's blocked, what's next. This is the part a
 * non-technical boss actually wants.
 */
export function updateText(c: Content): string {
  const out: string[] = [
    `${c.kind === 'weekly' ? 'WEEKLY' : 'DAILY'} REPORT — ${c.label}`,
    `Prepared by: ${c.prepared_by}`,
    RULE,
    '',
    'PART 1 — SUMMARY',
    RULE,
  ];
  section(out, 'What I did', c.my_actions, 'Nothing logged.');
  section(out, 'Blockers / waiting on', c.blocker_notes, null);
  section(out, c.kind === 'weekly' ? 'Next week' : 'Tomorrow', c.plan, 'Nothing planned yet.');
  section(out, 'Notes', c.notes, null);
  return out.join('\n').trimEnd() + '\n';
}

/** Part 2: the technical board data — for the PM's own tracking, not the boss. */
function detailsText(c: Content): string {
  const out: string[] = ['PART 2 — TECHNICAL DETAILS', RULE, '(From the project board — not meant for a non-technical reader)', ''];

  if (c.kind === 'daily') {
    out.push('TODAY AT A GLANCE', c.summary_text, `Board: ${c.board_text}`, '');
    section(out, 'Completed today', c.completed.map(item), 'Nothing completed.');
    section(out, 'New tasks', c.new_tasks.map(item), null);
    section(
      out,
      'Progress today',
      [
        ...c.moved.map((t) => `${item(t)}: ${t.from ?? '?'} → ${t.to ?? '?'}`),
        ...c.comments.map((t) => `${item(t)}: ${t.comments} new comment${t.comments === 1 ? '' : 's'}`),
      ],
      'No status changes today.'
    );
    section(out, 'New blockers', c.newly_blocked.map(item), null);
    section(out, 'Unblocked', c.unblocked.map(item), null);
    section(out, 'Newly overdue', c.newly_overdue.map((t) => `${item(t)} (was due ${t.due})`), null);
    section(out, 'Needs attention (stuck 3+ days)', c.attention.map((t) => `${item(t)} — ${t.kind} ${t.days}d`), null);
    section(
      out,
      'Team today',
      c.team.map(
        (p) =>
          `${p.name}: ` +
          [
            p.done.length ? `finished ${p.done.join(', ')}` : '',
            p.moved.length ? `moved ${p.moved.join(', ')}` : '',
            p.blocked.length ? `blocked on ${p.blocked.join(', ')}` : '',
            p.discussed.length ? `discussed ${p.discussed.join(', ')}` : '',
          ]
            .filter(Boolean)
            .join('; ')
      ),
      'No team activity recorded.'
    );
  } else {
    out.push('THIS WEEK AT A GLANCE', c.summary_text, '');
    out.push('COMPLETED THIS WEEK');
    if (c.completed_by_project.length) {
      c.completed_by_project.forEach((g) => {
        out.push(`${g.project} (${g.items.length})`);
        g.items.forEach((i) => out.push(`  • ${i.title} — ${i.assignee ?? 'unassigned'}`));
      });
    } else {
      out.push('Nothing completed.');
    }
    out.push('');
    section(out, 'Still in progress', c.in_progress.map((t) => `${item(t)}${t.days != null ? ` — ${t.days}d in progress` : ''}`), 'Nothing in progress.');
    section(out, 'Blocked', c.blocked.map((t) => `${item(t)}${t.days != null ? ` — blocked ${t.days}d` : ''}`), 'Nothing blocked.');
    section(out, 'Overdue', c.overdue.map((t) => `${item(t)} — ${t.days}d overdue`), 'Nothing overdue.');
    section(
      out,
      'Team workload',
      c.team.map(
        (p) =>
          `${p.name} — ${p.completed} completed | ${p.open} open` +
          `${p.in_progress ? `, ${p.in_progress} in progress` : ''}${p.blocked ? `, ${p.blocked} blocked` : ''}${p.overdue ? `, ${p.overdue} overdue` : ''}`
      ),
      'No team activity.'
    );
  }

  return out.join('\n').trimEnd() + '\n';
}

/** Which text a copy button gives: just the plain-language part, or both parts. */
export function reportText(report: Report, part: 'update' | 'full'): string {
  const c = report.content;
  if (c.kind !== 'daily' && c.kind !== 'weekly') return report.body; // old-format report
  return part === 'update' ? updateText(c) : `${updateText(c)}\n${RULE}\n\n${detailsText(c)}`;
}
