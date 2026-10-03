# v4 — brief-to-tickets overhaul + Ask merged into Today

Copy these files over your project (paths match), then:

    php artisan migrate     # NEW: pm_activities, pm_reports, and a 'kind' column for daily/weekly
    npm run dev
    # delete these (no longer used): resources/js/Components/Pm/ChatPanel.tsx, resources/js/Components/Pm/ClientUpdate.tsx

## Bugs fixed
- Drafting failures now show a message (wrong key -> "AI drafting needs a valid API key"). ClaudeClient
  used to ignore HTTP errors and crash on empty replies.
- Push reports each ticket's result; failed tickets get their own Retry; pushed ones lock. Taskmandu POSTs
  are no longer auto-retried (a lost response could create the task twice).
- Pushed cards are saved with assignee, task_id, hours, priority, project -> no more "Unassigned" on Today.
- No assignee is pre-selected.
- Limits are visible: 8,000-char counter, 30-ticket counter, server messages displayed.
- Raw ids: employee map and the Projects UI now match both employeeId and Mongo _id.

## New
- Per-ticket assignee / due date / priority, plus "assign all" and due-date-all shortcuts.
- Edit title, description, level, hours; remove; add tickets.
- "Open" count next to every name (+ what this batch adds); "Auto-assign to least busy"
  (senior-dev -> senior designations, intern -> junior).
- "Split without AI" (bullets / numbers / plain lines; level + hours guessed from keywords).
- Keyword client questions as a checklist + "Copy as email".
- Push to a project board (appears in the Projects tab) or standalone.
- Real fields (tags/estimatedHours/priority) with automatic fallback to description text.
- Duplicate warning vs existing cards and within the batch.

## Ask tab -> question buttons on Today
Ask tab removed, and there is no text box. Today has a row of question buttons ("Who's overloaded?",
"What's overdue?", "What's blocking the most?", "What hasn't moved in 3+ days?", "Which done tasks are
unverified?", "What has no owner?", "Which project is in the worst shape?"). Click one: the list filters to
the matching tasks and a one-line answer appears above it; click again (or the x) to clear. Answers are
computed in the browser from the synced cards, so no AI call or API key is needed.
Also on Today: clickable workload chips (overloaded people highlighted), search, assignee and project
filters, and an Unassigned tile. Tile counts update live when you snooze/verify.

## Client update tab -> Reports tab (daily + weekly)
Replaced by collapsible report cards, newest first. Daily reports list only what CHANGED that day (so a
multi-day task isn't repeated): glance + one-line board summary, completed, progress (status changes and
new comments), new blockers, newly overdue, a short "needs attention" list for things stuck 3+ days, team activity,
what you did, tomorrow. Weekly reports hold the standing picture: completed by project, still in progress with
days open, blocked/overdue with durations, team workload, comparison with last week, next week.
Reports made with the first version show as "old format" until regenerated.
Sync now also records new comments as activity. Not tracked: sub-task completion (Taskmandu fields unconfirmed).

## Files
Backend: PmController, ReportController (new), ClaudeClient, TaskmanduClient, TaskmanduSync, FlagService,
ReportService (new), GenerateReport (new), PmActivity + PmReport (new), 2 migrations (new), routes/pm.php, routes/console.php
Frontend: Pages/Pm/Index.tsx, Components/Pm/BriefDrafter.tsx, FlagsPanel.tsx, ReportsPanel.tsx (new),
Components/Pm/Projects/ui.tsx, lib/briefHeuristics.ts (new), lib/pmApi.ts, types/pm.ts
Docs: README.md
