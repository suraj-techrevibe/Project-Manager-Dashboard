<?php

namespace Tests\Feature;

use App\Models\PmBusiness;
use App\Models\PmBusinessProjectLink;
use App\Models\PmIntake;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class PmOperationsTest extends TestCase
{
    use RefreshDatabase;

    public function test_operations_tab_is_available_to_authenticated_users(): void
    {
        $this->get('/pm/operations')->assertRedirect('/login');

        $this->withoutVite()
            ->actingAs(User::factory()->create())
            ->get('/pm/operations')
            ->assertOk()
            ->assertInertia(fn ($page) => $page->component('Pm/App')->where('page', 'operations'));
    }

    public function test_businesses_can_be_created_and_linked_to_existing_taskmandu_projects_without_creating_projects(): void
    {
        Http::fake();
        $user = User::factory()->create();

        $business = $this->actingAs($user)
            ->postJson('/pm/api/businesses', [
                'name' => 'AdEvent',
                'description' => 'Events and entertainment',
            ])
            ->assertCreated()
            ->assertJsonPath('business.name', 'AdEvent')
            ->assertJsonPath('business.slug', 'adevent')
            ->json('business');

        $projectId = str_repeat('a', 24);
        $payload = [
            'project_id' => $projectId,
            'project_name' => 'AdEvent Website',
            'is_primary' => true,
        ];

        $this->postJson('/pm/api/businesses/'.$business['id'].'/projects', $payload)
            ->assertOk()
            ->assertJsonPath('project_link.project_id', $projectId)
            ->assertJsonPath('project_link.is_primary', true);

        // Repeating a link updates the existing association instead of duplicating it.
        $this->postJson('/pm/api/businesses/'.$business['id'].'/projects', $payload)->assertOk();

        $this->assertSame(1, PmBusiness::count());
        $this->assertSame(1, PmBusinessProjectLink::count());
        $this->assertDatabaseHas('pm_business_project_links', [
            'business_id' => $business['id'],
            'taskmandu_project_id' => $projectId,
            'taskmandu_project_name' => 'AdEvent Website',
        ]);

        $this->getJson('/pm/api/businesses')
            ->assertOk()
            ->assertJsonPath('businesses.0.project_links.0.project_id', $projectId);

        Http::assertNothingSent();
    }

    public function test_requests_and_ideas_start_in_separate_local_lifecycles(): void
    {
        Http::fake();
        $user = User::factory()->create();
        $business = PmBusiness::create([
            'name' => 'Techmandu',
            'slug' => 'techmandu',
            'status' => 'active',
        ]);

        $requestId = $this->actingAs($user)->postJson('/pm/api/intakes', [
            'kind' => 'request',
            'business_id' => $business->id,
            'title' => 'Add order tracking',
            'description' => 'Customers should see delivery progress.',
            'source_type' => 'boss',
            'source_name' => 'Management',
            'priority' => 'high',
        ])->assertCreated()
            ->assertJsonPath('intake.status', 'received')
            ->assertJsonPath('intake.business.name', 'Techmandu')
            ->json('intake.id');

        $ideaId = $this->postJson('/pm/api/intakes', [
            'kind' => 'idea',
            'title' => 'Customer rewards programme',
        ])->assertCreated()
            ->assertJsonPath('intake.status', 'captured')
            ->json('intake.id');

        $this->getJson('/pm/api/intakes?kind=request')
            ->assertOk()
            ->assertJsonCount(1, 'intakes')
            ->assertJsonPath('intakes.0.id', $requestId);

        $this->getJson('/pm/api/intakes?kind=idea')
            ->assertOk()
            ->assertJsonCount(1, 'intakes')
            ->assertJsonPath('intakes.0.id', $ideaId);

        $this->assertSame(2, PmIntake::count());
        Http::assertNothingSent();
    }

    public function test_items_must_be_approved_or_accepted_before_marking_them_planned(): void
    {
        $user = User::factory()->create();

        $requestId = $this->actingAs($user)->postJson('/pm/api/intakes', [
            'kind' => 'request',
            'title' => 'New checkout option',
        ])->assertCreated()->json('intake.id');

        $this->patchJson('/pm/api/intakes/'.$requestId, ['status' => 'planned'])
            ->assertUnprocessable();

        $this->patchJson('/pm/api/intakes/'.$requestId, [
            'clarification' => 'Confirm which delivery events should be visible.',
            'decision_notes' => 'Approved for planning by management.',
        ])
            ->assertOk()
            ->assertJsonPath('intake.clarification', 'Confirm which delivery events should be visible.')
            ->assertJsonPath('intake.decision_notes', 'Approved for planning by management.');

        $this->patchJson('/pm/api/intakes/'.$requestId, ['status' => 'approved'])
            ->assertOk()
            ->assertJsonPath('intake.status', 'approved');

        $this->patchJson('/pm/api/intakes/'.$requestId, ['status' => 'planned'])
            ->assertOk()
            ->assertJsonPath('intake.status', 'planned');

        $ideaId = $this->postJson('/pm/api/intakes', [
            'kind' => 'idea',
            'title' => 'Loyalty points',
        ])->assertCreated()->json('intake.id');

        $this->patchJson('/pm/api/intakes/'.$ideaId, ['status' => 'approved'])
            ->assertUnprocessable();

        $this->patchJson('/pm/api/intakes/'.$ideaId, ['status' => 'accepted'])
            ->assertOk()
            ->assertJsonPath('intake.status', 'accepted');
    }

    public function test_invalid_taskmandu_project_identifiers_are_rejected_for_business_links(): void
    {
        $user = User::factory()->create();
        $business = PmBusiness::create([
            'name' => 'AdExpress',
            'slug' => 'adexpress',
            'status' => 'active',
        ]);

        $this->actingAs($user)
            ->postJson('/pm/api/businesses/'.$business->id.'/projects', [
                'project_id' => 'not-a-taskmandu-id',
                'project_name' => 'Wrong project',
            ])
            ->assertUnprocessable();

        $this->assertSame(0, PmBusinessProjectLink::count());
    }

    public function test_today_includes_real_business_and_intake_attention_without_counting_closed_items(): void
    {
        $business = PmBusiness::create([
            'name' => 'Techmandu',
            'slug' => 'techmandu',
            'status' => 'active',
        ]);

        PmIntake::create([
            'business_id' => $business->id,
            'kind' => 'request',
            'status' => 'received',
            'priority' => 'high',
            'title' => 'Checkout issue',
            'requested_due_at' => now()->subDay()->toDateString(),
        ]);

        PmIntake::create([
            'business_id' => $business->id,
            'kind' => 'request',
            'status' => 'in_review',
            'priority' => 'medium',
            'title' => 'Bulk order request',
        ]);

        PmIntake::create([
            'business_id' => $business->id,
            'kind' => 'idea',
            'status' => 'under_review',
            'priority' => 'low',
            'title' => 'Loyalty programme',
        ]);

        PmIntake::create([
            'business_id' => $business->id,
            'kind' => 'request',
            'status' => 'deferred',
            'priority' => 'low',
            'title' => 'Old deferred request',
        ]);

        $this->actingAs(User::factory()->create())
            ->getJson('/pm/api/today')
            ->assertOk()
            ->assertJsonPath('operations_summary.counts.businesses', 1)
            ->assertJsonPath('operations_summary.counts.active_businesses', 1)
            ->assertJsonPath('operations_summary.counts.open_requests', 2)
            ->assertJsonPath('operations_summary.counts.requests_for_decision', 1)
            ->assertJsonPath('operations_summary.counts.ideas_for_review', 1)
            ->assertJsonPath('operations_summary.counts.overdue_requests', 1)
            ->assertJsonCount(3, 'operations_summary.recent_items');
    }


}
