<?php

namespace Tests\Unit;

use App\Services\Pm\Dictionary\DictionaryMatcher;
use PHPUnit\Framework\TestCase;

class DictionaryMatcherTest extends TestCase
{
    private function matcher(array $terms): DictionaryMatcher
    {
        return new DictionaryMatcher(array_map(fn ($t) => ['label' => $t[0], 'term' => $t[1]], $terms));
    }

    public function test_matching_ignores_case(): void
    {
        $m = $this->matcher([['QA', 'test']]);

        foreach (['TEST the form', 'Test the form', 'test the form'] as $title) {
            $this->assertArrayHasKey('QA', $m->match($title)['scores'], $title);
        }
    }

    public function test_only_whole_words_match(): void
    {
        $m = $this->matcher([['Development', 'fix'], ['Development', 'api'], ['QA', 'bug']]);

        $this->assertSame([], $m->match('Prefix the label, check rapid response, debug logs')['scores']);
        $this->assertArrayHasKey('Development', $m->match('Fix: checkout (API) timeout')['scores']);
    }

    public function test_phrases_match_across_whitespace_and_outscore_single_words(): void
    {
        $m = $this->matcher([['QA', 'not working'], ['Development', 'working']]);
        $r = $m->match('Search  not   working on mobile');

        $this->assertGreaterThan($r['scores']['Development'] ?? 0, $r['scores']['QA']);
    }

    public function test_title_beats_description_and_leading_word_gets_a_bonus(): void
    {
        $m = $this->matcher([['Research', 'research'], ['QA', 'test']]);

        $inTitle = $m->match('Some research')['scores']['Research'];
        $inDescription = $m->match('Some task', 'needs research')['scores']['Research'];
        $leading = $m->match('Research some thing')['scores']['Research'];

        $this->assertGreaterThan($inDescription, $inTitle);
        $this->assertGreaterThan($inTitle, $leading);
    }

    public function test_a_term_counts_once_even_if_it_repeats(): void
    {
        $m = $this->matcher([['QA', 'test']]);

        $this->assertSame($m->match('tests')['scores'] ?? [], []);
        $this->assertSame($m->match('x test')['scores']['QA'], $m->match('x test test test')['scores']['QA']);
    }
}
