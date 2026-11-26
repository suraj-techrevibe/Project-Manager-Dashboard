<?php

namespace App\Services\Pm\Dictionary;

use App\Models\PmCard;
use App\Models\PmDictionaryTerm;
use App\Models\PmTaskCategory;
use Illuminate\Support\Collection;

/**
 * Classifies mirrored Taskmandu tasks (pm_cards) into Development / QA / Research /
 * Maintenance using the private dictionary, and caches the answer in pm_task_categories.
 *
 * A task is re-classified only when its title/description changes or when the enabled
 * dictionary terms change. Reading categories for a workload page is one query plus a
 * hash comparison per task. Taskmandu itself is never written to.
 */
class TaskCategoryService
{
    public const CATEGORIES = ['Development', 'Research', 'QA', 'Maintenance'];
    public const UNCLASSIFIED = 'Unclassified';

    /** Needs at least this much weighted evidence, and at least this confidence, to commit to a category. */
    private const MIN_SCORE = 1.0;
    private const MIN_CONFIDENCE = 50;
    /** Runner-up this close to the winner = ambiguous → Unclassified (needs review). */
    private const TIE_RATIO = 0.75;

    private ?string $rulesHash = null;
    private ?DictionaryMatcher $matcher = null;

    /** @return string[] */
    public static function all(): array
    {
        return [...self::CATEGORIES, self::UNCLASSIFIED];
    }

    // ------------------------------------------------------------------ rules

    /** Enabled rules, as plain rows. */
    private function enabledTerms(): Collection
    {
        return PmDictionaryTerm::query()
            ->where('scope', PmDictionaryTerm::SCOPE_TASK_CATEGORY)
            ->where('enabled', true)
            ->orderBy('label')->orderBy('term')
            ->get(['label', 'term']);
    }

    public function rulesHash(): string
    {
        return $this->rulesHash ??= $this->hashOf($this->enabledTerms());
    }

    private function hashOf(Collection $terms): string
    {
        return sha1($terms->map(fn ($t) => $t['label'].'|'.$t['term'])->implode("\n"));
    }

    private function matcher(): DictionaryMatcher
    {
        return $this->matcher ??= new DictionaryMatcher($this->enabledTerms());
    }

    /** Call after the dictionary is edited so the next read sees the new rules. */
    public function forgetRules(): void
    {
        $this->rulesHash = null;
        $this->matcher = null;
    }

    // --------------------------------------------------------- classification

    /**
     * Pure decision for one piece of text.
     *
     * @return array{category: string, confidence: int, suggested: ?string, reason: ?string, matches: array<int, array<string, mixed>>}
     */
    public function classify(string $title, ?string $description = null, ?DictionaryMatcher $matcher = null): array
    {
        $r = ($matcher ?? $this->matcher())->match($title, $description);

        return $this->decide($r['scores'], $r['hits']);
    }

    /** @param array<string, float> $scores */
    private function decide(array $scores, array $hits): array
    {
        arsort($scores);
        $labels = array_keys($scores);
        $top = $scores[$labels[0] ?? ''] ?? 0.0;
        $second = $scores[$labels[1] ?? ''] ?? 0.0;
        $winner = $labels[0] ?? null;

        if ($winner === null) {
            return ['category' => self::UNCLASSIFIED, 'confidence' => 0, 'suggested' => null, 'reason' => 'No keyword matched', 'matches' => $hits];
        }

        $confidence = (int) round(100 * $top / ($top + $second + 1));

        if ($second >= $top * self::TIE_RATIO) {
            return ['category' => self::UNCLASSIFIED, 'confidence' => $confidence, 'suggested' => $winner, 'reason' => "Close call between {$winner} and {$labels[1]}", 'matches' => $hits];
        }

        if ($top < self::MIN_SCORE || $confidence < self::MIN_CONFIDENCE) {
            return ['category' => self::UNCLASSIFIED, 'confidence' => $confidence, 'suggested' => $winner, 'reason' => 'Weak evidence: only a hint in the description', 'matches' => $hits];
        }

        return ['category' => $winner, 'confidence' => $confidence, 'suggested' => null, 'reason' => null, 'matches' => $hits];
    }

    private function sourceHash(PmCard $c): string
    {
        return sha1(mb_strtolower(trim((string) $c->title))."\n".mb_strtolower(trim((string) $c->description)));
    }

    // ------------------------------------------------------------------ cache

