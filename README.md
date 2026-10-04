# PM agent (Laravel 11 + Inertia + React TS)

Assumes: Breeze-style Inertia setup (`@` alias -> `resources/js`), Tailwind, axios, `auth` middleware.
Board data comes from **Taskmandu** (github.com/adxps — Node/Express/Mongo), your real task/project
system, via its REST API.

## Setup

1. Copy files into your project (paths match Laravel's).
2. `routes/web.php`: add `require __DIR__.'/pm.php';`
3. `config/services.php`, add:

```php
'anthropic' => [
    'key' => env('ANTHROPIC_API_KEY'),
    'model' => env('ANTHROPIC_MODEL', 'claude-sonnet-5'),
],
'taskmandu' => [
    'base_url' => env('TASKMANDU_BASE_URL'),       // e.g. https://api.taskmandu.adxps.com.au/api/v1
    'email' => env('TASKMANDU_EMAIL'),
    'password' => env('TASKMANDU_PASSWORD'),
    'frontend_url' => env('TASKMANDU_FRONTEND_URL'), // e.g. https://taskmandu.adxps.com.au — used to build "open in Taskmandu" links, optional
],
'github' => [
    'token' => env('GITHUB_TOKEN'),
],
```

4. `.env`:
```
ANTHROPIC_API_KEY=...
TASKMANDU_BASE_URL=https://api.taskmandu.adxps.com.au/api/v1
TASKMANDU_EMAIL=pm-agent@adxps.com.au
TASKMANDU_PASSWORD=...
TASKMANDU_FRONTEND_URL=https://taskmandu.adxps.com.au
GITHUB_TOKEN=ghp_...
```
5. `php artisan migrate`
6. No Taskmandu creds yet? `php artisan db:seed --class=PmDemoSeeder` to try the UI with fake data.
7. `php artisan pm:sync` to pull real data. To run hourly, in `routes/console.php`:
   `use Illuminate\Support\Facades\Schedule;` then `Schedule::command('pm:sync')->hourly();`
8. `npm run dev`, open `/pm`

**Service account:** create a real Taskmandu user for `TASKMANDU_EMAIL`/`TASKMANDU_PASSWORD` — this
app logs in as that user, so it can only see/do what that account's role permits (`tasks:view`,
`projects:view`, `tasks:create`, `employees:view`, per Taskmandu's `requirePermission` checks).
Give it an Employee/Manager-level role, not a bare Employee, or `/employees` and other list
endpoints may 403.

## How the sync works (`TaskmanduSync`, run by `pm:sync`)

Two kinds of cards get pulled in, both from real Taskmandu collections:
- **Standalone tasks** (`GET /tasks`) — Taskmandu's individual assigned-task list, not tied to a project.
- **Project board tasks** (`GET /projects` → each project's embedded `tasks[]`) — the kanban-style
  boards. These carry `project_id`/`project_name`/`task_id`, so the Today tab can deep-link into the project board.

Statuses map directly to Taskmandu's real enum: `Assigned`, `Pending`, `In Progress`, `Blocked`,
`Completed`, `Cancelled` — `FlagService` was updated to match these exactly (see its top comment).
`Cancelled` tasks are skipped entirely; `Completed` tasks only get flagged if unverified.

`assignedToId` on a Taskmandu task is a list of `Employee.employeeId` strings, not names — the sync
resolves these against `GET /employees` once per run and stores the joined names in `assignee`.

**Known imprecision, not hidden:** standalone tasks have a real `updatedAt` used for the "stuck"
flag. Project-board tasks only have `createdAt` on the subdocument (no `updatedAt`), so their
"last activity" falls back to the most recent comment's timestamp, or `createdAt` if there are no
comments — slightly less accurate than the standalone-task case.

## Pushing drafted tickets back to Taskmandu

The "Brief to tickets" tab drafts tickets (Claude, or a no-AI line splitter), lets you edit them, and
pushes them via `POST /pm/brief/push`. Each ticket carries its own assignee (required by Taskmandu) and
due date, and the response reports every ticket's own result, so a failure on ticket 4 never hides
tickets 1-3 and only failed tickets are retried. Tickets can go standalone (`POST /tasks`) or onto a
project board (`POST /projects/{id}/tasks`).

Level, estimate and priority are sent as real fields (`tags`, `estimatedHours`, `priority`). If Taskmandu
rejects them on the standalone create call (400/422) the push is retried once without them and a
`Level | Est | Priority` line is added to the description instead; the UI says when that happened.

### Meeting-notes mode (v6)

Paste meeting notes and press **From meeting notes**. Only the action items become tickets; discussion,
attendees and decisions are ignored. No AI, no API key.

A line is an action item when it has `TODO`, `Action:` / `AI:` / `Follow-up:` / `Task:`, a `[ ]` checkbox, or an
`@name`, or when it sits under an `Action items:` / `Next steps:` / `To do:` heading.

- **Assignee** from `@name`: full name, first name, last name or a unique prefix. If two people fit (two Priyas)
  or nobody does, the ticket is left unassigned and the notice names the mention.
- **Due date** from `by Friday`, `next Tuesday`, `tomorrow`, `EOD`, `end of week`, `next week`, `12 Oct`,
  `Oct 12`, `12/10` (day first) or `2026-10-12`. "By Friday" on a Friday means next Friday. A date already in
  the past is left blank, and the notice says so.
- `urgent`, `asap`, `high priority` or `!!` set the priority to High and are removed from the title.
- Hours and level are keyword guesses, same as the line splitter. Review before pushing.

## Daily and weekly reports

The **Reports** tab lists saved reports as collapsible cards, newest first. Pick **Daily** or **Weekly**, a date,
optionally type what you did in your own words, and press **Generate report**. One report per kind per
date (a weekly report is dated by its Monday); generating again replaces it. "Copy as text" copies a plain-text version.

**Daily = what changed that day**, so multi-day tasks don't repeat: Today at a glance (counts + a one-line board
summary with change since the previous daily report), Completed today, New tasks, Progress today (status changes
and new comments), New blockers, Unblocked, Newly overdue, Needs attention (blocked/overdue 3+ days, one line each),
Team today (only people with activity), What I did for the team, Tomorrow, Notes. Empty optional sections are hidden.

**Weekly = the standing picture** (Mon-Sun of the chosen week): Completed by project, Still in progress (days since
it last moved to In Progress), Blocked and Overdue with durations, Team workload table, comparison with last week,
What I did for the team, Next week (tasks due), Notes.

- Everything except the custom-text split comes from the database, not AI. "What I did for the team" is filled
  automatically from actions taken here (tasks pushed, follow-up nudges, verify, snooze) plus your custom text.
- Custom text is split into What I did / Blockers / Plan / Notes by Claude; without an API key (or if the call
  fails) simple line rules are used and the report says so.
- Changes and new comments are detected at each sync (`pm:sync`), so they are as precise as your sync interval.
  Run `php artisan pm:sync` hourly for best results. The first sync after install only records a baseline.
  Quiet work on a task with no status change and no comment leaves no trace unless you mention it in the custom text.
- Automatic: `pm:report` (weekdays 18:00) and `pm:report --weekly` (Fridays 18:30) are scheduled in
  `routes/console.php`; they need the scheduler (`php artisan schedule:work` locally, a `schedule:run` cron in
  production). Manual: `php artisan pm:report --date=2026-10-03 --force`, add `--weekly` for the week.
  Day boundaries use `APP_TIMEZONE` in `.env`.

## Flags

Overdue, stuck (no activity 3+ days, standalone tasks only — see imprecision note above), blocked,
unverified done (last 14 days), unassigned. All computed in `FlagService` with plain date logic.
Claude is only used for chat, nudges, tickets, updates and scope — never for detecting flags.
Agent never sends or moves anything on its own: nudges and emails are drafts you copy; pushing
tickets is the one action that writes to Taskmandu, and it's behind an explicit button + assignee pick.

## Frontend

Assumes a standard Breeze Inertia + React + TypeScript scaffold: `@` alias resolves to `resources/js`,
`AuthenticatedLayout` exists at `resources/js/Layouts/AuthenticatedLayout.tsx`, and `bootstrap.js` already
configures axios with `withCredentials` + CSRF token (Breeze default). If your layout component has a
different name or path, update the import in `Pages/Pm/Index.tsx`.

Files added:
```
resources/js/
  types/pm.ts              # shared TS types
  lib/pmApi.ts              # axios calls to /pm/* routes
  Components/Pm/
    FlagsPanel.tsx          # Today tab: question buttons, workload, filters, flag list, nudge/snooze/verify
    BriefDrafter.tsx        # Brief to tickets tab
    ReportsPanel.tsx        # Reports tab: generate + list daily reports
    ScopeCheck.tsx          # Scope check tab
    GitPanel.tsx            # Git tab
    ProjectsPanel.tsx       # Projects tab
  Pages/Pm/Index.tsx        # ties the tabs together
```

Styling uses plain Tailwind utility classes (slate/red/amber/green), not the CSS custom properties
(`--surface-1`, `--text-danger`, etc.) from the original mockup — swap classes for your own tokens if
your app already has a design system defined that way.

## Git tab

Shows the server's own checkout of this repo: current branch, ahead/behind counts, uncommitted files,
last commit, and a branch switcher — plus, if `GITHUB_TOKEN` is set, each open PR with its combined
check status (passing / failing / running) so you can see if a teammate's PR is actually green before
you review it.

Add to `.env`:
```
GITHUB_TOKEN=ghp_...   # a fine-grained PAT with read access to the repo is enough
```
No config entry needed for the token — `config/services.php` already reads `env('GITHUB_TOKEN')` via:
```php
'github' => [
    'token' => env('GITHUB_TOKEN'),
],
```
(add this block alongside the `anthropic` and `taskmandu` blocks from the setup section above — it's
already included there). The repo slug is detected automatically from `git config remote.origin.url`.

## Projects tab

A live, direct view and editor for Taskmandu's real Project/board feature — not a sync or cache
like `pm_cards`. `ProjectController` is a thin passthrough to Taskmandu's own `/projects` API
(same base URL/auth as everything else, via `TaskmanduClient`), so anything you do here happens on
the real Taskmandu data immediately:

- **List projects** (with search) — `GET /pm/projects`
- **Open a project** — shows its real kanban board, one column per Taskmandu task status
  (`Assigned`, `Pending`, `In Progress`, `Blocked`, `Completed`, `Cancelled`)
- **Create a project** — `POST /pm/projects` (name required; everything else optional, matches
  Taskmandu's own defaults: status `Planning`, etc.)
- **Add / edit / delete a task on the board** — `POST|PATCH|DELETE /pm/projects/{id}/tasks/{taskId}`.
  Taskmandu requires `dueDate` on every task even though most other fields are optional — the task
  form enforces that too. Moving a task between columns is just a status change (dropdown on the
  card), there's no drag-and-drop.
- **Delete a project** — asks for confirmation first; this is a real, permanent Taskmandu delete.

Validation in `ProjectController` mirrors Taskmandu's own Zod schemas (`project.validation.ts`)
field-for-field — same limits, same enums — so a bad request fails fast here with a clear message
instead of bouncing off Taskmandu as an opaque 400.

**Permissions:** create/update/delete all require the service account
(`TASKMANDU_EMAIL`/`TASKMANDU_PASSWORD`) to hold `projects:create` / `projects:update` /
`projects:delete` in Taskmandu — same account used everywhere else in this app. If a save fails
with a 403-style error from Taskmandu, that's the account's role, not a bug here; give it a
Manager-level role in Taskmandu (see the Setup section above).

**Read this before deploying anywhere but your own machine or a private staging box:** `Fetch`,
`Pull`, `Push` and `Checkout` run real git commands against the server's working copy via
`GitService` (Laravel's `Process` facade, fixed argument arrays — not a shell string — so this
isn't shell-injectable, but it is still a route that changes the deployed code from a browser
click). Options, roughly by how much you trust your setup:
- Simplest and safest: keep the mutating routes (`git/fetch`, `git/pull`, `git/push`,
  `git/checkout`) working only on your local machine or a staging box nobody else can reach, and
  make production serve `git/status` only (comment out or remove the other four routes there).
- Or gate the four mutating routes behind an extra check in `routes/pm.php`, e.g.
  `Route::middleware(['auth', 'can:manage-git'])->group(...)` with a policy/gate that only your
  own user passes.
- `pull` and `checkout` already refuse to run while the working tree has uncommitted changes, so
  the main remaining risk is someone with app access pushing or switching branches on a server
  you didn't mean to expose this on — hence the two options above.

## Today tab: freshness, stand-up, workload (v5)

- **Last synced / Sync now** — `POST /pm/sync` pulls from Taskmandu on demand; `pm:sync` also runs hourly
  from the scheduler (needs `php artisan schedule:work` locally or a `schedule:run` cron in production).
- **Since yesterday** strip — built from `pm_activities` (on Mondays it compares against Friday).
- **Due today / due in 3 days** flags alongside overdue.
- **Team workload** — per person: hours due this week vs `PM_WEEKLY_CAPACITY_HOURS`, open/overdue/blocked,
  and people with no tasks at all (from Taskmandu's employee list, cached 10 min).
- **Nudge tracking** — "Copy nudge" (no AI) and "Draft with AI" both log a `nudge` activity; cards show
  "Nudged 2d ago".
- Shortcuts on Today: j/k move, o open, p pin (max 3, saved in the browser), n nudge, s snooze, v verify, / search.

## Morning digest (v6)

A short message with the top flags: overdue (oldest first), due today, blocked, unassigned, the
since-yesterday counts, who has no tasks, who is over capacity, and how many done tasks wait for you to verify.

- **In the app:** Today -> **Morning digest** shows the exact text, with Copy and **Send to ...**.
- **Automatically:** `pm:digest` runs weekdays at `PM_DIGEST_TIME` (default 09:00, app timezone) when at least
  one channel is set. It syncs from Taskmandu first, like `pm:report`. Needs the scheduler running.
- **Channels** (set either or both in `.env`):
  - `PM_DIGEST_SLACK_WEBHOOK` - a Slack Incoming Webhook URL for the channel.
  - `PM_DIGEST_EMAIL` - one or more addresses, comma separated; uses your `MAIL_*` settings
    (the default `MAIL_MAILER=log` only writes to the log, so set a real mailer for email).
- `php artisan pm:digest --dry` prints it without sending; `--no-sync` skips the sync.
- One channel failing does not stop the other; the command exits non-zero and says which one failed.
- Tests: `php artisan test` (the test database is now in-memory SQLite, see `phpunit.xml`).
