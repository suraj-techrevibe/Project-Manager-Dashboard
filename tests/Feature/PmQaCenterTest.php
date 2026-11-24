<?php

namespace Tests\Feature;

use App\Models\PmBusiness;
use App\Models\PmCard;
use App\Models\PmSubtask;
use App\Models\PmQaIssue;
use App\Models\PmQaTaskReview;
use App\Models\PmQaWebsite;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/** QA Center tab: per-business QA codes, the Queue -> Testing -> Failed/Passed pipeline, checklists and screenshots. */
class PmQaCenterTest extends TestCase
{
    use RefreshDatabase;

    private function site(User $user, string $business, string $name, array $extra = []): PmQaWebsite
    {
        PmBusiness::firstOrCreate(['name' => $business], ['slug' => str($business)->slug()->toString()]);

        return PmQaWebsite::create($extra + [
            'created_by' => $user->id, 'business' => $business, 'name' => $name,
            'url' => 'https://'.str($name)->slug().'.example.com', 'website_type' => 'Business website', 'frequency' => 'Manual',
        ]);
    }

    private function newItem(User $user, string $site, array $extra = [])
    {
        return $this->actingAs($user)->postJson('/pm/api/qa-center/items', $extra + ['title' => 'Check checkout', 'site' => $site]);
    }

    private function review(array $extra = []): PmQaTaskReview
    {
        return PmQaTaskReview::create($extra + [
            'external_id' => 'task:'.uniqid(), 'task_id' => uniqid('t'), 'task_title' => 'Fix booking calendar',
            'task_status' => 'Completed', 'trigger_status' => 'Completed', 'triggered_at' => now(),
        ]);
    }

    public function test_qa_codes_count_up_separately_for_each_business(): void
    {
        $user = User::factory()->create();
        $this->site($user, 'RB Hair & Beauty', 'Salon');
        $this->site($user, 'EventTickets', 'Tickets');

        $this->newItem($user, 'Salon')->assertCreated()->assertJsonPath('item.code', 'RHB-QA1');
        $this->newItem($user, 'Salon')->assertCreated()->assertJsonPath('item.code', 'RHB-QA2');
        // A different business starts its own sequence and never shares numbers with the first.
        $this->newItem($user, 'Tickets')->assertCreated()->assertJsonPath('item.code', 'EVE-QA1');

        // Taskmandu task reviews draw from the same per-business counter as site checks.
        $review = $this->review(['business' => 'RB Hair & Beauty']);
        $this->assertSame('RHB-QA3', $review->fresh()->qa_code);
    }

    public function test_a_code_is_never_reused_after_an_item_is_deleted(): void
    {
        $user = User::factory()->create();
        $this->site($user, 'EventTickets', 'Tickets');

        $first = $this->newItem($user, 'Tickets')->json('item');
        $this->actingAs($user)->deleteJson('/pm/api/qa-center/items/issue/'.$first['id'])->assertOk();

        $this->newItem($user, 'Tickets')->assertJsonPath('item.code', 'EVE-QA2');
    }

    public function test_new_item_has_url_default_checks_and_starts_in_the_queue(): void
    {
        $user = User::factory()->create();
        $this->site($user, 'EventTickets', 'Tickets', ['url' => 'https://tickets.example.com']);

        $this->newItem($user, 'Tickets', ['url' => 'tickets.example.com/checkout'])
            ->assertCreated()
            ->assertJsonPath('item.stage', 'Queue')
            ->assertJsonPath('item.source', 'Site check')
            ->assertJsonPath('item.url', 'https://tickets.example.com/checkout')
            ->assertJsonPath('item.business', 'EventTickets')
            ->assertJsonCount(2, 'item.checks');

        // No URL given: falls back to the registered site's address.
        $this->newItem($user, 'Tickets')->assertJsonPath('item.url', 'https://tickets.example.com');
    }

    public function test_page_url_is_required_when_the_site_is_not_registered(): void
    {
        $user = User::factory()->create();

        $this->actingAs($user)->postJson('/pm/api/qa-center/items', ['title' => 'Check footer', 'business' => 'Acme', 'site' => 'Old site'])
            ->assertStatus(422)
            ->assertJsonPath('message', 'Enter the page URL so the developer can open it.');

        $this->actingAs($user)->postJson('/pm/api/qa-center/items', ['title' => 'Check footer', 'business' => 'Acme', 'site' => 'Old site', 'url' => 'old.example.com'])
            ->assertCreated()
            ->assertJsonPath('item.source', 'Client report');
    }

