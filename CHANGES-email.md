# Email nudge + Email minutes (Brevo)

Copy over your project (paths match), then:

    php artisan migrate
    php artisan config:clear
    npm run build        # or npm run dev

Add to .env (see .env.example):

    MAIL_MAILER=smtp
    MAIL_HOST=smtp-relay.brevo.com
    MAIL_PORT=587
    MAIL_SCHEME=null
    MAIL_USERNAME=<Brevo SMTP login>
    MAIL_PASSWORD=<Brevo SMTP key>
    MAIL_FROM_ADDRESS=<sender verified in Brevo>
    MAIL_FROM_NAME="PM Agent"
    PM_REPLY_TO=suraj.techrevibe@gmail.com

Files: EmailController (new) · PmContact (new) · create_pm_contacts migration (new) · EmailModal.tsx (new) ·
FlagsPanel.tsx · MeetingMinutesPanel.tsx · types/pm.ts · lib/pmApi.ts · routes/pm.php · config/pm.php · .env.example