    /**
     * Makes sure every given task has an up-to-date cached classification and
     * returns the stored rows keyed by card id. Only new/changed tasks (or all of
     * them after a rules change) are classified; a manual override is always kept.
     *
     * @param  Collection<int, PmCard>  $cards
     * @return Collection<int, PmTaskCategory>  keyed by card_id
     */
    public function ensure(Collection $cards): Collection
    {
        if ($cards->isEmpty()) {
            return collect();
        }

        $rules = $this->rulesHash();
        $existing = PmTaskCategory::query()->whereIn('card_id', $cards->pluck('id'))->get()->keyBy('card_id');
        $now = now()->toDateTimeString();
        $stale = [];

        foreach ($cards as $c) {
            $row = $existing->get($c->id);
            $src = $this->sourceHash($c);
            if ($row && $row->source_hash === $src && $row->rules_hash === $rules) {
                continue;
            }

            $d = $this->classify((string) $c->title, $c->description);
            $stale[] = [
                'card_id' => $c->id,
                'category' => $d['category'],
                'confidence' => $d['confidence'],
                'suggested' => $d['suggested'],
                'reason' => $d['reason'],
                'matches' => json_encode($d['matches']),
                'source_hash' => $src,
                'rules_hash' => $rules,
                'override' => $row?->override,
                'created_at' => $row?->created_at?->toDateTimeString() ?? $now,
                'updated_at' => $now,
            ];
        }

        foreach (array_chunk($stale, 200) as $chunk) {
            PmTaskCategory::upsert($chunk, ['card_id'], ['category', 'confidence', 'suggested', 'reason', 'matches', 'source_hash', 'rules_hash', 'updated_at']);
        }

        return $stale
            ? PmTaskCategory::query()->whereIn('card_id', $cards->pluck('id'))->get()->keyBy('card_id')
            : $existing;
    }

    /** @return array<int, string>  card id => effective category (override wins) */
    public function categoryMap(Collection $cards): array
    {
        return $this->ensure($cards)->map(fn (PmTaskCategory $r) => $r->effective())->all();
    }

    public function categoryFor(PmCard $card): string
    {
        return $this->categoryMap(collect([$card]))[$card->id] ?? self::UNCLASSIFIED;
    }

    // -------------------------------------------------------------- overrides

    public function setOverride(PmCard $card, string $category): PmTaskCategory
    {
        $row = $this->ensure(collect([$card]))->get($card->id);
        $row->update(['override' => $category]);

        return $row->fresh();
    }

    public function clearOverride(PmCard $card): ?PmTaskCategory
    {
        $row = PmTaskCategory::query()->where('card_id', $card->id)->first();
        $row?->update(['override' => null]);

        return $row?->fresh();
    }

    // ----------------------------------------------------------------- views

    /** Open (not completed/cancelled) mirrored tasks: the only ones that matter for workload and review. */
    public function openCards(): Collection
    {
        return PmCard::query()->whereNotIn('status', ['Completed', 'Cancelled'])->get();
    }

    /**
     * Tasks that need a human decision, plus every manual override.
     *
     * @return array{unclassified: array<int, array<string, mixed>>, overrides: array<int, array<string, mixed>>}
     */
    public function review(): array
    {
        $cards = $this->openCards()->keyBy('id');
        $rows = $this->ensure($cards);

        $shape = fn (PmCard $c, PmTaskCategory $r) => [
            'card_id' => $c->id,
            'title' => $c->title,
            'description' => $c->description ? mb_strimwidth(trim((string) $c->description), 0, 280, '…') : null,
            'assignee' => $c->assignee,
            'project_id' => $c->project_id,
            'project_name' => $c->project_name,
            'status' => $c->status,
            'url' => $c->url,
            'category' => $r->effective(),
            'auto_category' => $r->category,
            'suggested' => $r->suggested,
            'confidence' => $r->confidence,
            'reason' => $r->reason,
            'override' => $r->override,
        ];

        $unclassified = [];
        $overrides = [];
        foreach ($rows as $id => $r) {
            $c = $cards->get($id);
            if (! $c) {
                continue;
            }
            if ($r->override) {
                $overrides[] = $shape($c, $r);
            } elseif ($r->category === self::UNCLASSIFIED) {
                $unclassified[] = $shape($c, $r);
            }
        }

        // Tasks with a suggestion first (closest to a decision), then the rest by title.
        usort($unclassified, fn ($a, $b) => [$a['suggested'] === null, $a['title']] <=> [$b['suggested'] === null, $b['title']]);

        return ['unclassified' => $unclassified, 'overrides' => $overrides];
    }

