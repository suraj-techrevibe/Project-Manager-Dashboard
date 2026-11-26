<?php

namespace Tests\Feature;

use App\Models\PmBusiness;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class PmOperationWorkspaceTest extends TestCase
{
    use RefreshDatabase;

    public function test_goal_records_support_business_links_and_automatic_or_manual_priority(): void
    {
        Http::fake();
        $user = User::factory()->create();
        $business = PmBusiness::create(['name' => 'Techmandu', 'slug' => 'techmandu', 'status' => 'active']);

        $this->actingAs($user)->postJson('/pm/api/operation/goals', [
            'business_id' => $business->id,
            'title' => 'Launch the new storefront',
            'goal_type' => 'launch',
            'target_date' => now()->addDays(2)->toDateString(),
            'priority' => 'auto',
            'status' => 'active',
        ])->assertCreated()
            ->assertJsonPath('goal.business.name', 'Techmandu')
            ->assertJsonPath('goal.effective_priority', 'high');

        $goal = \App\Models\PmOperationGoal::firstOrFail();
        $this->patchJson('/pm/api/operation/goals/'.$goal->id, ['priority' => 'low'])
            ->assertOk()
            ->assertJsonPath('goal.effective_priority', 'low');

        $this->assertDatabaseHas('pm_operation_goals', ['id' => $goal->id, 'priority' => 'low']);
        Http::assertNothingSent();
    }

    public function test_plan_submission_feedback_and_revision_history_are_recorded_without_taskmandu_writes(): void
    {
        Http::fake();
        $user = User::factory()->create();
        $business = PmBusiness::create(['name' => 'AdEvent', 'slug' => 'adevent', 'status' => 'active']);

        $planId = $this->actingAs($user)->postJson('/pm/api/operation/plans', [
            'business_id' => $business->id,
            'title' => 'Event launch plan',
            'objective' => 'Launch the event website',
            'proposed_tasks' => [[
                'title' => 'Prepare event landing page',
                'responsible' => 'Web team',
                'due_date' => now()->addDays(10)->toDateString(),
                'priority' => 'high',
            ]],
            'timeline' => [['milestone' => 'Website ready', 'date' => now()->addDays(8)->toDateString()]],
        ])->assertCreated()
            ->assertJsonPath('plan.status', 'draft')
            ->assertJsonCount(1, 'plan.proposed_tasks')
            ->json('plan.id');

        $this->postJson('/pm/api/operation/plans/'.$planId.'/transition', [
            'status' => 'submitted_for_approval',
            'change_reason' => 'Initial boss review',
        ])->assertOk()->assertJsonPath('plan.status', 'submitted_for_approval')
            ->assertJsonPath('plan.revision_count', 1);

        $this->postJson('/pm/api/operation/plans/'.$planId.'/transition', [
            'status' => 'changes_requested',
            'boss_feedback' => 'Add a marketing launch sequence.',
        ])->assertOk()->assertJsonPath('plan.boss_comments', 'Add a marketing launch sequence.');

        $this->patchJson('/pm/api/operation/plans/'.$planId, [
            'proposed_approach' => 'Add a staged marketing launch sequence.',
        ])->assertOk()->assertJsonPath('plan.proposed_approach', 'Add a staged marketing launch sequence.')
            ->assertJsonPath('plan.revision_count', 2);

        $this->postJson('/pm/api/operation/plans/'.$planId.'/transition', [
            'status' => 'submitted_for_approval',
        ])->assertOk()->assertJsonPath('plan.status', 'submitted_for_approval')
            ->assertJsonPath('plan.revision_count', 3);

        $this->postJson('/pm/api/operation/plans/'.$planId.'/transition', [
            'status' => 'approved',
            'approval_notes' => 'Approved by boss.',
        ])->assertOk()->assertJsonPath('plan.status', 'approved');

        Http::assertNothingSent();
    }

    public function test_plan_status_transitions_reject_invalid_changes(): void
    {
        $user = User::factory()->create();
        $planId = $this->actingAs($user)->postJson('/pm/api/operation/plans', [
            'title' => 'Independent proposal',
        ])->assertCreated()->json('plan.id');

        $this->postJson('/pm/api/operation/plans/'.$planId.'/transition', [
            'status' => 'approved',
        ])->assertUnprocessable();

        $this->assertDatabaseHas('pm_operation_plans', ['id' => $planId, 'status' => 'draft']);
    }
}
