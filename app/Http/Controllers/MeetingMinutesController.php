<?php

namespace App\Http\Controllers;

use App\Models\MeetingMinutes;
use App\Services\Pm\ClaudeClient;
use App\Services\Pm\TaskmanduClient;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use RuntimeException;

class MeetingMinutesController extends Controller
{
    public function __construct(private ClaudeClient $claude, private TaskmanduClient $taskmandu) {}

    public function index(): JsonResponse
    {
        $minutes = MeetingMinutes::query()
            ->orderByDesc('meeting_date')->orderByDesc('id')
            ->get(['id', 'title', 'status', 'meeting_date', 'attendees', 'action_items', 'work_items'])
            ->map(fn (MeetingMinutes $m) => [
                'id' => $m->id,
                'title' => $m->title,
                'status' => $m->status ?? 'final',
                'meeting_date' => $m->meeting_date?->toDateString(),
                'attendees' => $m->attendees ?? [],
                'action_items' => $m->action_items ?? [],
                'work_items' => $m->work_items ?? [],
            ]);

        return response()->json(['minutes' => $minutes]);
    }

    public function show(MeetingMinutes $minute): JsonResponse
    {
        return response()->json(['minute' => $this->full($minute)]);
    }

    public function store(Request $r): JsonResponse
    {
        $data = $this->validated($r);
        $assignedBy = $r->user()?->name;

        try {
            $created = $this->resolveProjects($data, $assignedBy);
        } catch (RuntimeException $e) {
            return $this->projectFailure($e);
        }

        $data['created_by'] = $assignedBy;
        $minute = MeetingMinutes::create($data);

        return response()->json(['minute' => $this->full($minute), 'created_projects' => $created], 201);
    }

    public function update(Request $r, MeetingMinutes $minute): JsonResponse
    {
        $data = $this->validated($r);
        $assignedBy = $minute->created_by ?: $r->user()?->name;

        try {
            $created = $this->resolveProjects($data, $assignedBy);
        } catch (RuntimeException $e) {
            return $this->projectFailure($e);
        }

        $minute->update($data);

        return response()->json(['minute' => $this->full($minute), 'created_projects' => $created]);
    }

    public function destroy(MeetingMinutes $minute): JsonResponse
    {
        $minute->delete();
        return response()->json(['deleted' => true]);
    }

    public function draft(Request $r): JsonResponse
    {
        $data = $r->validate(['notes' => 'required|string|max:8000']);
        $out = $this->claude->json(
            'Turn rough meeting notes into structured minutes. Never invent facts. Extract attendees and work items. Each work item must have owner, project/business, requirement, discussion, action_items with task and due_date, and due_date. Use empty strings/null when absent. Shape: {"title":"","attendees":[],"work_items":[{"owner":"","project":"","requirement":"","discussion":"","action_items":[{"task":"","due_date":null}],"due_date":null}]}',
            $data['notes']
        );

        return response()->json(['draft' => [
            'title' => (string) ($out['title'] ?? ''),
            'attendees' => $this->strings($out['attendees'] ?? []),
            'work_items' => collect($out['work_items'] ?? [])->filter('is_array')->map(fn ($w) => [
                'owner' => (string) ($w['owner'] ?? ''),
                'project' => (string) ($w['project'] ?? ''),
                'requirement' => (string) ($w['requirement'] ?? ''),
                'discussion' => (string) ($w['discussion'] ?? ''),
                'action_items' => collect($w['action_items'] ?? [])->filter('is_array')->map(fn ($a) => [
                    'task' => (string) ($a['task'] ?? ''), 'due_date' => $a['due_date'] ?? null,
                ])->values()->all(),
                'due_date' => $w['due_date'] ?? null,
            ])->values()->all(),
        ]]);
    }

