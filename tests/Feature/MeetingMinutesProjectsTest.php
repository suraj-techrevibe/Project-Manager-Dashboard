<?php

namespace Tests\Feature;

use App\Models\MeetingMinutes;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * Meeting minutes → projects: "Save as final" creates any project that isn't an existing one
 * (and links each Work Item to it); "Save draft" never touches Taskmandu.
 */
class MeetingMinutesProjectsTest extends TestCase
{
    use RefreshDatabase;

    /** @var array<int, array{_id: string, name: string}> projects "in Taskmandu" */
    private array $projects = [];

    /** @var array<int, array<string, mixed>> bodies of every POST /projects */
    private array $created = [];

    private bool $failNextCreate = false;

    private function taskmandu(array $existing = []): void
    {
        config([
            'services.taskmandu.base_url' => 'https://taskmandu.test/api',
            'services.taskmandu.email' => 'pm@example.test',
            'services.taskmandu.password' => 'secret',
        ]);
        Cache::put('taskmandu:access_token', 'test-token');

        foreach ($existing as $i => $name) {
            $this->projects[] = ['_id' => str_pad((string) ($i + 1), 24, 'a', STR_PAD_LEFT), 'name' => $name];
        }

        Http::fake(function (Request $req) {
            $path = parse_url($req->url(), PHP_URL_PATH);

            if ($req->method() === 'GET' && str_ends_with($path, '/projects')) {
                return Http::response(['success' => true, 'data' => $this->projects, 'pagination' => ['totalPages' => 1]]);
            }
            if ($req->method() === 'POST' && str_ends_with($path, '/projects')) {
                $body = $req->data();
                if ($this->failNextCreate && ($body['name'] ?? '') === 'Beta Portal') {
                    $this->failNextCreate = false;

                    return Http::response(['success' => false, 'message' => 'name already taken'], 500);
                }
                $this->created[] = $body;
                $project = ['_id' => str_pad(dechex(100 + count($this->created)), 24, 'b', STR_PAD_LEFT), 'name' => $body['name']];
                $this->projects[] = $project;

                return Http::response(['success' => true, 'data' => $project], 201);
            }

            return Http::response(['success' => false, 'message' => 'unexpected '.$req->method().' '.$path], 500);
        });
    }

    private function item(string $project, string $requirement = 'Implement customer dashboard'): array
    {
        return [
            'owner' => 'Ashim Thapa Magar',
            'project' => $project,
            'requirement' => $requirement,
            'discussion' => 'Dashboard needs sales and account reporting.',
            'due_date' => '2026-10-22',
            'action_items' => [
                ['task' => 'Create dashboard UI', 'due_date' => '2026-10-14'],
                ['task' => 'Connect reporting API', 'due_date' => '2026-10-14'],
                ['task' => 'Add export', 'due_date' => '2026-10-08'],
            ],
        ];
    }

    private function payload(string $status, array $items): array
    {
        return [
            'title' => 'daily meeting',
            'status' => $status,
            'meeting_date' => '2026-10-05',
            'attendees' => ['Suraj Shrestha', 'Ashim Thapa Magar'],
            'work_items' => $items,
        ];
    }

    private function save(string $status, array $items)
    {
        return $this->actingAs(User::factory()->create())->postJson('/pm/api/minutes', $this->payload($status, $items));
    }

    public function test_save_draft_never_touches_taskmandu(): void
    {
        $this->taskmandu(['Mobile App']);

        $res = $this->save('draft', [$this->item('Customer Portal')]);

        $res->assertCreated()->assertJsonPath('created_projects', []);
        Http::assertNothingSent();
        $saved = MeetingMinutes::firstOrFail()->work_items[0];
        $this->assertSame('Customer Portal', $saved['project']);
        $this->assertArrayNotHasKey('project_id', $saved);
    }

    public function test_save_as_final_creates_a_project_that_is_not_in_the_list(): void
    {
        $this->taskmandu(['Mobile App']);

        $res = $this->save('final', [$this->item('Customer Portal')]);

        $res->assertCreated()->assertJsonPath('created_projects.0.name', 'Customer Portal');
        $this->assertCount(1, $this->created);
        $this->assertSame('Customer Portal', $this->created[0]['name']);
        $this->assertStringContainsString('daily meeting', $this->created[0]['description']);
        $this->assertStringContainsString('2026-10-05', $this->created[0]['description']);

        $id = $res->json('created_projects.0.id');
        $saved = MeetingMinutes::firstOrFail();
        $this->assertSame('final', $saved->status);
        $this->assertSame($id, $saved->work_items[0]['project_id']);
        $this->assertSame('Customer Portal', $saved->work_items[0]['project']);
        $this->assertCount(3, $saved->work_items[0]['action_items']); // action items (subtasks) untouched
    }

    public function test_an_existing_project_is_linked_not_recreated_even_if_typed_differently(): void
    {
        $this->taskmandu(['Mobile App']);

        $res = $this->save('final', [$this->item('  mobile-APP ', 'Fix mobile login issues')]);

        $res->assertCreated()->assertJsonPath('created_projects', []);
        $this->assertSame([], $this->created);
        $saved = MeetingMinutes::firstOrFail()->work_items[0];
        $this->assertSame('Mobile App', $saved['project']);            // canonical name from Taskmandu
        $this->assertSame($this->projects[0]['_id'], $saved['project_id']);
    }

    public function test_the_same_new_project_on_two_work_items_is_created_once(): void
    {
        $this->taskmandu();

        $res = $this->save('final', [$this->item('Customer Portal'), $this->item('customer portal', 'Add billing page')]);

        $res->assertCreated();
        $this->assertCount(1, $this->created);
        $items = MeetingMinutes::firstOrFail()->work_items;
        $this->assertSame($items[0]['project_id'], $items[1]['project_id']);
    }

