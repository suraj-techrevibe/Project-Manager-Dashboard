<?php

namespace App\Http\Controllers;

use App\Models\PmCard;
use App\Models\PmDictionaryTerm;
use App\Services\Pm\Dictionary\TaskCategoryService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * Private keyword dictionary + task category review.
 *
 * Everything here reads and writes this dashboard's own tables. Taskmandu is never called,
 * and the mirrored task rows (pm_cards) are not modified — only pm_task_categories is.
 */
class PmDictionaryController extends Controller
{
    public function __construct(private TaskCategoryService $categories) {}

    /** Terms grouped by category, each with how many open tasks it currently matches. */
    public function index(): JsonResponse
    {
        $counts = $this->categories->termCounts();
        $terms = PmDictionaryTerm::query()
            ->where('scope', PmDictionaryTerm::SCOPE_TASK_CATEGORY)
            ->orderBy('term')
            ->get();

        $grouped = [];
        foreach (TaskCategoryService::CATEGORIES as $label) {
            $grouped[$label] = $terms->where('label', $label)->values()->map(fn ($t) => [
                'id' => $t->id,
                'term' => $t->term,
                'enabled' => $t->enabled,
                'matches' => $t->enabled ? ($counts[$label.'|'.$t->term] ?? 0) : null,
            ])->all();
        }

        return response()->json([
            'scope' => PmDictionaryTerm::SCOPE_TASK_CATEGORY,
            'categories' => TaskCategoryService::CATEGORIES,
            'terms' => $grouped,
            'open_tasks' => $this->categories->openCards()->count(),
        ]);
    }

    public function store(Request $r): JsonResponse
    {
        $data = $r->validate([
            'label' => ['required', Rule::in(TaskCategoryService::CATEGORIES)],
            'term' => 'required|string|max:120',
        ]);
        $term = PmDictionaryTerm::normalize($data['term']);

        if ($term === '') {
            return response()->json(['message' => 'Enter a keyword or phrase.'], 422);
        }
        if ($this->exists($data['label'], $term)) {
            return response()->json(['message' => "“{$term}” is already in {$data['label']}."], 422);
        }

        $row = PmDictionaryTerm::create([
            'scope' => PmDictionaryTerm::SCOPE_TASK_CATEGORY,
            'label' => $data['label'],
            'term' => $term,
            'enabled' => true,
        ]);
        $this->categories->forgetRules();

        return response()->json(['term' => $this->shape($row)], 201);
    }

    public function update(Request $r, PmDictionaryTerm $term): JsonResponse
    {
        $data = $r->validate([
            'term' => 'sometimes|string|max:120',
            'enabled' => 'sometimes|boolean',
        ]);

        if (array_key_exists('term', $data)) {
            $new = PmDictionaryTerm::normalize($data['term']);
            if ($new === '') {
                return response()->json(['message' => 'Enter a keyword or phrase.'], 422);
            }
            if ($new !== $term->term && $this->exists($term->label, $new)) {
                return response()->json(['message' => "“{$new}” is already in {$term->label}."], 422);
            }
            $data['term'] = $new;
        }

        $term->update($data);
        $this->categories->forgetRules();

        return response()->json(['term' => $this->shape($term->fresh())]);
    }

    public function destroy(PmDictionaryTerm $term): JsonResponse
    {
        $term->delete();
        $this->categories->forgetRules();

        return response()->json(['ok' => true]);
    }

    /** Impact of a proposed edit (add / remove / toggle / edit) on open tasks. Saves nothing. */
    public function preview(Request $r): JsonResponse
    {
        $data = $r->validate([
            'changes' => 'required|array|min:1|max:20',
            'changes.*.op' => ['required', Rule::in(['add', 'remove', 'toggle', 'edit'])],
            'changes.*.id' => 'nullable|integer',
            'changes.*.label' => ['nullable', Rule::in(TaskCategoryService::CATEGORIES)],
            'changes.*.term' => 'nullable|string|max:120',
            'changes.*.enabled' => 'nullable|boolean',
        ]);

        return response()->json($this->categories->preview($data['changes']));
    }

    /** "What would this title be?" — nothing is stored. */
    public function test(Request $r): JsonResponse
    {
        $data = $r->validate([
            'title' => 'required|string|max:300',
            'description' => 'nullable|string|max:5000',
        ]);

        return response()->json($this->categories->classify($data['title'], $data['description'] ?? null));
    }

    /** Tasks needing a decision, and manual overrides. */
    public function review(): JsonResponse
    {
        return response()->json($this->categories->review());
    }

    public function setOverride(Request $r, PmCard $card): JsonResponse
    {
        $data = $r->validate(['category' => ['required', Rule::in(TaskCategoryService::all())]]);
        $row = $this->categories->setOverride($card, $data['category']);

        return response()->json(['card_id' => $card->id, 'category' => $row->effective(), 'override' => $row->override]);
    }

    public function clearOverride(PmCard $card): JsonResponse
    {
        $row = $this->categories->clearOverride($card);

        return response()->json(['card_id' => $card->id, 'category' => $row?->effective() ?? TaskCategoryService::UNCLASSIFIED, 'override' => null]);
    }

    private function exists(string $label, string $term): bool
    {
        return PmDictionaryTerm::query()
            ->where('scope', PmDictionaryTerm::SCOPE_TASK_CATEGORY)
            ->where('label', $label)
            ->where('term', $term)
            ->exists();
    }

    private function shape(PmDictionaryTerm $t): array
    {
        return ['id' => $t->id, 'label' => $t->label, 'term' => $t->term, 'enabled' => $t->enabled, 'matches' => null];
    }
}
