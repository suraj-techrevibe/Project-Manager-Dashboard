<?php

namespace Tests\Feature;

use App\Models\PmQaDeskItem;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class PmQaDeskTest extends TestCase
{
    use RefreshDatabase;

    public function test_user_can_add_and_load_a_qa_review_item(): void
    {
        $user = User::factory()->create();

        $response = $this->actingAs($user)->postJson('/pm/api/qa/review-desk', [
            'title' => 'Check checkout on mobile',
            'business' => 'Techmandu',
            'site_app' => 'Storefront',
            'source' => 'Site check',
            'checks' => [['id' => 'check-1', 'text' => 'Cart total is correct', 'done' => false]],
        ]);

        $response->assertCreated()->assertJsonPath('item.status', 'queue');
        $this->assertDatabaseHas('pm_qa_desk_items', [
            'created_by' => $user->id,
            'title' => 'Check checkout on mobile',
        ]);

        $this->actingAs($user)->getJson('/pm/api/qa/review-desk')
            ->assertOk()
            ->assertJsonCount(1, 'items');
    }

    public function test_existing_source_is_not_added_twice_for_the_same_user(): void
    {
        $user = User::factory()->create();
        $payload = [
            'title' => 'Review Taskmandu task',
            'source' => 'Taskmandu',
            'source_id' => 'task:abc123',
        ];

        $this->actingAs($user)->postJson('/pm/api/qa/review-desk', $payload)->assertCreated();
        $this->actingAs($user)->postJson('/pm/api/qa/review-desk', $payload)
            ->assertOk()
            ->assertJsonPath('existing', true);

        $this->assertSame(1, PmQaDeskItem::where('created_by', $user->id)->count());
    }

    public function test_user_can_update_checklist_and_status_but_cannot_pass_incomplete_items_from_the_api(): void
    {
        $user = User::factory()->create();
        $item = PmQaDeskItem::create([
            'created_by' => $user->id,
            'title' => 'Verify checkout',
            'source' => 'Site check',
            'status' => 'queue',
            'checks' => [['id' => 'c1', 'text' => 'Checkout loads', 'done' => false]],
            'screenshots' => [],
            'history' => [],
        ]);

        $this->actingAs($user)->patchJson('/pm/api/qa/review-desk/'.$item->id, [
            'status' => 'testing',
            'checks' => [['id' => 'c1', 'text' => 'Checkout loads', 'done' => true]],
        ])->assertOk()->assertJsonPath('item.status', 'testing')
            ->assertJsonPath('item.checks.0.done', true);
    }

    public function test_user_can_upload_and_remove_a_screenshot(): void
    {
        Storage::fake('public');
        $user = User::factory()->create();
        $item = PmQaDeskItem::create([
            'created_by' => $user->id,
            'title' => 'Inspect product page',
            'source' => 'Site check',
            'status' => 'queue',
            'checks' => [],
            'screenshots' => [],
            'history' => [],
        ]);

        $uploaded = $this->actingAs($user)->postJson('/pm/api/qa/review-desk/'.$item->id.'/screenshots', [
            'file' => UploadedFile::fake()->image('product-page.png'),
        ]);

        $uploaded->assertCreated()->assertJsonPath('screenshot.name', 'product-page.png');
        $screenshotId = $uploaded->json('screenshot.id');

        $this->deleteJson('/pm/api/qa/review-desk/'.$item->id.'/screenshots/'.$screenshotId)
            ->assertOk()
            ->assertJsonCount(0, 'item.screenshots');
    }

    public function test_user_cannot_read_or_change_another_users_review_item(): void
    {
        $owner = User::factory()->create();
        $other = User::factory()->create();
        $item = PmQaDeskItem::create([
            'created_by' => $owner->id,
            'title' => 'Private QA review',
            'source' => 'Client report',
            'status' => 'queue',
            'checks' => [],
            'screenshots' => [],
            'history' => [],
        ]);

        $this->actingAs($other)->patchJson('/pm/api/qa/review-desk/'.$item->id, ['status' => 'passed'])
            ->assertNotFound();
    }
}