    /**
     * "Save as final" is the moment a Work Item's project has to exist in Taskmandu: every project
     * name that isn't an existing project is created, and each Work Item is linked to its project
     * (canonical name + project_id) so ticket generation never has to guess. A draft never touches
     * Taskmandu — and drops any stale link, so a renamed project is never silently kept.
     *
     * Names are matched the way the Brief tab matches them (case, punctuation and spacing ignored).
     * Anything that fails throws before the minutes are saved, so a failed final changes nothing; a
     * retry is safe because projects created by an earlier attempt now match by name.
     *
     * @return array<int, array{name: string, id: string}> the projects this save created
     */
    private function resolveProjects(array &$data, ?string $assignedBy = null): array
    {
        if (! isset($data['work_items'])) {
            return [];
        }

        $items = array_map(function ($w) {
            unset($w['project_id']);

            return $w;
        }, $data['work_items']);
        $data['work_items'] = $items;

        if (($data['status'] ?? null) !== 'final') {
            return [];
        }

        $names = array_filter(array_map(fn ($w) => trim((string) ($w['project'] ?? '')), $items));
        if (! $names) {
            return [];
        }
        if (! $this->taskmandu->configured()) {
            throw new RuntimeException("Taskmandu isn't configured (set TASKMANDU_BASE_URL / EMAIL / PASSWORD in .env), so projects can't be created. Save as a draft instead.");
        }

        try {
            $known = [];
            foreach ($this->taskmandu->paginate('/projects') as $p) {
                if (! empty($p['_id']) && ! empty($p['name'])) {
                    $known[self::projectKey($p['name'])] ??= ['_id' => $p['_id'], 'name' => $p['name']];
                }
            }
        } catch (RuntimeException $e) {
            throw new RuntimeException("Couldn't check existing projects in Taskmandu: {$e->getMessage()}", 0, $e);
        }

        $created = [];
        foreach ($items as $i => $w) {
            $name = trim((string) ($w['project'] ?? ''));
            if ($name === '') {
                continue;
            }

            $key = self::projectKey($name);
            if ($key === '') {
                throw new RuntimeException("“{$name}” isn't a usable project name — use letters or numbers.");
            }

            if (! isset($known[$key])) {
                try {
                    $res = $this->taskmandu->post('/projects', [
                        'name' => $name,
                        'description' => "Created from meeting minutes: {$data['title']} ({$data['meeting_date']}).",
                    ]);
                } catch (RuntimeException $e) {
                    throw new RuntimeException("Couldn't create the project “{$name}” in Taskmandu: {$e->getMessage()}", 0, $e);
                }

                $project = $res['data'] ?? [];
                if (empty($project['_id'])) {
                    throw new RuntimeException("Taskmandu created “{$name}” but didn't return its id.");
                }

                $known[$key] = ['_id' => $project['_id'], 'name' => $project['name'] ?? $name];
                $created[] = ['name' => $known[$key]['name'], 'id' => $known[$key]['_id']];
            }

            $items[$i]['project'] = $known[$key]['name'];
            $items[$i]['project_id'] = $known[$key]['_id'];
        }

        $data['work_items'] = $items;

        // Final meeting minutes also become normal Project -> Tasks. Drafts never call
        // this code, and existing matching task titles are updated rather than duplicated.
        $creator = trim((string) ($assignedBy ?? ''));
        foreach ($data['work_items'] as $i => $item) {
            $projectId = $item['project_id'] ?? null;
            $requirement = trim((string) ($item['requirement'] ?? ''));
            if (!$projectId || $requirement === '') {
                continue;
            }

            $actionItems = array_map(
                fn ($a) => [
                    'task' => (string) ($a['task'] ?? ''),
                    'owner' => (string) ($a['owner'] ?? $item['owner'] ?? ''),
                    'due_date' => $a['due_date'] ?? null,
                ],
                $item['action_items'] ?? []
            );

            $task = $this->taskmanduSync->syncMeetingWorkItem(
                (string) $projectId,
                $requirement,
                trim((string) ($item['discussion'] ?? '')),
                trim((string) ($item['owner'] ?? '')) ?: null,
                $item['due_date'] ?? null,
                $actionItems,
                $creator
            );

            $data['work_items'][$i]['task_id'] = $task['task_id'];
        }

        return $created;
    }

    /** Same normalisation as the frontend: lower-case, punctuation → space, collapsed spacing. */
    private static function projectKey(string $name): string
    {
        $spaced = preg_replace('/[^\p{L}\p{N}\s]+/u', ' ', mb_strtolower($name));

        return trim((string) preg_replace('/\s+/u', ' ', (string) $spaced));
    }

    private function projectFailure(RuntimeException $e): JsonResponse
    {
        $msg = $e->getMessage().' These minutes were not saved as final.';

        return response()->json(['error' => $msg, 'message' => $msg], 422);
    }

    private function strings(mixed $v): array
    {
        return collect(is_array($v) ? $v : [])->filter(fn ($s) => filled($s))->map(fn ($s) => (string) $s)->values()->all();
    }

    private function validated(Request $r): array
    {
        return $r->validate([
            'title' => 'required|string|max:200',
            'status' => 'nullable|in:draft,final',
            'meeting_date' => 'required|date_format:Y-m-d',
            'attendees' => 'nullable|array', 'attendees.*' => 'string|max:100',
            'work_items' => 'nullable|array|max:100',
            'work_items.*.owner' => 'nullable|string|max:100',
            'work_items.*.project' => 'nullable|string|max:200',
            'work_items.*.requirement' => 'required_with:work_items|string|max:500',
            'work_items.*.discussion' => 'nullable|string|max:8000',
            'work_items.*.due_date' => 'nullable|date_format:Y-m-d',
            'work_items.*.action_items' => 'nullable|array|max:50',
            'work_items.*.action_items.*.task' => 'required_with:work_items.*.action_items|string|max:300',
            'work_items.*.action_items.*.due_date' => 'nullable|date_format:Y-m-d',
            'topics' => 'nullable|array', 'agenda_items' => 'nullable|array',
            'discussion' => 'nullable|string|max:8000', 'decisions' => 'nullable|array',
            'action_items' => 'nullable|array', 'raw_notes' => 'nullable|string|max:8000',
        ]);
    }

    private function full(MeetingMinutes $m): array
    {
        return [
            'id' => $m->id, 'title' => $m->title, 'status' => $m->status ?? 'final',
            'meeting_date' => $m->meeting_date?->toDateString(), 'attendees' => $m->attendees ?? [],
            'topics' => $m->topics, 'agenda_items' => $m->agenda_items ?? [], 'discussion' => $m->discussion,
            'decisions' => $m->decisions ?? [], 'action_items' => $m->action_items ?? [],
            'work_items' => $m->work_items ?? [], 'raw_notes' => $m->raw_notes,
            'created_by' => $m->created_by, 'created_at' => $m->created_at?->toIso8601String(),
            'updated_at' => $m->updated_at?->toIso8601String(),
        ];
    }
}
