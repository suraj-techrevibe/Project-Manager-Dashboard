<?php

namespace Tests\Feature;

use App\Models\PmActivity;
use App\Models\PmCard;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/** One real page per PM tab, the JSON API under /pm/api, and the Today "all tasks" list. */
class PmPagesTest extends TestCase
{
    use RefreshDatabase;

    private function card(string $title, ?string $who, string $status, ?int $dueInDays = 3, array $extra = []): PmCard
    {
        return PmCard::create($extra + [
            'title' => $title,
            'assignee' => $who,
            'status' => $status,
            'due_at' => $dueInDays === null ? null : now()->addDays($dueInDays)->toDateString(),
            'last_activity_at' => now(),
            'estimated_hours' => 2,
            'project_name' => 'Salon Site',
            'task_id' => uniqid('t'),
        ]);
    }

    /** @return array<string, array{0: string, 1: string}> */
    public static function pages(): array
    {
        return [
            'today' => ['/pm', 'Pm/App'],
            'projects' => ['/pm/projects', 'Pm/App'],
            'minutes' => ['/pm/minutes', 'Pm/App'],
            'brief' => ['/pm/brief', 'Pm/App'],
            'reports' => ['/pm/reports', 'Pm/App'],
            'scope' => ['/pm/scope', 'Pm/App'],
            'git' => ['/pm/git', 'Pm/App'],
        ];
    }

    /** @dataProvider pages */
    public function test_guests_are_sent_to_login(string $url, string $component): void
    {
        $this->get($url)->assertRedirect('/login');
    }

    /** @dataProvider pages */
    public function test_each_tab_is_its_own_page(string $url, string $component): void
    {
        $this->withoutVite()->actingAs(User::factory()->create())
            ->get($url)
            ->assertOk()
            ->assertInertia(fn ($page) => $page->component($component));
    }

    public function test_old_tab_links_redirect_to_the_new_page_and_keep_their_params(): void
    {
        $user = User::factory()->create();
        $id = str_repeat('a', 24);

        $this->actingAs($user)->get("/pm?tab=projects&project={$id}&ptab=tasks")
            ->assertRedirect("/pm/projects?project={$id}&ptab=tasks");

        $this->actingAs($user)->get('/pm?tab=brief')->assertRedirect('/pm/brief');
    }

    public function test_unknown_or_today_tab_param_still_shows_today(): void
    {
        $user = User::factory()->create();

        foreach (['today', 'nonsense', 'automation'] as $tab) {
            $this->withoutVite()->actingAs($user)->get('/pm?tab='.$tab)
                ->assertOk()
                ->assertInertia(fn ($page) => $page->component('Pm/App'));
        }
    }

    public function test_json_api_lives_under_pm_api_not_pm(): void
    {
        $user = User::factory()->create();

        $this->actingAs($user)->getJson('/pm/api/today')->assertOk()->assertJsonStructure(['flags', 'tasks', 'metrics']);

        // The old URL is gone — /pm/today is not a page and not the API any more.
        $this->actingAs($user)->getJson('/pm/today')->assertNotFound();
    }

    public function test_today_lists_every_task_flagged_or_not_but_not_cancelled_ones(): void
    {
        $this->card('Late thing', 'Ashim', 'In Progress', -4);   // flagged: overdue
        $this->card('Healthy thing', 'Ashim', 'In Progress', 9); // not flagged
        $this->card('Done thing', 'Priya', 'Completed', -2, ['verified' => true]); // not flagged
        $this->card('Dead thing', 'Ashim', 'Cancelled', -9);     // never listed

        $res = $this->withoutVite()->actingAs(User::factory()->create())->get('/pm');

        $res->assertInertia(fn ($page) => $page
            ->component('Pm/App')
            ->has('flags', 1)
            ->where('flags.0.title', 'Late thing')
            ->has('tasks', 3));

        $titles = collect($res->inertiaProps('tasks'))->pluck('title')->all();
        $this->assertEqualsCanonicalizing(['Late thing', 'Healthy thing', 'Done thing'], $titles);

        // Same task fields a flag carries, so the card renders identically.
        $task = collect($res->inertiaProps('tasks'))->firstWhere('title', 'Healthy thing');
        $this->assertSame('Ashim', $task['assignee']);
        $this->assertSame('Salon Site', $task['project_name']);
        $this->assertArrayNotHasKey('type', $task);
    }