    public function test_pipeline_rules_for_a_site_check(): void
    {
        $user = User::factory()->create();
        $this->site($user, 'EventTickets', 'Tickets');
        $item = $this->newItem($user, 'Tickets', ['checks' => ['Cart total', 'Coupon applies']])->json('item');
        $url = '/pm/api/qa-center/items/issue/'.$item['id'];
        [$first, $second] = collect($item['checks'])->pluck('id')->all();

        // Can't pass with unticked checks.
        $this->actingAs($user)->patchJson($url, ['stage' => 'Passed'])
            ->assertStatus(422)->assertJsonPath('message', 'Complete every checklist item before passing.');
        // Can't fail without saying why.
        $this->patchJson($url, ['stage' => 'Failed'])
            ->assertStatus(422)->assertJsonPath('message', 'Add a failure note so the developer knows what to fix.');

        // Ticking the first check starts testing.
        $this->patchJson($url.'/checks/'.$first, ['is_done' => true])->assertOk()->assertJsonPath('item.stage', 'Testing');

        $this->patchJson($url, ['stage' => 'Failed', 'fail_note' => 'Total shows $0'])
            ->assertOk()->assertJsonPath('item.stage', 'Failed')->assertJsonPath('item.fail_note', 'Total shows $0');
        $this->assertSame('Failed', PmQaIssue::find($item['id'])->status); // older screens still see a sensible status

        // Back to the queue after a fix: ticks reset for a fresh test, the old note is cleared.
        $this->patchJson($url, ['stage' => 'Queue'])->assertOk()
            ->assertJsonPath('item.stage', 'Queue')->assertJsonPath('item.fail_note', null)
            ->assertJsonPath('item.checks.0.is_done', false);
        $this->assertSame('Ready for Retest', PmQaIssue::find($item['id'])->status);

        $this->patchJson($url.'/checks/'.$first, ['is_done' => true])->assertOk();
        $this->patchJson($url.'/checks/'.$second, ['is_done' => true])->assertOk();
        $this->patchJson($url, ['stage' => 'Passed'])->assertOk()->assertJsonPath('item.stage', 'Passed');
        $this->assertSame('Passed', PmQaIssue::find($item['id'])->status);

        // A passed item is locked until it is reopened.
        $this->patchJson($url.'/checks/'.$first, ['is_done' => false])->assertStatus(422);
        $this->patchJson($url, ['stage' => 'Failed', 'fail_note' => 'x'])->assertStatus(422);
        $this->patchJson($url, ['stage' => 'Queue'])->assertOk();
    }

    public function test_cannot_pass_an_item_that_has_no_checks(): void
    {
        $user = User::factory()->create();
        $issue = PmQaIssue::create(['created_by' => $user->id, 'title' => 'Legacy finding', 'severity' => 'Low', 'status' => 'Draft', 'business' => 'EventTickets']);

        $this->actingAs($user)->patchJson('/pm/api/qa-center/items/issue/'.$issue->id, ['stage' => 'Passed'])
            ->assertStatus(422)->assertJsonPath('message', 'Add at least one check before passing.');

        $this->postJson('/pm/api/qa-center/items/issue/'.$issue->id.'/checks', ['labels' => ['Works on desktop', 'Works on mobile']])
            ->assertCreated()->assertJsonCount(2, 'item.checks');
    }

