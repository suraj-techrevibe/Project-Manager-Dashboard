# Tasks tab update v2 — re-wired for your new Projects workspace

Your latest push replaced ProjectsPanel with the new ProjectWorkspace/TasksTab, which dropped the
Today -> Projects deep link, and types/pm.ts lost the new PmFlag fields. This restores both.

Copy these files over your project (paths match):

- resources/js/types/pm.ts                                   (PmFlag detail fields + TaskFocus)
- resources/js/Components/Pm/ProjectsPanel.tsx               (accepts `focus`, opens the project)
- resources/js/Components/Pm/Projects/ProjectWorkspace.tsx   (starts on the Tasks tab when a task is targeted)
- resources/js/Components/Pm/Projects/TasksTab.tsx           (scrolls to + highlights the task card)

Backend (migration, PmCard, TaskmanduSync, FlagService) and FlagsPanel/Index.tsx are already in your repo.
If you haven't yet: php artisan migrate && php artisan pm:sync
