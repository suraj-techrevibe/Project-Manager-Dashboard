<?php

namespace Tests\Feature;

use App\Models\PmCard;
use App\Models\PmDictionaryTerm;
use App\Models\PmSubtask;
use App\Models\PmTaskCategory;
use App\Models\User;
use App\Services\Pm\Dictionary\TaskCategoryService;
use App\Services\Pm\FlagService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class TaskCategoryTest extends TestCase
{
    use RefreshDatabase;

    private int $n = 0;

    private function card(string $title, array $extra = []): PmCard
    {
        $this->n++;

        return PmCard::create(array_merge([
            'external_id' => "project:p1:task:t{$this->n}",
            'project_id' => 'p1',
            'project_name' => 'Salon',
            'task_id' => "t{$this->n}",
            'title' => $title,
            'assignee' => 'Aarav',
            'status' => 'In Progress',
            'estimated_hours' => 4,
            'due_at' => now()->toDateString(),
        ], $extra));
    }

    private function service(): TaskCategoryService
    {
        return app(TaskCategoryService::class);
    }

    // ------------------------------------------------------------ classification

    public function test_spec_examples_classify_as_expected(): void
    {
        $expected = [
            'Research competitor pricing' => 'Research',
            'Check mobile navigation issue' => 'QA',
            'Fix booking form validation' => 'Development',
            'Update Laravel dependencies' => 'Maintenance',
            'Analyse competitor website speed' => 'Research',
            'Test payment integration' => 'QA',
            'Implement payment gateway' => 'Development',
        ];

        foreach ($expected as $title => $category) {
            $this->assertSame($category, $this->service()->classify($title)['category'], $title);
        }
    }

    public function test_uppercase_and_lowercase_titles_classify_the_same(): void
    {
        $this->assertSame('QA', $this->service()->classify('TEST PAYMENT INTEGRATION')['category']);
        $this->assertSame('QA', $this->service()->classify('test payment integration')['category']);
    }

    public function test_multi_word_phrases_match(): void
    {
        $this->assertSame('Maintenance', $this->service()->classify('Schedule server maintenance window')['category']);
        $this->assertSame('QA', $this->service()->classify('Search not working on Safari')['category']);
    }

    public function test_no_keywords_means_unclassified_with_a_reason(): void
    {
        $r = $this->service()->classify('Sort out the thing');

        $this->assertSame('Unclassified', $r['category']);
        $this->assertSame('No keyword matched', $r['reason']);
        $this->assertNull($r['suggested']);
    }

    public function test_ambiguous_titles_are_not_forced(): void
    {
        // "build" (Development) and "audit" (Research): same strength, neither leads.
        $r = $this->service()->classify('Plan the build and the audit');

        $this->assertSame('Unclassified', $r['category']);
        $this->assertNotNull($r['suggested']);
        $this->assertStringContainsString('Close call', (string) $r['reason']);
    }

    public function test_description_only_hints_are_too_weak_to_commit(): void
    {
        $r = $this->service()->classify('Homepage tweaks', 'maybe do some research');

        $this->assertSame('Unclassified', $r['category']);
        $this->assertSame('Research', $r['suggested']);
    }

    public function test_description_adds_context_to_a_vague_title(): void
    {
        $r = $this->service()->classify('Homepage', 'Investigate competitor layouts and run a benchmark');

        $this->assertSame('Research', $r['category']);
    }

    public function test_words_inside_other_words_do_not_match(): void
    {
        $this->assertSame('Unclassified', $this->service()->classify('Prefix labels and rapid prototype')['category']);
    }

    // ------------------------------------------------------------------ caching

    public function test_classification_is_cached_and_only_recomputed_when_source_or_rules_change(): void
    {
        $card = $this->card('Fix booking form validation');
        $this->service()->categoryMap(collect([$card]));
        $row = PmTaskCategory::first();
        $stamp = $row->updated_at;

        $this->travel(5)->minutes();
        $this->service()->categoryMap(collect([$card->fresh()]));
        $this->assertTrue($stamp->equalTo(PmTaskCategory::first()->updated_at), 'unchanged task must not be reclassified');

        // Title changes (as a Taskmandu sync would do) -> reclassified automatically.
        $card->update(['title' => 'Research competitor pricing']);
        $this->service()->categoryMap(collect([$card->fresh()]));
        $this->assertSame('Research', PmTaskCategory::first()->category);

        // Rules change -> reclassified automatically.
        PmDictionaryTerm::where('label', 'Research')->where('term', 'research')->update(['enabled' => false]);
        PmDictionaryTerm::where('label', 'Research')->where('term', 'competitor')->update(['enabled' => false]);
        $this->service()->forgetRules();
        $this->service()->categoryMap(collect([$card->fresh()]));
        $this->assertSame('Unclassified', PmTaskCategory::first()->category);
    }

    public function test_manual_override_wins_survives_reclassification_and_can_be_reset(): void
    {
        $card = $this->card('Sort out the thing');
        $user = User::factory()->create();

        $this->actingAs($user)->putJson("/pm/api/dictionary/cards/{$card->id}/category", ['category' => 'QA'])
            ->assertOk()->assertJsonPath('category', 'QA');
        $this->assertSame('QA', $this->service()->categoryFor($card));

        $card->update(['title' => 'Sort out another thing']); // source changed -> auto result recomputed, override kept
        $this->assertSame('QA', $this->service()->categoryFor($card->fresh()));
        $this->assertSame('QA', PmTaskCategory::first()->override);

        $this->deleteJson("/pm/api/dictionary/cards/{$card->id}/category")->assertOk()->assertJsonPath('category', 'Unclassified');
        $this->assertSame('Unclassified', $this->service()->categoryFor($card->fresh()));
    }

    public function test_invalid_override_category_is_rejected(): void
    {
        $card = $this->card('Anything');

        $this->actingAs(User::factory()->create())
            ->putJson("/pm/api/dictionary/cards/{$card->id}/category", ['category' => 'Nonsense'])
            ->assertStatus(422);
    }

    // ----------------------------------------------------------- dictionary API

    public function test_dictionary_requires_login(): void
    {
        $this->getJson('/pm/api/dictionary')->assertUnauthorized();
        $this->get('/pm/dictionary')->assertRedirect('/login');
    }

    public function test_dictionary_tab_renders_for_signed_in_users(): void
    {
        $this->withoutVite()->actingAs(User::factory()->create())->get('/pm/dictionary')
            ->assertOk()
            ->assertInertia(fn ($page) => $page->component('Pm/App')->where('page', 'dictionary'));
    }

    public function test_default_dictionary_is_seeded_and_terms_can_be_added_edited_disabled_and_deleted(): void
    {
        Http::fake();
        $this->actingAs(User::factory()->create());

        $this->getJson('/pm/api/dictionary')->assertOk()
            ->assertJsonCount(4, 'terms')
            ->assertJsonFragment(['term' => 'regression']);

        $id = $this->postJson('/pm/api/dictionary/terms', ['label' => 'QA', 'term' => '  Smoke   Test '])
            ->assertCreated()->assertJsonPath('term.term', 'smoke test')->json('term.id');
        $this->postJson('/pm/api/dictionary/terms', ['label' => 'QA', 'term' => 'smoke test'])->assertStatus(422);

        $this->patchJson("/pm/api/dictionary/terms/{$id}", ['term' => 'sanity check'])->assertOk()->assertJsonPath('term.term', 'sanity check');
        $this->patchJson("/pm/api/dictionary/terms/{$id}", ['enabled' => false])->assertOk()->assertJsonPath('term.enabled', false);
        $this->deleteJson("/pm/api/dictionary/terms/{$id}")->assertOk();
        $this->assertDatabaseMissing('pm_dictionary_terms', ['id' => $id]);

        $this->postJson('/pm/api/dictionary/terms', ['label' => 'Unclassified', 'term' => 'x'])->assertStatus(422);

        // Taskmandu is never contacted by any of this.
        Http::assertNothingSent();
    }

    public function test_keyword_changes_reclassify_tasks_and_preview_saves_nothing(): void
    {
        $this->actingAs(User::factory()->create());
        $card = $this->card('Run smoke test on checkout');
        $this->assertSame('QA', $this->service()->categoryFor($card)); // "test"

        $preview = $this->postJson('/pm/api/dictionary/preview', ['changes' => [['op' => 'add', 'label' => 'Maintenance', 'term' => 'smoke test']]])
            ->assertOk()->json();
        $this->assertSame(1, $preview['changed_count']);
        $this->assertSame('Maintenance', $preview['changed'][0]['to']);
        $this->assertDatabaseMissing('pm_dictionary_terms', ['term' => 'smoke test']);
        $this->assertSame('QA', $this->service()->categoryFor($card->fresh()));

        $this->postJson('/pm/api/dictionary/terms', ['label' => 'Maintenance', 'term' => 'smoke test'])->assertCreated();
        $this->assertSame('Maintenance', $this->service()->categoryFor($card->fresh()));
    }

    public function test_keyword_task_counts_are_reported(): void
    {
        $this->actingAs(User::factory()->create());
        $this->card('Test payment integration');
        $this->card('Test the login');

        $terms = collect($this->getJson('/pm/api/dictionary')->json('terms.QA'));
        $this->assertSame(2, $terms->firstWhere('term', 'test')['matches']);

        $off = $terms->firstWhere('term', 'regression');
        $this->patchJson('/pm/api/dictionary/terms/'.$off['id'], ['enabled' => false]);
        $this->assertNull(collect($this->getJson('/pm/api/dictionary')->json('terms.QA'))->firstWhere('term', 'regression')['matches']);
    }

    public function test_review_lists_unclassified_tasks_with_suggestions_and_overrides(): void
    {
        $this->actingAs(User::factory()->create());
        $this->card('Sort out the thing');
        $this->card('Plan the build and the audit');
        $this->card('Implement payment gateway');
        $manual = $this->card('Another vague one');
        $this->putJson("/pm/api/dictionary/cards/{$manual->id}/category", ['category' => 'Research'])->assertOk();

        $review = $this->getJson('/pm/api/dictionary/review')->assertOk()->json();

        $this->assertCount(2, $review['unclassified']);
        $this->assertSame('Plan the build and the audit', $review['unclassified'][0]['title']); // has a suggestion -> first
        $this->assertNotNull($review['unclassified'][0]['suggested']);
        $this->assertSame('No keyword matched', $review['unclassified'][1]['reason']);
        $this->assertCount(1, $review['overrides']);
    }

    public function test_test_endpoint_classifies_without_saving(): void
    {
        $this->actingAs(User::factory()->create());

        $this->postJson('/pm/api/dictionary/test', ['title' => 'Test payment integration'])
            ->assertOk()->assertJsonPath('category', 'QA');
        $this->assertSame(0, PmTaskCategory::count());
    }

    // ------------------------------------------------------------------ workload

    public function test_category_hours_reconcile_with_existing_workload_totals(): void
    {
        $this->card('Implement payment gateway', ['estimated_hours' => 6]);          // Development
        $this->card('Test payment integration', ['estimated_hours' => 3]);           // QA
        $this->card('Research competitor pricing', ['estimated_hours' => 5]);        // Research
        $this->card('Update Laravel dependencies', ['estimated_hours' => 2]);        // Maintenance
        $this->card('Sort out the thing', ['estimated_hours' => 1.5]);               // Unclassified
        $this->card('Fix later', ['estimated_hours' => null]);                       // no estimate: counted as a task, 0 hours
        $this->card('Fix next week', ['estimated_hours' => 8, 'due_at' => now()->addWeeks(3)->toDateString()]); // outside this week
        $this->card('Done already', ['status' => 'Completed', 'estimated_hours' => 9]);

        $row = collect(app(FlagService::class)->workload())->firstWhere('name', 'Aarav');

        $this->assertSame(7, $row['open']);
        $this->assertSame(1, $row['no_estimate']);
        $this->assertEqualsWithDelta($row['hours'], array_sum($row['category_hours']), 0.15);
        $this->assertEqualsWithDelta($row['week_hours'], array_sum($row['category_week_hours']), 0.15);
        $this->assertEqualsWithDelta(1.5, $row['category_hours']['Unclassified'], 0.01);
        $this->assertEqualsWithDelta(14.0, $row['category_hours']['Development'], 0.01); // 6 + 8 ("Fix next week")
        $this->assertEqualsWithDelta(6.0, $row['category_week_hours']['Development'], 0.01);
        $this->assertEqualsWithDelta(17.5, $row['week_hours'], 0.01);
    }

    public function test_existing_workload_numbers_are_unchanged_by_categories(): void
    {
        $this->card('Implement payment gateway', ['estimated_hours' => 6, 'assignee' => 'Aarav, Maya']);
        $this->card('Test payment integration', ['estimated_hours' => 4, 'assignee' => 'Maya', 'status' => 'Blocked', 'due_at' => now()->subDay()->toDateString()]);

        $rows = collect(app(FlagService::class)->workload())->keyBy('name');

        $this->assertSame(1, $rows['Aarav']['open']);
        $this->assertEqualsWithDelta(3.0, $rows['Aarav']['hours'], 0.01);
        $this->assertSame(2, $rows['Maya']['open']);
        $this->assertEqualsWithDelta(7.0, $rows['Maya']['hours'], 0.01);
        $this->assertSame(1, $rows['Maya']['blocked']);
        $this->assertSame(1, $rows['Maya']['overdue']);
    }

    public function test_multiple_assignees_split_category_hours_without_double_counting(): void
    {
        $this->card('Implement payment gateway', ['estimated_hours' => 6, 'assignee' => 'Aarav, Maya']);

        $rows = collect(app(FlagService::class)->workload())->keyBy('name');

        $this->assertEqualsWithDelta(3.0, $rows['Aarav']['category_hours']['Development'], 0.01);
        $this->assertEqualsWithDelta(3.0, $rows['Maya']['category_hours']['Development'], 0.01);
        $this->assertEqualsWithDelta(6.0, $rows->sum(fn ($r) => $r['category_hours']['Development']), 0.01);
    }

    public function test_subtasks_never_add_hours_and_follow_their_parent_under_filters(): void
    {
        $parent = $this->card('Implement payment gateway', ['estimated_hours' => 6]);
        PmSubtask::create([
            'external_id' => 'project:p1:task:'.$parent->task_id.':sub:s1',
            'project_id' => 'p1', 'project_name' => 'Salon', 'task_id' => $parent->task_id, 'subtask_id' => 's1',
            'parent_title' => $parent->title, 'title' => 'Wire up Stripe', 'assignee' => 'Aarav', 'status' => 'In Progress',
        ]);

        $flags = app(FlagService::class);
        $all = collect($flags->workload())->firstWhere('name', 'Aarav');
        $this->assertSame(2, $all['open']);        // task + sub-task, as before
        $this->assertSame(1, $all['subtasks']);
        $this->assertEqualsWithDelta(6.0, array_sum($all['category_hours']), 0.01);

        $dev = collect($flags->workload([], ['category' => 'Development']))->firstWhere('name', 'Aarav');
        $this->assertSame(2, $dev['open']);
        $qa = collect($flags->workload([], ['category' => 'QA']))->firstWhere('name', 'Aarav');
        $this->assertNull($qa, 'sub-task must follow its parent out of other categories');
    }

    public function test_workload_filters_by_business_and_category_through_the_api(): void
    {
        $this->actingAs(User::factory()->create());
        $this->card('Implement payment gateway', ['estimated_hours' => 6]);
        $this->card('Research competitor pricing', ['estimated_hours' => 5, 'project_id' => 'p2', 'project_name' => 'SiteForge']);

        $this->getJson('/pm/api/workload?project_id=p2')->assertOk()
            ->assertJsonPath('workload.0.hours', 5)
            ->assertJsonCount(2, 'projects');
        $this->getJson('/pm/api/workload?category=Development')->assertOk()
            ->assertJsonPath('workload.0.hours', 6);
        $this->getJson('/pm/api/workload?category=Nonsense')->assertStatus(422);

        // Today still carries the same rows (with the new category fields) for existing screens.
        $this->getJson('/pm/api/today')->assertOk()->assertJsonPath('workload.0.name', 'Aarav')->assertJsonStructure(['workload' => [['category_hours', 'category_week_hours']]]);
    }

    public function test_taskmandu_mirror_rows_are_not_modified_by_classification(): void
    {
        Http::fake();
        $card = $this->card('Implement payment gateway');
        $before = $card->fresh()->getAttributes();

        $this->service()->categoryFor($card);
        $this->service()->setOverride($card, 'QA');

        $this->assertSame($before, $card->fresh()->getAttributes());
        Http::assertNothingSent();
    }
}
