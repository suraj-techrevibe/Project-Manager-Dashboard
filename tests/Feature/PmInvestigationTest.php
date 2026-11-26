<?php

namespace Tests\Feature;

use App\Models\PmCard;
use App\Models\PmInvestigation;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class PmInvestigationTest extends TestCase
{
    use RefreshDatabase;

    private int $n = 0;

    private function card(string $project, string $name, string $assignee, string $status = 'In Progress'): PmCard
    {
        $this->n++;

        return PmCard::create([
            'external_id' => "project:{$project}:task:t{$this->n}", 'project_id' => $project, 'project_name' => $name, 'task_id' => "t{$this->n}",
            'title' => 'Some task', 'assignee' => $assignee, 'status' => $status, 'estimated_hours' => 4,
        ]);
    }

    private function seedData(): void
    {
        $this->card('a'.str_repeat('0', 23), 'Salon Site', 'Aarav');
        $this->card('b'.str_repeat('0', 23), 'Events App', 'Bina');
    }

    private const P1 = 'a00000000000000000000000';
    private const P2 = 'b00000000000000000000000';

    private function assign(array $over = []): int
    {
        return $this->postJson('/pm/api/investigations', [
            'project_id' => self::P1, 'developer_name' => 'Aarav', 'due_date' => now()->addDays(7)->format('Y-m-d'), 'priority' => 'high', 'scope' => 'Checkout', ...$over,
        ])->assertCreated()->json('investigation.id');
    }

    public function test_requires_login(): void
    {
        $this->getJson('/pm/api/investigations')->assertUnauthorized();
        $this->getJson('/pm/api/investigations/options')->assertUnauthorized();
    }

    public function test_options_come_from_existing_projects_and_developers(): void
    {
        Http::fake();
        $this->seedData();
        $this->actingAs(User::factory()->create());

        $o = $this->getJson('/pm/api/investigations/options')->assertOk();
        $o->assertJsonFragment(['id' => self::P1, 'name' => 'Salon Site']);
        $this->assertSame(['Aarav', 'Bina'], collect($o->json('developers'))->pluck('name')->all());
        $this->assertCount(11, $o->json('default_checklist'));
        Http::assertNothingSent();
    }

    public function test_assignment_validation(): void
    {
        $this->seedData();
        $this->actingAs(User::factory()->create());

        $this->postJson('/pm/api/investigations', ['developer_name' => 'Aarav'])->assertStatus(422);
        $this->postJson('/pm/api/investigations', ['project_id' => 'f'.str_repeat('0', 23), 'developer_name' => 'Aarav'])->assertStatus(422)->assertJsonValidationErrors('project_id');
        $this->postJson('/pm/api/investigations', ['project_id' => self::P1, 'developer_name' => 'Nobody'])->assertStatus(422)->assertJsonValidationErrors('developer_name');
        $this->postJson('/pm/api/investigations', ['project_id' => self::P1, 'developer_name' => 'Aarav', 'priority' => 'asap'])->assertStatus(422);
        $this->postJson('/pm/api/investigations', ['project_id' => self::P1, 'developer_name' => 'Aarav', 'assigned_on' => '2026-05-10', 'due_date' => '2026-05-01'])->assertStatus(422);

        $id = $this->assign();
        $inv = PmInvestigation::find($id);
        $this->assertSame('not_started', $inv->status);
        $this->assertSame('Salon Site', $inv->project_name);
        $this->assertCount(11, $inv->checklist);
        $this->assertSame(1, $inv->events()->count());
    }

    public function test_custom_checklist_and_edit_and_reassign_history(): void
    {
        $this->seedData();
        $this->actingAs(User::factory()->create());
        $id = $this->assign(['checklist' => [['label' => 'Only this']]]);
        $this->assertCount(1, PmInvestigation::find($id)->checklist);

        $this->patchJson("/pm/api/investigations/{$id}", ['priority' => 'urgent', 'scope' => 'Everything'])->assertOk()->assertJsonPath('investigation.priority', 'urgent');
        $this->patchJson("/pm/api/investigations/{$id}", ['developer_name' => 'Bina'])->assertStatus(422); // must use reassign
        $this->postJson("/pm/api/investigations/{$id}/reassign", ['developer_name' => 'Aarav'])->assertStatus(422);
        $this->postJson("/pm/api/investigations/{$id}/reassign", ['developer_name' => 'Bina', 'note' => 'Aarav is busy'])->assertOk()->assertJsonPath('investigation.developer_name', 'Bina');

        $events = collect($this->getJson("/pm/api/investigations/{$id}")->json('investigation.events'))->pluck('event')->all();
        $this->assertEqualsCanonicalizing(['assigned', 'edited', 'reassigned'], $events);
    }

    public function test_full_lifecycle_and_locking(): void
    {
        $this->seedData();
        $this->actingAs(User::factory()->create(['name' => 'Suraj']));
        $id = $this->assign();
        $t = fn (string $a, array $x = []) => $this->postJson("/pm/api/investigations/{$id}/transition", ['action' => $a] + $x);

        $t('submit')->assertStatus(422);            // not started
        $t('review')->assertStatus(422);
        $t('start')->assertOk()->assertJsonPath('investigation.status', 'in_progress');
        $t('submit')->assertStatus(422);            // no findings yet

        $this->patchJson("/pm/api/investigations/{$id}/findings", [
            'findings' => 'Checkout fails on mobile', 'issues' => 'Bug 1', 'areas_reviewed' => 'Checkout',
            'evidence' => [['label' => 'Video', 'url' => 'https://x.test/v']],
            'followups' => [['title' => 'Fix checkout', 'effort' => '4h', 'priority' => 'high']],
        ])->assertOk()->assertJsonPath('investigation.status', 'in_progress');

        $t('submit')->assertOk()->assertJsonPath('investigation.status', 'awaiting_review');
        $inv = PmInvestigation::find($id);
        $this->assertNotNull($inv->submitted_at);
        $this->assertNotNull($inv->last_investigated_on);
        $this->assertNull($inv->completed_at); // submitting never completes

        // Findings locked once submitted.
        $this->patchJson("/pm/api/investigations/{$id}/findings", ['findings' => 'sneaky'])->assertStatus(422);

        $t('return')->assertStatus(422);            // needs comments
        $uid = $inv->followups[0]['uid'];
        $this->patchJson("/pm/api/investigations/{$id}/review", ['review_comments' => 'Looks right', 'followups' => [['uid' => $uid, 'convert' => true, 'reference' => 'TM-12']]])
            ->assertOk()->assertJsonPath('investigation.followups.0.convert', true);

        $t('return', ['comments' => 'Also check the admin area'])->assertOk()->assertJsonPath('investigation.status', 'returned');
        $this->patchJson("/pm/api/investigations/{$id}/findings", ['notes' => 'more work'])->assertOk();   // editable again
        $this->assertTrue(PmInvestigation::find($id)->followups[0]['convert']);                              // reviewer flag kept
        $t('start')->assertOk();
        $t('submit')->assertOk();
        $t('review')->assertOk()->assertJsonPath('investigation.status', 'reviewed');
        $t('close')->assertOk()->assertJsonPath('investigation.status', 'completed');
        $this->assertNotNull(PmInvestigation::find($id)->completed_at);

        $this->patchJson("/pm/api/investigations/{$id}", ['priority' => 'low'])->assertStatus(422); // closed
        $t('reopen')->assertOk()->assertJsonPath('investigation.status', 'returned');
    }

    public function test_list_filters_search_pagination_and_summary(): void
    {
        $this->seedData();
        $this->actingAs(User::factory()->create());
        $a = $this->assign();
        $b = $this->assign(['project_id' => self::P2, 'developer_name' => 'Bina', 'priority' => 'low', 'scope' => 'Booking flow']);
        $this->postJson("/pm/api/investigations/{$b}/transition", ['action' => 'start']);

        $r = $this->getJson('/pm/api/investigations')->assertOk();
        $this->assertSame(2, $r->json('meta.total'));
        $this->assertSame(2, $r->json('summary.active'));
        $this->assertSame(1, $r->json('summary.not_started'));
        $this->assertSame(1, $r->json('summary.in_progress'));
        $this->assertSame(0, $r->json('summary.completed_this_week'));

        $this->getJson('/pm/api/investigations?developer=Bina')->assertJsonCount(1, 'investigations');
        $this->getJson('/pm/api/investigations?project_id='.self::P1)->assertJsonPath('investigations.0.id', $a);
        $this->getJson('/pm/api/investigations?status=in_progress')->assertJsonCount(1, 'investigations');
        $this->getJson('/pm/api/investigations?priority=low')->assertJsonCount(1, 'investigations');
        $this->getJson('/pm/api/investigations?search=booking')->assertJsonCount(1, 'investigations');
        $this->getJson('/pm/api/investigations?date_from='.Carbon::parse(app(\App\Services\Pm\Investigation\InvestigationDates::class)->today())->addDay()->format('Y-m-d'))->assertJsonCount(0, 'investigations');
        $this->getJson('/pm/api/investigations?per_page=5&page=2')->assertJsonCount(0, 'investigations');
    }

    public function test_coverage_rotation_and_due_for_review(): void
    {
        $this->seedData();
        $this->actingAs(User::factory()->create());

        $cov = $this->getJson('/pm/api/investigations/coverage')->assertOk();
        $this->assertSame(2, $cov->json('needing'));        // never investigated

        $id = $this->assign();
        $this->postJson("/pm/api/investigations/{$id}/transition", ['action' => 'start']);
        $this->patchJson("/pm/api/investigations/{$id}/findings", ['findings' => 'Done']);
        $this->postJson("/pm/api/investigations/{$id}/transition", ['action' => 'submit']);

        $rows = collect($this->getJson('/pm/api/investigations/coverage')->json('rows'))->keyBy('project_id');
        $this->assertSame('Aarav', $rows[self::P1]['last_investigator']);
        $this->assertSame(1, $rows[self::P1]['investigated_count']);
        $this->assertFalse($rows[self::P1]['due_for_review']);          // just done and still active
        $this->assertTrue($rows[self::P2]['due_for_review']);

        // Old investigation becomes due again once closed and past the interval.
        PmInvestigation::find($id)->update(['status' => 'completed', 'last_investigated_on' => Carbon::now()->subDays(120)->format('Y-m-d')]);
        $rows = collect($this->getJson('/pm/api/investigations/coverage')->json('rows'))->keyBy('project_id');
        $this->assertTrue($rows[self::P1]['due_for_review']);
        $this->assertSame(2, $this->getJson('/pm/api/investigations')->json('summary.projects_needing'));
        $this->assertSame(1, $rows[self::P1]['investigated_count']); // history kept
    }

    public function test_workload_unchanged_and_not_double_counted(): void
    {
        $this->seedData();
        $this->actingAs(User::factory()->create());
        $before = $this->getJson('/pm/api/workload')->assertOk()->json('workload');

        $this->assign();
        $this->assertSame($before, $this->getJson('/pm/api/workload')->json('workload'));

        $d = collect($this->getJson('/pm/api/investigations/by-developer')->json('developers'))->firstWhere('name', 'Aarav');
        $this->assertSame(1, $d['active']);
    }

    public function test_never_touches_taskmandu(): void
    {
        Http::fake();
        $this->seedData();
        $this->actingAs(User::factory()->create());
        $id = $this->assign();
        foreach (['start'] as $a) {
            $this->postJson("/pm/api/investigations/{$id}/transition", ['action' => $a]);
        }
        $this->patchJson("/pm/api/investigations/{$id}/findings", ['findings' => 'x', 'followups' => [['title' => 'Do it']]]);
        $this->postJson("/pm/api/investigations/{$id}/transition", ['action' => 'submit']);
        Http::assertNothingSent();
    }
}
