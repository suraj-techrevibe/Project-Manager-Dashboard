# QA Center implementation plan\n\n## Objective
Add a centralized QA Center to the PM dashboard for website/app QA capture, tracking, retesting, checklists, audits and reports across business units. Reuse existing PM tasks/projects/business records; do not create a duplicate task system.

## Proposed work
- QA Dashboard: KPIs and overview (open, severity, retest queue, overdue, business-wise).
- QA Drafts: quick capture of observations, screenshots/recordings, notes, business, site/app and page.
- Quick Capture: entry point available globally in dashboard/search/actions.
- QA Tracking: searchable issues with severity, business, app/site, page, owner, status, evidence, dates.
- Link/convert to existing PM tasks without duplicate tasks.
- Retesting: pass/fail, comments, evidence; failed retests return the linked task to fixing.
- Reusable QA checklists, recurring audits and reporting (severity, developer, aging, repeated bugs, resolution time, pass/fail).
- Responsive, uncluttered UI; use existing business/project/user infrastructure.

## Workflow
Draft → Reported → Fixing → Ready for Retest → Passed / Failed. Failed items return to the linked task; Passed closes QA verification.

## Safety
Implement on a feature branch only. No direct commits to main, no production deploy, no migrations against production or destructive data changes. Submit PR for review. Keep changes reversible and document rollback. Reuse existing task system and avoid duplicating task functionality.

## Priority
1. QA drafts and quick capture
2. Tracking and PM task linking
3. Retesting
4. Dashboard
5. Checklists
6. Reports and schedule
\n\n## Rollback strategy\n- Work is isolated on `feature/qa-center`; main remains unchanged.\n- Backup branch `backup/main-before-qa-center-20261120` points to the pre-change main commit.\n- Do not merge or deploy until reviewed and verified.\n- If rejected, close the PR and delete the feature branch; main and the backup remain intact.\n