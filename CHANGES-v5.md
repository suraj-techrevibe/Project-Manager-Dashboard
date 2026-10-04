# v5 — Today tab: trust, stand-up, workload

Copy these files over your project (paths match), then:

    php artisan config:clear
    php artisan pm:sync        # fills pm_activities baseline + last-synced time
    npm run dev                # or: npm run build

No new migration. Optional .env: PM_WEEKLY_CAPACITY_HOURS=40  (see .env.example)
For the hourly auto-sync run `php artisan schedule:work` locally (cron `schedule:run` in production).

## New on Today
- Last synced X ago + Sync now (amber warning when data is 3h+ old or never synced here)
- "Since yesterday/Friday" strip: completed, newly blocked, went overdue, new tasks, people with no tasks
- Due today / due in 3 days tiles + badges; list sorts by severity then due date
- Team workload panel: hours due this week vs capacity, status pill (No tasks / Light / Balanced / Nearly full /
  Over capacity), rebalance suggestion, click a person to filter; hide non-team accounts with the x
- New questions: "Who has free capacity?", "What's due soon?" ("Who's overloaded?" is now hours-based)
- Nudge tracking: "Nudged 2d ago" badge, instant "Copy nudge" template (no AI), "Draft with AI"
- Focus list: pin up to 3 tasks (star), "Focus" filter button, shown first under "Must unblock today"
- Copy stand-up button; keyboard shortcuts (j/k/o/p/n/s/v//)
- Today stays mounted when you switch tabs, so filters and a fresh sync aren't lost

## Brief to tickets
- Auto-assign balances by hours due this week (then by open-task count)
- Assignee dropdown shows hours; red warning when a batch pushes someone over weekly capacity

## Fixes you needed
- The tab and the Today -> task click now use your ?tab= / ?project= / ?ptab=tasks / ?task= URL state, so a click on
  a task opens that task directly (your latest ProjectsPanel had lost the earlier deep-link props).
- ReportsPanel imported '../../lib/reportText' but the file is 'Reporttext.ts' (breaks on Linux/macOS builds).
- Safe to delete (unused, still referenced old API methods): Components/Pm/ChecksPanel.tsx, Components/Pm/ClientUpdate.tsx

## Files
config/pm.php (new) · routes/pm.php · routes/console.php · app/Http/Controllers/PmController.php ·
app/Services/Pm/FlagService.php · app/Services/Pm/TaskmanduSync.php · resources/js/types/pm.ts ·
resources/js/lib/pmApi.ts · resources/js/lib/briefHeuristics.ts · resources/js/Pages/Pm/Index.tsx ·
resources/js/Components/Pm/FlagsPanel.tsx · SinceStrip.tsx (new) · TeamWorkload.tsx (new) · BriefDrafter.tsx ·
ReportsPanel.tsx · .env.example · README.md