    public function test_taskmandu_review_gets_a_code_default_checks_and_keeps_the_legacy_result_in_sync(): void
    {
        $user = User::factory()->create();
        $this->site($user, 'RB Hair & Beauty', 'Salon', ['project_id' => 'aaaaaaaaaaaaaaaaaaaaaaaa', 'project_name' => 'Salon Project']);
        $review = $this->review(['business' => 'RB Hair & Beauty', 'project_id' => 'aaaaaaaaaaaaaaaaaaaaaaaa', 'project_name' => 'Salon Project', 'assignee' => 'Ravi']);

        $item = collect($this->actingAs($user)->getJson('/pm/api/qa-center')->assertOk()->json('items'))->firstWhere('key', 'task:'.$review->id);
        $this->assertSame('RHB-QA1', $item['code']);
        $this->assertSame('Taskmandu', $item['source']);
        $this->assertSame('Salon', $item['site']); // the Taskmandu project maps to the registered site
        $this->assertTrue($item['editable']);
        $this->assertCount(3, $item['checks']);

        $url = '/pm/api/qa-center/items/task/'.$review->id;
        $this->patchJson($url, ['title' => 'Renamed', 'assignee' => 'Ravi', 'url' => 'shop.example.com/cart'])
            ->assertOk()->assertJsonPath('item.title', 'Renamed')->assertJsonPath('item.assignee', 'Ravi')->assertJsonPath('item.url', 'https://shop.example.com/cart');
        // The edit lives beside the synced Taskmandu fields, which stay as they were; clearing the assignee restores Ravi.
        $this->assertSame('Fix booking calendar', $review->fresh()->task_title);
        $this->patchJson($url, ['assignee' => ''])->assertOk()->assertJsonPath('item.assignee', 'Ravi');
        foreach ($item['checks'] as $check) {
            $this->patchJson($url.'/checks/'.$check['id'], ['is_done' => true])->assertOk();
        }
        $this->patchJson($url, ['stage' => 'Passed'])->assertOk()->assertJsonPath('item.stage', 'Passed');

        $review->refresh();
        $this->assertSame('Passed', $review->qa_status);
        $this->assertSame('Pass', $review->last_result);
        $this->assertSame($user->id, $review->tested_by);
        $this->assertSame(1, $review->cycle);
        $this->assertSame(['Pass'], $review->events->pluck('result')->all());

        // Reopening starts a new QA round with unticked checks.
        $this->patchJson($url, ['stage' => 'Queue'])->assertOk()->assertJsonPath('item.checks.0.is_done', false);
        $review->refresh();
        $this->assertSame(2, $review->cycle);
        $this->assertSame('Awaiting QA', $review->qa_status);
        $this->assertNull($review->last_result);

        $this->deleteJson($url)->assertStatus(422); // can't delete a mirror of a real task
    }

    public function test_older_screens_that_change_status_keep_the_stage_in_step(): void
    {
        $user = User::factory()->create();
        $issue = PmQaIssue::create(['created_by' => $user->id, 'title' => 'F', 'severity' => 'Low', 'status' => 'Draft', 'business' => 'Acme']);
        $this->assertSame('Queue', $issue->qa_stage);
        $this->assertSame('ACM-QA1', $issue->qa_code);

        $issue->update(['status' => 'Fixing']);
        $this->assertSame('Failed', $issue->fresh()->qa_stage);
        $issue->update(['status' => 'Passed']);
        $this->assertSame('Passed', $issue->fresh()->qa_stage);

        $review = $this->review(['business' => 'Acme']);
        $review->update(['qa_status' => 'Failed']);
        $this->assertSame('Failed', $review->fresh()->qa_stage);
    }

    public function test_other_users_cannot_touch_my_site_checks(): void
    {
        $mine = User::factory()->create();
        $other = User::factory()->create();
        $this->site($mine, 'EventTickets', 'Tickets');
        $id = $this->newItem($mine, 'Tickets')->json('item.id');

        $this->actingAs($other)->patchJson('/pm/api/qa-center/items/issue/'.$id, ['remarks' => 'hi'])->assertNotFound();
        $this->deleteJson('/pm/api/qa-center/items/issue/'.$id)->assertNotFound();
        $this->getJson('/pm/api/qa-center')->assertOk()->assertJsonCount(0, 'items');
    }

    public function test_remarks_and_assignee_can_be_edited_and_screenshots_uploaded(): void
    {
        Storage::fake('public');
        $user = User::factory()->create();
        $this->site($user, 'EventTickets', 'Tickets');
        $item = $this->newItem($user, 'Tickets')->json('item');
        $url = '/pm/api/qa-center/items/issue/'.$item['id'];

        $this->actingAs($user)->patchJson($url, ['remarks' => 'Waiting on Stripe keys', 'assignee' => 'Maya'])
            ->assertOk()->assertJsonPath('item.remarks', 'Waiting on Stripe keys')->assertJsonPath('item.assignee', 'Maya');

        $shot = $this->post($url.'/screenshots', ['file' => UploadedFile::fake()->image('shot.png')], ['Accept' => 'application/json'])
            ->assertCreated()->assertJsonCount(1, 'item.screenshots')->json('item.screenshots.0');
        Storage::disk('public')->assertExists($shot['path']);

        $this->deleteJson($url.'/screenshots/'.$shot['id'])->assertOk()->assertJsonCount(0, 'item.screenshots');
        Storage::disk('public')->assertMissing($shot['path']);
    }

