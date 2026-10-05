# Meeting minutes: guided form (no AI)

Copy these files over your project (paths match), then:

    php artisan migrate
    npm run build        # or npm run dev

Also delete (unused, they break `npm run build`):
    resources/js/Components/Pm/ChecksPanel.tsx
    resources/js/Components/Pm/ClientUpdate.tsx

Files: database/migrations/2026_10_08_000000_add_status_and_topics_to_meeting_minutes.php (new) ·
app/Models/MeetingMinutes.php · app/Http/Controllers/MeetingMinutesController.php ·
resources/js/lib/minutesFormat.ts (new) · resources/js/Components/Pm/MeetingMinutesPanel.tsx ·
resources/js/types/pm.ts

## Save as final creates the Work Item projects

A Work Item's **Business / Project** box takes an existing project (pick from the list) or a new name.

- **Save draft** never touches Taskmandu — nothing is created, and any earlier project link is dropped.
- **Save as final** creates every project that isn't already in Taskmandu (names are matched ignoring case,
  punctuation and spacing, so `mobile-app` finds `Mobile App`), then links each Work Item to its project:
  the saved Work Item gets the project's canonical `project`  name and its `project_id`.
- The same new project on several Work Items is created once.
- If anything fails (Taskmandu down, not configured, project rejected) **nothing is saved as final** and the
  reason is shown. Retrying is safe: projects created by an earlier attempt are found by name, not duplicated.
- Brief to tickets → *From saved meeting* uses the linked `project_id` when present, so a final meeting's
  Work Items arrive with their project already confirmed.

Files: `app/Http/Controllers/MeetingMinutesController.php`, `resources/js/Components/Pm/StructuredMeetingMinutesPanel.tsx`,
`resources/js/Components/Pm/MeetingPicker.tsx`, `resources/js/lib/minutesFormat.ts`, `resources/js/lib/pmApi.ts`,
`resources/js/types/pm.ts`, `tests/Feature/MeetingMinutesProjectsTest.php`. No migration needed (`work_items` is JSON).
