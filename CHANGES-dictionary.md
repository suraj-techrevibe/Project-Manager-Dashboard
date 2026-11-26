# Dictionary tab + task categories in Team workload

Taskmandu is not touched. Rules, corrections and cached categories live only in this dashboard's database.

## What changed

- **Dictionary tab** (`/pm/dictionary`, Project controls group): keyword rules for Development, Research, QA and Maintenance.
  Add, edit, delete, switch on/off, see how many open tasks each keyword matches, preview the effect of an add/edit
  before saving, try a title, review tasks the rules could not classify, set or reset a manual category.
- **Team workload** now splits each person's estimated hours by category (stacked bar), adds Developer / Business /
  Category filters, a This week / All open switch, summary numbers and insights. Everything it showed before is still there
  (open, overdue, blocked, no-estimate, capacity bar, levels, rebalance hint, hide idle staff, click a person to filter tasks).
- **Reusable**: `DictionaryMatcher` (pure matcher), `TaskCategoryService::categoryFor()/categoryMap()`, the shared
  `lib/taskCategories.ts` and `<CategoryBadge>` / `<CategoryBar>` can be used from any other tab.

## How classification decides

- Whole-word, case-insensitive; multi-word phrases match across spaces.
- Phrases outweigh single words (1 word = 1, 2 words = 2.5, 3 = 4).
- A title hit counts fully, a description-only hit counts half; a title that starts with the keyword gets a +1.5 bonus.
- Runner-up within 75% of the winner, no match, or only a weak description hint → **Unclassified** (with a suggestion and reason).
- Result is cached per task (`pm_task_categories`) and recomputed only when the title/description or the enabled rules change.
- A manual category always wins until it is reset.

## Numbers

Category hours use the same task set, the same estimate split between assignees and the same "due this week" rule as the
existing workload. `category_hours` adds up to `hours`; `category_week_hours` adds up to `week_hours`. Sub-tasks carry no
hours, so they never add to category totals; under a Business/Category filter a sub-task follows its parent task.

## Deploy

1. `php artisan migrate` (creates `pm_dictionary_terms`, seeds the starting keyword lists, and `pm_task_categories`).
2. `npm run build`.
3. No new environment variables. Existing `PM_WEEKLY_CAPACITY_HOURS` still sets capacity.

Added to the QA starting list beyond your original list: `check`, `issue` (so "Check mobile navigation issue" is QA).
Remove them from the Dictionary tab if they are too broad.

## API

`GET /pm/api/workload?project_id=&category=` · `GET /pm/api/dictionary` · `POST /pm/api/dictionary/terms` ·
`PATCH|DELETE /pm/api/dictionary/terms/{id}` · `POST /pm/api/dictionary/preview` · `POST /pm/api/dictionary/test` ·
`GET /pm/api/dictionary/review` · `PUT|DELETE /pm/api/dictionary/cards/{card}/category`
