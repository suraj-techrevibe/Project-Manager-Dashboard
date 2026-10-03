# Tasks tab update — what changed

Copy the files in this zip over your project (paths match), then:

    php artisan migrate
    php artisan pm:sync     # repopulates cards with the new fields
    npm run dev

## Behaviour
- Today tab: one card per task (multiple flags show as badges) with project, priority, status,
  assignee, assigned-by, due date (relative), estimate, subtasks, comments, tags, last activity
  and a description preview. Metric tiles filter the list.
- Clicking a project task switches to the Projects tab, opens that project's board, scrolls to the
  task and highlights it. Standalone tasks (no project) open in Taskmandu in a new tab.
- Project board cards now also show estimate / subtasks / comments / tags.
- Project-board card titles no longer have a "[Project] " prefix (project is its own field now).

## Files
- database/migrations/2026_09_22_000000_add_task_details_to_pm_cards_table.php  (new)
- app/Models/PmCard.php
- app/Services/Pm/TaskmanduSync.php
- app/Services/Pm/FlagService.php
- resources/js/types/pm.ts
- resources/js/Pages/Pm/Index.tsx
- resources/js/Components/Pm/FlagsPanel.tsx
- resources/js/Components/Pm/ProjectsPanel.tsx
- README.md
