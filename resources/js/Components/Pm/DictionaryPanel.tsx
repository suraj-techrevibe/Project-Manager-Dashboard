import { useCallback, useEffect, useState } from 'react';
import { pmApi } from '@/lib/pmApi';
import { CATEGORIES, CATEGORY_STYLE, RULE_CATEGORIES } from '@/lib/taskCategories';
import type { CategoryReview, CategoryReviewTask, ClassifyResult, DictionaryChange, DictionaryData, DictionaryPreview, DictionaryTerm, TaskCategory } from '@/types/pm';
import { CategoryBadge } from './CategoryBadge';
import { EmptyState, Notice, PageHeader, Pill, Section, btnPrimary, btnSecondary } from './ui/kit';

type RuleLabel = (typeof RULE_CATEGORIES)[number];

const errText = (e: unknown, fallback: string) => (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? fallback;
const inputCls = 'w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-800 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400';

/** What a proposed rule change would do to open tasks, before anything is saved. */
function PreviewBox({ preview, onClose }: { preview: DictionaryPreview; onClose: () => void }) {
  return (
    <div className="mt-2 rounded-lg border border-indigo-200 bg-indigo-50/60 p-3 text-xs text-slate-700">
      <div className="flex items-start justify-between gap-2">
        <div className="font-medium text-indigo-800">
          {preview.changed_count === 0 ? 'No open task would change category.' : `${preview.changed_count} of ${preview.total} open task${preview.total === 1 ? '' : 's'} would change category.`}
        </div>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-700" aria-label="Close preview">
          ✕
        </button>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-slate-500">
        {CATEGORIES.map((c) => (
          <span key={c}>
            {c} {preview.before[c]} → <b className="text-slate-700">{preview.after[c]}</b>
          </span>
        ))}
      </div>
      {preview.changed.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {preview.changed.map((t) => (
            <li key={t.card_id} className="truncate">
              {t.title} <span className="text-slate-400">· {t.from} → {t.to}</span>
            </li>
          ))}
          {preview.changed_count > preview.changed.length && <li className="text-slate-400">…and {preview.changed_count - preview.changed.length} more</li>}
        </ul>
      )}
    </div>
  );
}

