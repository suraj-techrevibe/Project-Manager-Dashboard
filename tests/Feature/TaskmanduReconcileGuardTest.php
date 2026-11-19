<?php
namespace Tests\Feature;
use App\Models\PmCard;
use App\Models\PmSubtask;
use App\Services\Pm\TaskmanduClient;
use App\Services\Pm\TaskmanduSync;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Tests\TestCase;

class TaskmanduReconcileGuardTest extends TestCase
{
    use RefreshDatabase;

    private function fake(array $projects): TaskmanduSync
    {
        $client = new class($projects) extends TaskmanduClient {
            public function __construct(private array $projects) {}
            public function configured(): bool { return true; }
            public function paginate(string $path, array $query = []): array {
                return $path === '/projects' ? array_map(fn($p) => ['_id' => $p['_id']], $this->projects) : [];
            }
            public function get(string $path, array $query = []): array {
                $id = substr($path, strlen('/projects/'));
                foreach ($this->projects as $p) if ($p['_id'] === $id) return ['data' => $p];
                return ['data' => null];
            }
        };
        return new TaskmanduSync($client);
    }

    private function project(string $id, int $tasks): array
    {
        return ['_id' => $id, 'name' => "P$id", 'tasks' => array_map(fn($i) => [
            '_id' => "t{$id}_$i", 'title' => "T$i", 'status' => 'Assigned', 'createdAt' => now()->toIso8601String(),
        ], range(1, $tasks))];
    }

    public function test_empty_pull_does_not_wipe_mirror_and_warns(): void
    {
        $this->fake([$this->project('a', 20)])->run();
        $this->assertSame(20, PmCard::count());
        $this->fake([])->run();                       // remote suddenly shows nothing
        $this->assertSame(20, PmCard::count());
        $this->assertNotNull(Cache::get('pm.last_sync_warning'));
    }

    public function test_sharp_drop_is_refused(): void
    {
        $this->fake([$this->project('a', 20), $this->project('b', 20)])->run();
        $this->fake([$this->project('a', 20)])->run(); // project b vanished: 50% drop
        $this->assertSame(40, PmCard::count());
        $this->assertNotNull(Cache::get('pm.last_sync_warning'));
    }

    public function test_small_real_delete_still_applies(): void
    {
        $this->fake([$this->project('a', 20)])->run();
        $this->fake([$this->project('a', 19)])->run(); // one task deleted
        $this->assertSame(19, PmCard::count());
        $this->assertNull(Cache::get('pm.last_sync_warning'));
    }
}