    public function test_backfill_numbers_existing_records_in_creation_order_per_business(): void
    {
        $user = User::factory()->create();
        $row = fn (string $title, ?string $business, string $status, string $created) => DB::table('pm_qa_issues')->insertGetId([
            'created_by' => $user->id, 'record_type' => 'Ad-hoc', 'business' => $business, 'title' => $title,
            'severity' => 'Medium', 'status' => $status, 'description' => 'It broke', 'created_at' => $created, 'updated_at' => $created,
        ]);
        $a = $row('Old salon', 'RB Hair & Beauty', 'Reported', '2026-01-01 10:00:00');
        $b = $row('Ticket bug', 'EventTickets', 'Passed', '2026-01-02 10:00:00');
        $c = $row('Newer salon', 'RB Hair & Beauty', 'Draft', '2026-01-03 10:00:00');
        $d = $row('Mystery', null, 'Draft', '2026-01-04 10:00:00');

        (require base_path('database/migrations/2026_11_24_000001_backfill_qa_center_codes_and_stages.php'))->up();

        $get = fn ($id) => DB::table('pm_qa_issues')->find($id);
        $this->assertSame('RHB-QA1', $get($a)->qa_code);
        $this->assertSame('Failed', $get($a)->qa_stage);
        $this->assertSame('It broke', $get($a)->qa_fail_note);
        $this->assertSame('EVE-QA1', $get($b)->qa_code);
        $this->assertSame('Passed', $get($b)->qa_stage);
        $this->assertSame('RHB-QA2', $get($c)->qa_code);
        $this->assertSame('GEN-QA1', $get($d)->qa_code);

        // The counters continue where the backfill stopped, and running it again changes nothing.
        (require base_path('database/migrations/2026_11_24_000001_backfill_qa_center_codes_and_stages.php'))->up();
        $this->assertSame('RHB-QA1', $get($a)->qa_code);
        $next = PmQaIssue::create(['created_by' => $user->id, 'title' => 'New', 'severity' => 'Low', 'status' => 'Draft', 'business' => 'RB Hair & Beauty']);
        $this->assertSame('RHB-QA3', $next->qa_code);
    }

    public function test_qa_center_tab_page_loads(): void
    {
        $this->withoutVite()->actingAs(User::factory()->create())->get('/pm/qa')
            ->assertOk()->assertInertia(fn ($page) => $page->component('Pm/App')->where('page', 'qa'));
    }

    public function test_business_list_includes_businesses_used_by_sites_even_without_an_operations_record(): void
    {
        $user = User::factory()->create();
        PmQaWebsite::create(['created_by' => $user->id, 'business' => 'Tec.com', 'name' => 'Tec', 'url' => 'https://tec.com', 'website_type' => 'Business website', 'frequency' => 'Manual']);

        $this->actingAs($user)->getJson('/pm/api/qa-center')->assertOk()->assertJsonPath('businesses', ['Tec.com']);
    }

    public function test_report_snapshot_is_built_from_qa_center_items_and_can_be_edited(): void
    {
        $user = User::factory()->create();
        $this->site($user, 'RB Hair & Beauty', 'Salon');
        $key = $this->newItem($user, 'Salon', ['url' => 'https://salon.example.com/checkout'])->json('item.key');

        $res = $this->actingAs($user)->postJson('/pm/api/qa-center/reports', [
            'business' => 'RB Hair & Beauty', 'report_date' => '2026-11-24', 'summary' => 'One item.', 'item_keys' => [$key],
        ])->assertCreated()->assertJsonPath('report.findings.0.code', 'RHB-QA1')->assertJsonPath('report.findings.0.stage', 'Queue');
        $id = $res->json('report.id');

        $findings = $res->json('report.findings');
        $findings[0]['fail_note'] = 'Edited in snapshot';
        $this->actingAs($user)->patchJson('/pm/api/qa-center/reports/'.$id, ['summary' => 'Changed', 'findings' => $findings])
            ->assertOk()->assertJsonPath('report.findings.0.fail_note', 'Edited in snapshot');

        // The live item is not touched by snapshot edits.
        $this->assertNull(PmQaIssue::first()->qa_fail_note);
        $this->actingAs(User::factory()->create())->patchJson('/pm/api/qa-center/reports/'.$id, ['findings' => []])->assertNotFound();
    }

    public function test_businesses_can_be_added_renamed_and_deleted(): void
    {
        $user = User::factory()->create();
        $this->actingAs($user)->postJson('/pm/api/qa-center/businesses', ['name' => 'Tec.com'])->assertCreated();
        $this->postJson('/pm/api/qa-center/businesses', ['name' => 'tec.com'])->assertStatus(422);

        $this->site($user, 'Tec.com', 'Tec');
        $code = $this->newItem($user, 'Tec')->json('item.code');

        // In use: can't be deleted.
        $this->deleteJson('/pm/api/qa-center/businesses', ['name' => 'Tec.com'])->assertStatus(422);

        // Rename follows the sites and items; the code never changes.
        $this->patchJson('/pm/api/qa-center/businesses', ['from' => 'Tec.com', 'name' => 'Tec Group'])->assertOk();
        $this->assertSame('Tec Group', PmQaWebsite::first()->business);
        $item = $this->getJson('/pm/api/qa-center')->json('items.0');
        $this->assertSame('Tec Group', $item['business']);
        $this->assertSame($code, $item['code']);

        $this->postJson('/pm/api/qa-center/businesses', ['name' => 'Spare'])->assertCreated();
        $this->deleteJson('/pm/api/qa-center/businesses', ['name' => 'Spare'])->assertOk();
        $this->assertNotContains('Spare', $this->getJson('/pm/api/qa-center')->json('businesses'));
    }

