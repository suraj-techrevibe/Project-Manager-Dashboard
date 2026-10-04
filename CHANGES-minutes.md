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