    public function test_your_two_work_items_one_existing_one_new(): void
    {
        $this->taskmandu(['Mobile App']);

        $res = $this->save('final', [
            $this->item('Customer Portal'),
            $this->item('Mobile App', 'Fix mobile login issues'),
        ]);

        $res->assertCreated();
        $this->assertCount(1, $this->created);
        $this->assertSame(['Customer Portal'], array_column($res->json('created_projects'), 'name'));
        $items = MeetingMinutes::firstOrFail()->work_items;
        $this->assertNotSame($items[0]['project_id'], $items[1]['project_id']);
    }

    public function test_work_items_without_a_project_need_no_taskmandu_at_all(): void
    {
        $this->taskmandu();

        $this->save('final', [$this->item('')])->assertCreated()->assertJsonPath('created_projects', []);

        Http::assertNothingSent();
    }

    public function test_a_failed_creation_saves_nothing_and_says_why(): void
    {
        $this->taskmandu();
        $this->failNextCreate = true;

        $res = $this->save('final', [$this->item('Beta Portal')]);

        $res->assertStatus(422);
        $this->assertStringContainsString('Beta Portal', $res->json('error'));
        $this->assertStringContainsString('name already taken', $res->json('error'));
        $this->assertStringContainsString('not saved as final', $res->json('error'));
        $this->assertSame(0, MeetingMinutes::count());
    }

    public function test_a_retry_after_a_partial_failure_does_not_duplicate_the_first_project(): void
    {
        $this->taskmandu();
        $this->failNextCreate = true;
        $items = [$this->item('Alpha Portal'), $this->item('Beta Portal', 'Another thing')];

        $this->save('final', $items)->assertStatus(422);
        $this->assertSame(['Alpha Portal'], array_column($this->created, 'name')); // Alpha made it, Beta failed
        $this->assertSame(0, MeetingMinutes::count());

        $this->save('final', $items)->assertCreated();
        $this->assertSame(['Alpha Portal', 'Beta Portal'], array_column($this->created, 'name'));
        $this->assertSame(1, MeetingMinutes::count());
    }

    public function test_final_is_refused_when_taskmandu_is_not_configured_but_a_draft_still_saves(): void
    {
        $user = User::factory()->create();

        $res = $this->actingAs($user)->postJson('/pm/api/minutes', $this->payload('final', [$this->item('Customer Portal')]));
        $res->assertStatus(422);
        $this->assertStringContainsString("isn't configured", $res->json('error'));
        $this->assertSame(0, MeetingMinutes::count());

        $this->actingAs($user)->postJson('/pm/api/minutes', $this->payload('draft', [$this->item('Customer Portal')]))->assertCreated();
    }

    public function test_a_name_with_no_letters_or_numbers_is_rejected(): void
    {
        $this->taskmandu();

        $this->save('final', [$this->item('---')])->assertStatus(422);
        $this->assertSame([], $this->created);
    }

    public function test_non_latin_project_names_match_instead_of_being_recreated(): void
    {
        $this->taskmandu(['मोबाइल एप']);

        $this->save('final', [$this->item('मोबाइल  एप')])->assertCreated()->assertJsonPath('created_projects', []);
        $this->assertSame([], $this->created);
    }

    public function test_draft_then_final_via_update_creates_once_and_a_later_final_edit_does_not_recreate(): void
    {
        $this->taskmandu();
        $user = User::factory()->create();

        $id = $this->actingAs($user)->postJson('/pm/api/minutes', $this->payload('draft', [$this->item('Customer Portal')]))->json('minute.id');
        $this->assertSame([], $this->created);

        $this->actingAs($user)->patchJson("/pm/api/minutes/{$id}", $this->payload('final', [$this->item('Customer Portal')]))
            ->assertOk()->assertJsonPath('created_projects.0.name', 'Customer Portal');
        $this->assertCount(1, $this->created);
        $this->assertSame('final', MeetingMinutes::findOrFail($id)->status);

        $this->actingAs($user)->patchJson("/pm/api/minutes/{$id}", $this->payload('final', [$this->item('Customer Portal', 'Edited requirement')]))
            ->assertOk()->assertJsonPath('created_projects', []);
        $this->assertCount(1, $this->created);
    }

    public function test_saving_a_final_back_as_draft_drops_the_project_link(): void
    {
        $this->taskmandu();
        $user = User::factory()->create();

        $id = $this->actingAs($user)->postJson('/pm/api/minutes', $this->payload('final', [$this->item('Customer Portal')]))->json('minute.id');
        $this->assertArrayHasKey('project_id', MeetingMinutes::findOrFail($id)->work_items[0]);

        // The user renames the project while re-drafting: the old id must not stick to the new name.
        $this->actingAs($user)->patchJson("/pm/api/minutes/{$id}", $this->payload('draft', [$this->item('Customer Portal v2')]))->assertOk();

        $saved = MeetingMinutes::findOrFail($id);
        $this->assertSame('draft', $saved->status);
        $this->assertArrayNotHasKey('project_id', $saved->work_items[0]);
        $this->assertSame('Customer Portal v2', $saved->work_items[0]['project']);
    }

    public function test_the_old_flat_minutes_without_work_items_still_save_as_final(): void
    {
        $this->actingAs(User::factory()->create())->postJson('/pm/api/minutes', [
            'title' => 'old style', 'status' => 'final', 'meeting_date' => '2026-10-05',
        ])->assertCreated();
        Http::assertNothingSent();
    }
}
