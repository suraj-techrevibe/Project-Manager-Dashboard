# v8 — sub-tasks no longer get lost (Today tab)

Copy these files over your project (paths match), then:

    php artisan migrate        # creates pm_subtasks
    php artisan pm:sync        # (or press Sync now on Today) — fills it
    npm run dev

## What you get
- New "Sub-tasks to sort out" box on Today: every open sub-task that is UNASSIGNED or BLOCKED,
  unassigned first, then ones under an overdue parent task, then oldest.
- Each row: project > parent task > sub-task, who owns the parent, how old it is.
- Assign right there: dropdown of staff, lightest workload first (updates Taskmandu, then removes the row).
- Open: jumps to Projects > that task and scrolls to the sub-task. Snooze 3d hides it for 3 days.
- Team workload now counts sub-task assignments in "open" (no hours - sub-tasks have no estimate),
  so someone who only has sub-tasks is no longer shown as "no tasks".
- Morning digest gets an "Unassigned sub-tasks" section.

## Design notes
- Sub-tasks are stored in their own table (pm_subtasks), NOT pm_cards, so reports, board checks and the
  AI snapshot still count real tasks only.
- Sub-tasks deleted in Taskmandu disappear on the next sync.
- Sub-tasks have no due date of their own; "parent overdue" uses the parent task's date.

## Files
database/migrations/2026_10_10_000000_create_pm_subtasks_table.php (new) · app/Models/PmSubtask.php (new) ·
app/Services/Pm/TaskmanduSync.php · app/Services/Pm/FlagService.php · app/Services/Pm/DigestService.php ·
app/Http/Controllers/PmController.php · routes/pm.php · resources/js/types/pm.ts · resources/js/lib/pmApi.ts ·
resources/js/Pages/Pm/Index.tsx · resources/js/Components/Pm/FlagsPanel.tsx ·
resources/js/Components/Pm/SubtaskInbox.tsx (new) · resources/js/Components/Pm/Projects/TaskDetail.tsx