    public function test_taskmandu_projects_import_as_businesses_and_subtasks_become_checks(): void
    {
        $user = User::factory()->create();
        PmCard::create(['external_id' => 'p1', 'title' => 'Calendar', 'status' => 'Completed', 'project_id' => 'aaaaaaaaaaaaaaaaaaaaaaaa', 'project_name' => 'Maison Eclat', 'task_id' => 't1']);
        $review = $this->review(['project_id' => 'aaaaaaaaaaaaaaaaaaaaaaaa', 'project_name' => 'Maison Eclat', 'task_id' => 't1', 'assignee' => 'Ravi, Mia']);
        foreach (['Header fix', 'Footer fix'] as $i => $t) {
            PmSubtask::create(['external_id' => 'x'.$i, 'project_id' => 'aaaaaaaaaaaaaaaaaaaaaaaa', 'project_name' => 'Maison Eclat', 'task_id' => 't1', 'subtask_id' => 's'.$i, 'parent_title' => 'Calendar', 'title' => $t]);
        }

        $this->actingAs($user)->postJson('/pm/api/qa-center/businesses/import')->assertOk()->assertJsonPath('created', 1)->assertJsonPath('linked', 1);
        $this->postJson('/pm/api/qa-center/businesses/import')->assertOk()->assertJsonPath('created', 0)->assertJsonPath('linked', 0);
        $this->assertSame('Maison Eclat', $review->fresh()->business);

        $url = '/pm/api/qa-center/items/task/'.$review->id;
        $this->postJson($url.'/subtasks')->assertOk()->assertJsonCount(5, 'item.checks');
        $this->postJson($url.'/subtasks')->assertOk()->assertJsonCount(5, 'item.checks'); // no duplicates

        $payload = $this->getJson('/pm/api/qa-center')->assertOk();
        $this->assertContains('Maison Eclat', $payload->json('businesses'));
        $this->assertEqualsCanonicalizing(['Ravi', 'Mia'], $payload->json('members'));

        $check = $this->getJson('/pm/api/qa-center')->json('items.0.checks.0.id');
        $this->patchJson($url.'/checks/'.$check, ['label' => 'Renamed check'])->assertOk();
        $this->assertSame('Renamed check', \App\Models\PmQaCheck::find($check)->label);
    }

    public function test_projects_and_subtasks_import_automatically_when_the_tab_loads(): void
    {
        $user = User::factory()->create();
        PmCard::create(['external_id' => 'p9', 'title' => 'Cart', 'status' => 'Completed', 'project_id' => 'bbbbbbbbbbbbbbbbbbbbbbbb', 'project_name' => 'Tec.com', 'task_id' => 't9']);
        $review = $this->review(['project_id' => 'bbbbbbbbbbbbbbbbbbbbbbbb', 'project_name' => 'Tec.com', 'task_id' => 't9']);
        PmSubtask::create(['external_id' => 'y1', 'project_id' => 'bbbbbbbbbbbbbbbbbbbbbbbb', 'project_name' => 'Tec.com', 'task_id' => 't9', 'subtask_id' => 's1', 'parent_title' => 'Cart', 'title' => 'Coupon field']);

        $res = $this->actingAs($user)->getJson('/pm/api/qa-center')->assertOk();
        $this->assertContains('Tec.com', $res->json('businesses'));
        $item = collect($res->json('items'))->firstWhere('key', 'task:'.$review->id);
        $this->assertSame('Tec.com', $item['business']);
        $this->assertContains('Coupon field', collect($item['checks'])->pluck('label')->all());

        // A check removed afterwards stays removed on the next load.
        $id = collect($item['checks'])->firstWhere('label', 'Coupon field')['id'];
        $this->deleteJson('/pm/api/qa-center/items/task/'.$review->id.'/checks/'.$id)->assertOk();
        $again = collect($this->getJson('/pm/api/qa-center')->json('items'))->firstWhere('key', 'task:'.$review->id);
        $this->assertNotContains('Coupon field', collect($again['checks'])->pluck('label')->all());
    }
}
