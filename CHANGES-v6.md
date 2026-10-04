# v6 — Meeting-notes mode + Morning digest

These two were reported as "built now" after v5 but were not in the repo. They are now.

Copy the files over your project (paths match), then:

    php artisan config:clear
    npm run build            # or npm run dev

No migration. Optional `.env` (see `.env.example`):

    PM_DIGEST_SLACK_WEBHOOK=https://hooks.slack.com/services/...
    PM_DIGEST_EMAIL=you@agency.com
    PM_DIGEST_TIME=09:00

The 9:00 send needs the scheduler (`php artisan schedule:work` locally, a `schedule:run` cron in production).

## New
- **Brief to tickets -> From meeting notes**: action items only, assignee from `@name`, due date from
  "by Friday" / "12 Oct" / "tomorrow" / etc. Details in the README.
- **Today -> Morning digest**: preview, Copy, Send now. `php artisan pm:digest [--dry] [--no-sync]`, scheduled
  weekdays at `PM_DIGEST_TIME`. Slack and/or email.

## Also changed
- Deleted `Components/Pm/ChecksPanel.tsx` and `ClientUpdate.tsx`. Nothing imported them and they made
  `npm run build` fail on the type check (the v5 notes said they were safe to delete).
- Brief drafter's "today" for the date pickers now uses your local date instead of UTC.
- `phpunit.xml`: tests now use in-memory SQLite (the Laravel default) so `RefreshDatabase` can never touch
  the database in your `.env`.
- New tests: `tests/Feature/DigestTest.php` (7 tests).

## Files
config/pm.php · routes/pm.php · routes/console.php · app/Http/Controllers/PmController.php ·
app/Services/Pm/DigestService.php (new) · app/Console/Commands/SendDigest.php (new) ·
resources/js/lib/meetingNotes.ts (new) · resources/js/Components/Pm/DigestPanel.tsx (new) ·
BriefDrafter.tsx · FlagsPanel.tsx · resources/js/lib/pmApi.ts · resources/js/types/pm.ts ·
tests/Feature/DigestTest.php (new) · phpunit.xml · .env.example · README.md

## Known limits
- The digest's Focus (pinned) tasks are not included: pins live in your browser, not on the server.
- Meeting notes: a person's name without `@` is not detected as the owner. `Monday.com` reads as "Monday".
- Not built yet: ticket packs, push as sub-tasks, undo push, waiting-on-client, scope ledger,
  project health colour, Cmd+K search, weekly client PDF.