function CategoryCard({ label, terms, openTasks, onChanged }: { label: RuleLabel; terms: DictionaryTerm[]; openTasks: number; onChanged: () => void }) {
  const style = CATEGORY_STYLE[label];
  const [adding, setAdding] = useState('');
  const [editing, setEditing] = useState<{ id: number; value: string } | null>(null);
  const [preview, setPreview] = useState<DictionaryPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<unknown>, fallback: string) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setPreview(null);
      onChanged();
    } catch (e) {
      setError(errText(e, fallback));
    } finally {
      setBusy(false);
    }
  }

  async function showPreview(change: DictionaryChange) {
    setBusy(true);
    setError(null);
    try {
      setPreview((await pmApi.previewDictionary([change])).data);
    } catch (e) {
      setError(errText(e, "Couldn't preview that change."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
        <span className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <span className={`h-2.5 w-2.5 rounded-sm ${style.dot}`} />
          {style.label}
        </span>
        <span className="text-xs text-slate-400">{terms.filter((t) => t.enabled).length} of {terms.length} on</span>
      </div>

      <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto">
        {terms.map((t) => (
          <li key={t.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
            <input
              type="checkbox"
              checked={t.enabled}
              onChange={(e) => void run(() => pmApi.updateDictionaryTerm(t.id, { enabled: e.target.checked }), "Couldn't change that keyword.")}
              className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600"
              aria-label={`${t.enabled ? 'Turn off' : 'Turn on'} ${t.term}`}
            />
            {editing?.id === t.id ? (
              <span className="flex min-w-0 flex-1 items-center gap-1.5">
                <input
                  autoFocus
                  value={editing.value}
                  onChange={(e) => setEditing({ id: t.id, value: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void run(async () => { await pmApi.updateDictionaryTerm(t.id, { term: editing.value }); setEditing(null); }, "Couldn't save that keyword.");
                    if (e.key === 'Escape') setEditing(null);
                  }}
                  className={inputCls}
                />
                <button className="text-xs text-slate-500 underline" onClick={() => void showPreview({ op: 'edit', id: t.id, term: editing.value })}>
                  Preview
                </button>
                <button
                  className="text-xs font-medium text-indigo-700 underline"
                  onClick={() => void run(async () => { await pmApi.updateDictionaryTerm(t.id, { term: editing.value }); setEditing(null); }, "Couldn't save that keyword.")}
                >
                  Save
                </button>
                <button className="text-xs text-slate-400 underline" onClick={() => { setEditing(null); setPreview(null); }}>
                  Cancel
                </button>
              </span>
            ) : (
              <>
                <button onClick={() => setEditing({ id: t.id, value: t.term })} className={`min-w-0 flex-1 truncate text-left ${t.enabled ? 'text-slate-800' : 'text-slate-400 line-through'}`} title="Click to edit">
                  {t.term}
                </button>
                <span className="shrink-0 text-[11px] text-slate-400" title="Open tasks this keyword matches">
                  {t.matches === null ? 'off' : `${t.matches} task${t.matches === 1 ? '' : 's'}`}
                </span>
                <button
                  onClick={() => void run(() => pmApi.deleteDictionaryTerm(t.id), "Couldn't delete that keyword.")}
                  className="shrink-0 text-xs text-slate-300 hover:text-red-600"
                  aria-label={`Delete ${t.term}`}
                  title="Delete keyword"
                >
                  ✕
                </button>
              </>
            )}
          </li>
        ))}
        {terms.length === 0 && <li className="px-3 py-3 text-xs text-slate-400">No keywords yet.</li>}
      </ul>

      <div className="border-t border-slate-100 p-3">
        <div className="flex items-center gap-1.5">
          <input
            value={adding}
            onChange={(e) => setAdding(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && adding.trim() && void run(async () => { await pmApi.addDictionaryTerm(label, adding); setAdding(''); }, "Couldn't add that keyword.")}
            placeholder={`Add a ${label} keyword or phrase`}
            className={inputCls}
            aria-label={`New ${label} keyword`}
          />
          <button className={btnSecondary} disabled={busy || !adding.trim()} onClick={() => void showPreview({ op: 'add', label, term: adding })}>
            Preview
          </button>
          <button className={btnPrimary} disabled={busy || !adding.trim()} onClick={() => void run(async () => { await pmApi.addDictionaryTerm(label, adding); setAdding(''); }, "Couldn't add that keyword.")}>
            Add
          </button>
        </div>
        {error && <p className="mt-1.5 text-xs text-red-600">{error}</p>}
        {preview && <PreviewBox preview={preview} onClose={() => setPreview(null)} />}
        <p className="mt-1.5 text-[11px] text-slate-400">{openTasks} open tasks are checked against these rules.</p>
      </div>
    </div>
  );
}

/** Try a title against the live rules. Saves nothing. */
function TestBox() {
  const [title, setTitle] = useState('');
  const [result, setResult] = useState<ClassifyResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (!title.trim()) {
      setError('Enter a task title first.');
      return;
    }
    setError(null);
    try {
      setResult((await pmApi.testClassification(title)).data);
    } catch (e) {
      setError(errText(e, "Couldn't test that title."));
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="mb-1.5 text-sm font-medium text-slate-800">Try a task title</div>
      <div className="flex gap-2">
        <input value={title} onChange={(e) => { setTitle(e.target.value); setError(null); }} onKeyDown={(e) => e.key === 'Enter' && void run()} placeholder="Fix booking form validation" className={inputCls} aria-label="Task title to test" />
        <button className={btnSecondary} onClick={() => void run()}>
          Classify
        </button>
      </div>
      {error && <p className="mt-1.5 text-xs text-red-600">{error}</p>}
      {result && (
        <div className="mt-2 text-sm">
          <CategoryBadge category={result.category} />
          {result.confidence > 0 && <span className="ml-2 text-xs text-slate-500">{result.confidence}% confidence</span>}
          {result.reason && <span className="ml-2 text-xs text-amber-700">{result.reason}{result.suggested ? ` (suggests ${result.suggested})` : ''}</span>}
          {result.matches.length > 0 && <div className="mt-1 text-xs text-slate-500">Matched: {result.matches.map((m) => `${m.term} → ${m.label}`).join(', ')}</div>}
        </div>
      )}
    </div>
  );
}

function ReviewRow({ task, onChanged }: { task: CategoryReviewTask; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);

  async function assign(category: TaskCategory) {
    setBusy(true);
    try {
      await pmApi.setTaskCategory(task.card_id, category);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    setBusy(true);
    try {
      await pmApi.resetTaskCategory(task.card_id);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex flex-col gap-1.5 px-3 py-2.5 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <div className="text-sm font-medium text-slate-800">{task.url ? <a href={task.url} target="_blank" rel="noreferrer" className="hover:underline">{task.title}</a> : task.title}</div>
        <div className="text-[11px] text-slate-500">
          {task.assignee ?? 'Unassigned'} · {task.project_name ?? 'No project'} · {task.status}
        </div>
        {task.description && <div className="mt-0.5 line-clamp-2 text-xs text-slate-500">{task.description}</div>}
        {!task.override && task.reason && (
          <div className="mt-0.5 text-[11px] text-amber-700">
            {task.reason}
            {task.suggested ? ` · suggested: ${task.suggested}` : ''}
          </div>
        )}
        {task.override && <div className="mt-0.5 text-[11px] text-slate-500">Automatic result: {task.auto_category}</div>}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
        {task.override && <CategoryBadge category={task.override} />}
        <select
          disabled={busy}
          value=""
          onChange={(e) => e.target.value && void assign(e.target.value as TaskCategory)}
          className="rounded-lg border border-slate-200 bg-white py-1 pl-2 pr-6 text-xs text-slate-700"
          aria-label={`Set category for ${task.title}`}
        >
          <option value="">{task.override ? 'Change…' : 'Assign…'}</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        {task.override && (
          <button disabled={busy} onClick={() => void reset()} className="text-xs text-slate-500 underline hover:text-slate-800">
            Reset
          </button>
        )}
      </div>
    </li>
  );
}

/**
 * Dictionary: the private keyword rules that sort Taskmandu tasks into categories.
 * Everything here lives in this dashboard's database; Taskmandu is never changed.
 */
export default function DictionaryPanel() {
  const [data, setData] = useState<DictionaryData | null>(null);
  const [review, setReview] = useState<CategoryReview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [d, r] = await Promise.all([pmApi.dictionary(), pmApi.categoryReview()]);
      setData(d.data);
      setReview(r.data);
      setError(null);
    } catch {
      setError("Couldn't load the dictionary.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      <PageHeader
        icon="book"
        title="Dictionary"
        description="Keywords and phrases that sort tasks into Development, Research, QA and Maintenance. Used by Team workload, and available to other features."
        status={data ? `${data.open_tasks} open tasks checked · rules are private to this dashboard` : undefined}
      />

      {error && <Notice tone="danger">{error} <button className="underline" onClick={() => void load()}>Try again</button></Notice>}

      <TestBox />

      {!data && !error && <p className="text-sm text-slate-500">Loading…</p>}

      {data && (
        <div className="grid gap-3 lg:grid-cols-2">
          {RULE_CATEGORIES.map((label) => (
            <CategoryCard key={label} label={label} terms={data.terms[label] ?? []} openTasks={data.open_tasks} onChanged={() => void load()} />
          ))}
        </div>
      )}

      <Section id="needs-review" title="Needs review" subtitle="Tasks the rules couldn't classify with confidence" count={review?.unclassified.length ?? 0} tone={review && review.unclassified.length > 0 ? 'warn' : 'ok'}>
        {review && review.unclassified.length === 0 ? (
          <EmptyState title="Nothing to review">Every open task has a clear category.</EmptyState>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
            {review?.unclassified.map((t) => <ReviewRow key={t.card_id} task={t} onChanged={() => void load()} />)}
          </ul>
        )}
      </Section>

      <Section id="overrides" title="Manual corrections" subtitle="Categories you set by hand. Reset returns a task to automatic classification." count={review?.overrides.length ?? 0} defaultOpen={Boolean(review?.overrides.length)}>
        {review && review.overrides.length === 0 ? (
          <p className="text-sm text-slate-500">No manual corrections yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
            {review?.overrides.map((t) => <ReviewRow key={t.card_id} task={t} onChanged={() => void load()} />)}
          </ul>
        )}
      </Section>

      <p className="text-[11px] text-slate-400">
        <Pill>Private</Pill> Rules and corrections are stored only in this dashboard. Categories are a guide based on task titles and descriptions; hours elsewhere are Taskmandu estimates, not timesheets.
      </p>
    </div>
  );
}
