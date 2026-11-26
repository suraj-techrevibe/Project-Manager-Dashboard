<?php

namespace App\Services\Pm\Dictionary;

/**
 * Reusable keyword matcher. Knows nothing about tasks or the database: give it
 * terms ({label, term}) and some text, get back a score per label.
 *
 *  - case-insensitive, whole-word only ("fix" never matches "prefix")
 *  - multi-word phrases match across any whitespace
 *  - longer phrases score higher than single words, so specific beats generic
 *  - a hit in the title counts fully; a hit only in the description counts half
 *  - a title that STARTS with the term gets a bonus ("Fix booking form validation"
 *    is a fix first, a validation second)
 */
final class DictionaryMatcher
{
    public const DESCRIPTION_FACTOR = 0.5;
    public const LEADING_BONUS = 1.5;

    /** @var array<int, array{label: string, term: string, regex: string, first: string, weight: float}> */
    private array $compiled = [];

    /** @param  iterable<int, array{label: string, term: string}>  $terms */
    public function __construct(iterable $terms)
    {
        foreach ($terms as $t) {
            $term = mb_strtolower(trim((string) $t['term']));
            if ($term === '') {
                continue;
            }
            $words = preg_split('/\s+/u', $term) ?: [$term];
            $parts = array_map(fn ($w) => preg_quote($w, '/'), $words);

            $this->compiled[] = [
                'label' => (string) $t['label'],
                'term' => $term,
                'regex' => '/(?<![\p{L}\p{N}])'.implode('\s+', $parts).'(?![\p{L}\p{N}])/iu',
                'first' => $words[0],
                'weight' => self::weightOf($term),
            ];
        }
    }

    /** 1 word = 1, 2 words = 2.5, 3 words = 4 … */
    public static function weightOf(string $term): float
    {
        $n = max(1, count(preg_split('/\s+/u', trim($term)) ?: []));

        return $n * 1.5 - 0.5;
    }

    /**
     * @return array{scores: array<string, float>, hits: array<int, array{label: string, term: string, in: string, points: float}>}
     */
    public function match(string $title, ?string $description = null): array
    {
        $lead = $this->leadingWord($title);
        $scores = [];
        $hits = [];

        foreach ($this->compiled as $c) {
            $inTitle = (bool) preg_match($c['regex'], $title);
            $inDescription = ! $inTitle && $description !== null && $description !== '' && preg_match($c['regex'], $description);

            if (! $inTitle && ! $inDescription) {
                continue;
            }

            $points = $c['weight'];
            if ($inTitle && $lead !== '' && $lead === $c['first']) {
                $points += self::LEADING_BONUS;
            }
            if (! $inTitle) {
                $points *= self::DESCRIPTION_FACTOR;
            }

            $scores[$c['label']] = ($scores[$c['label']] ?? 0.0) + $points;
            $hits[] = ['label' => $c['label'], 'term' => $c['term'], 'in' => $inTitle ? 'title' : 'description', 'points' => round($points, 2)];
        }

        return ['scores' => $scores, 'hits' => $hits];
    }

    private function leadingWord(string $title): string
    {
        if (preg_match('/^[^\p{L}\p{N}]*([\p{L}\p{N}]+)/u', mb_strtolower($title), $m)) {
            return $m[1];
        }

        return '';
    }
}