    public function test_recent_pushes_lists_undoable_tickets_only(): void
    {
        $user = User::factory()->create();
        $card = $this->card('Pushed ticket', 'Ashim', 'Assigned');

        PmActivity::record('pushed', $card, ['task_id' => 'abc123', 'project_id' => null]);
        PmActivity::record('pushed', $card, ['task_id' => 'gone', 'undone_at' => now()->toIso8601String()]);
        PmActivity::record('pushed', $card); // legacy row with no Taskmandu id — can't be undone

        $this->actingAs($user)->getJson('/pm/api/brief/pushes')
            ->assertOk()
            ->assertJsonCount(1, 'pushes')
            ->assertJsonPath('pushes.0.task_id', 'abc123')
            ->assertJsonPath('pushes.0.title', 'Pushed ticket');
    }

    public function test_undo_refuses_something_that_was_not_pushed_by_the_brief_tab(): void
    {
        $user = User::factory()->create();
        $card = $this->card('Plain', 'Ashim', 'Assigned');
        PmActivity::record('nudge', $card, ['task_id' => 'abc123']);
        $activity = PmActivity::query()->where('type', 'nudge')->firstOrFail();

        $this->actingAs($user)->postJson("/pm/api/brief/pushes/{$activity->id}/undo")->assertStatus(422);
    }

    public function test_project_health_endpoint_answers(): void
    {
        $this->actingAs(User::factory()->create())->getJson('/pm/api/automation/health')
            ->assertOk()->assertJsonStructure(['health']);
    }

    private function fakeTaskmandu(int $status = 200): void
    {
        config([
            'services.taskmandu.base_url' => 'https://taskmandu.test/api',
            'services.taskmandu.email' => 'pm@example.test',
            'services.taskmandu.password' => 'secret',
        ]);
        Cache::put('taskmandu:access_token', 'test-token'); // skip the login round-trip
        Http::fake(['taskmandu.test/*' => Http::response(['success' => true, 'message' => 'ok', 'data' => null], $status)]);
    }

    public function test_undo_deletes_exactly_the_recorded_ticket_and_rolls_back_the_card(): void
    {
        $this->fakeTaskmandu();
        $user = User::factory()->create();
        $projectId = str_repeat('b', 24);
        $card = $this->card('Board ticket', 'Ashim', 'Assigned', 3, ['project_id' => $projectId]);
        PmActivity::record('pushed', $card, ['task_id' => 'task999', 'project_id' => $projectId]);
        $activity = PmActivity::query()->where('type', 'pushed')->firstOrFail();

        $this->actingAs($user)->postJson("/pm/api/brief/pushes/{$activity->id}/undo")->assertOk()->assertJson(['ok' => true]);

        Http::assertSent(fn ($r) => $r->method() === 'DELETE' && str_ends_with($r->url(), "/projects/{$projectId}/tasks/task999"));
        $this->assertNull(PmCard::find($card->id));
        $this->assertNotEmpty($activity->fresh()->meta['undone_at']);
        $this->assertSame(1, PmActivity::where('type', 'push_undone')->count());

        // Gone from the list, and can't be undone twice.
        $this->actingAs($user)->getJson('/pm/api/brief/pushes')->assertJsonCount(0, 'pushes');
        $this->actingAs($user)->postJson("/pm/api/brief/pushes/{$activity->id}/undo")->assertStatus(422);
    }

    public function test_undo_of_a_standalone_task_deletes_it_from_the_tasks_endpoint(): void
    {
        $this->fakeTaskmandu();
        $card = $this->card('Loose ticket', 'Ashim', 'Assigned');
        PmActivity::record('pushed', $card, ['task_id' => 'solo1', 'project_id' => null]);
        $activity = PmActivity::query()->where('type', 'pushed')->firstOrFail();

        $this->actingAs(User::factory()->create())->postJson("/pm/api/brief/pushes/{$activity->id}/undo")->assertOk();

        Http::assertSent(fn ($r) => $r->method() === 'DELETE' && str_ends_with($r->url(), '/tasks/solo1') && ! str_contains($r->url(), '/projects/'));
    }

    public function test_a_failed_undo_changes_nothing(): void
    {
        $this->fakeTaskmandu(500);
        $card = $this->card('Stubborn ticket', 'Ashim', 'Assigned');
        PmActivity::record('pushed', $card, ['task_id' => 'solo2', 'project_id' => null]);
        $activity = PmActivity::query()->where('type', 'pushed')->firstOrFail();

        $this->actingAs(User::factory()->create())->postJson("/pm/api/brief/pushes/{$activity->id}/undo")->assertStatus(422)->assertJsonStructure(['error']);

        $this->assertNotNull(PmCard::find($card->id));
        $this->assertArrayNotHasKey('undone_at', $activity->fresh()->meta);
    }
}
