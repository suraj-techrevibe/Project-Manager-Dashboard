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
  boards. These get prefixed in the UI as `[Project name] Task title`.

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

The "Brief to tickets" tab's push button calls `POST /tasks` on Taskmandu directly (via
`TaskmanduSync::createTask`), which **requires an assignee** (Taskmandu's own validation:
`assignedToId` needs at least one entry). The tab fetches the employee list (`/pm/employees`) and
makes you pick one before the push button works — the whole drafted batch goes to that one
assignee; draft again separately if a brief needs to split across people.

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
    FlagsPanel.tsx          # Today tab: metrics + flag list, nudge/snooze/verify
    ChatPanel.tsx           # Ask tab
    BriefDrafter.tsx        # Brief to tickets tab
    ClientUpdate.tsx        # Client update tab
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