    /**
     * Open assigned work per Taskmandu project (business) and category, for the workload
     * filter options and the "little research coverage" insight. Hours are task estimates.
     *
     * @return array<int, array{id: string, name: string, tasks: int, hours: array<string, float>}>
     */
    public function projectBreakdown(): array
    {
        $cards = $this->openCards()->filter(fn ($c) => $c->assignee && $c->project_id);
        $category = $this->categoryMap($cards);
        $out = [];

        foreach ($cards as $c) {
            $out[$c->project_id] ??= [
                'id' => (string) $c->project_id,
                'name' => (string) ($c->project_name ?: $c->project_id),
                'tasks' => 0,
                'hours' => array_fill_keys(self::all(), 0.0),
            ];
            $out[$c->project_id]['tasks']++;
            $out[$c->project_id]['hours'][$category[$c->id] ?? self::UNCLASSIFIED] += (float) $c->estimated_hours;
        }

        $out = array_map(fn ($p) => [...$p, 'hours' => array_map(fn ($h) => round($h, 1), $p['hours'])], $out);
        usort($out, fn ($a, $b) => strcasecmp($a['name'], $b['name']));

        return array_values($out);
    }

    /**
     * How many open tasks currently match each enabled term (a task counts once per term).
     *
     * @return array<string, int>  "label|term" => task count
     */
    public function termCounts(): array
    {
        $rows = $this->ensure($this->openCards());
        $counts = [];

        foreach ($rows as $r) {
            foreach ((array) $r->matches as $m) {
                $k = $m['label'].'|'.$m['term'];
                $counts[$k] = ($counts[$k] ?? 0) + 1;
            }
        }

        return $counts;
    }

    /**
     * What would change if the dictionary were edited? Runs the proposed rules over
     * every open task WITHOUT saving anything.
     *
     * @param  array<int, array<string, mixed>>  $changes  [{op: add|remove|toggle|edit, id?, label?, term?, enabled?}]
     * @return array{total: int, before: array<string, int>, after: array<string, int>, changed: array<int, array<string, mixed>>, changed_count: int}
     */
    public function preview(array $changes): array
    {
        $current = PmDictionaryTerm::query()->where('scope', PmDictionaryTerm::SCOPE_TASK_CATEGORY)->get();
        $proposed = $current->map(fn ($t) => ['id' => $t->id, 'label' => $t->label, 'term' => $t->term, 'enabled' => $t->enabled])->keyBy('id')->all();

        foreach ($changes as $i => $ch) {
            match ($ch['op'] ?? null) {
                'add' => $proposed['new'.$i] = ['id' => 'new'.$i, 'label' => (string) $ch['label'], 'term' => PmDictionaryTerm::normalize((string) $ch['term']), 'enabled' => true],
                'remove' => $proposed = array_diff_key($proposed, [($ch['id'] ?? '') => 1]),
                'toggle' => isset($proposed[$ch['id'] ?? '']) ? $proposed[$ch['id']]['enabled'] = (bool) ($ch['enabled'] ?? true) : null,
                'edit' => isset($proposed[$ch['id'] ?? '']) ? $proposed[$ch['id']]['term'] = PmDictionaryTerm::normalize((string) $ch['term']) : null,
                default => null,
            };
        }

        $after = new DictionaryMatcher(collect($proposed)->where('enabled', true)->values());
        $cards = $this->openCards();
        $rows = $this->ensure($cards);

        $before = array_fill_keys(self::all(), 0);
        $afterCounts = $before;
        $changed = [];

        foreach ($cards as $c) {
            $row = $rows->get($c->id);
            $old = $row?->effective() ?? self::UNCLASSIFIED;
            $new = $row?->override ?: $this->classify((string) $c->title, $c->description, $after)['category'];

            $before[$old] = ($before[$old] ?? 0) + 1;
            $afterCounts[$new] = ($afterCounts[$new] ?? 0) + 1;

            if ($old !== $new) {
                $changed[] = ['card_id' => $c->id, 'title' => $c->title, 'assignee' => $c->assignee, 'project_name' => $c->project_name, 'from' => $old, 'to' => $new];
            }
        }

        return [
            'total' => $cards->count(),
            'before' => $before,
            'after' => $afterCounts,
            'changed_count' => count($changed),
            'changed' => array_slice($changed, 0, 25),
        ];
    }
}
