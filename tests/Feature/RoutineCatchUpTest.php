<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class RoutineCatchUpTest extends TestCase
{
    use RefreshDatabase;

    public function test_routine_is_saved_per_user_and_returned_with_history(): void
    {
        $user = User::factory()->create();

        $this->actingAs($user)->putJson('/pm/api/routine', [
            'ticks' => ['sync' => true, 'priorities' => true, 'unknown_step' => true],
            'priorities' => ['Launch QA', 'Review vendor payout'],
        ])->assertOk()
            ->assertJsonPath('day.ticks.sync', true)
            ->assertJsonMissingPath('day.ticks.unknown_step')
            ->assertJsonPath('day.priorities.0', 'Launch QA');

        $this->actingAs($user)->getJson('/pm/api/routine')
            ->assertOk()
            ->assertJsonPath('day.ticks.sync', true)
            ->assertJsonPath('day.priorities.1', 'Review vendor payout');
    }

    public function test_catch_up_rejects_today_and_invalid_dates(): void
    {
        $user = User::factory()->create();

        $today = now(config('pm.routine.timezone', 'Australia/Sydney'))->toDateString();
        $this->actingAs($user)->postJson('/pm/api/routine/'.$today.'/catch-up', [
            'ticks' => ['sync' => true],
        ])->assertStatus(422);

        $this->actingAs($user)->postJson('/pm/api/routine/not-a-date/catch-up', [
            'ticks' => ['sync' => true],
        ])->assertStatus(404);
    }

    public function test_day_off_is_recorded_without_being_counted_as_complete(): void
    {
        $user = User::factory()->create();

        $this->actingAs($user)->putJson('/pm/api/routine', ['skipped' => true])
            ->assertOk()
            ->assertJsonPath('day.skipped', true)
            ->assertJsonPath('day.complete', false);
    }
}
