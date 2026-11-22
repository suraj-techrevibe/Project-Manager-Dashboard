# Meeting minutes: Agenda → Discussion → Follow-ups

Copy these files over your project (paths match), then:

    npm run build        # or npm run dev

No migration needed (topics / action_items / work_items are existing JSON columns).

Files: app/Http/Controllers/MeetingMinutesController.php · resources/js/Components/Pm/StructuredMeetingMinutesPanel.tsx ·
resources/js/lib/minutesFormat.ts · resources/js/lib/parseMeetingText.ts · resources/js/types/pm.ts

## New structure
1. Basics  2. Agenda & Discussion  3. Follow-ups  4. Tasks (optional)  5. Review

- Agenda & Discussion: one row per agenda item with its discussion (and an optional decision).
- Follow-ups: task, optional owner, optional due date, done tick. "Carry over open follow-ups" pulls them from the
  last earlier meeting that had any. "Also create a Taskmandu task" copies one into Tasks.
- Tasks (the old Work Items) are optional and are the ONLY thing pushed to Taskmandu. Owner/project/due warnings
  now apply to tasks only.
- Saved meeting: follow-ups have checkboxes (saved immediately), plus "Copy as text".
- Paste notes: AGENDA / DISCUSSION / DECISIONS / FOLLOW-UPS headings, all optional. WORK ITEM n blocks still work
  (old pasted text and old "Copy as text" output parse as before). The new "Copy as text" output pastes back in.
- Existing meetings open as before: their Work Items show under Tasks, old discussion text shows as one agenda item.
