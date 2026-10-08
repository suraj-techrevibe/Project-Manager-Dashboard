<?php

namespace App\Http\Controllers;

use App\Models\MeetingMinutes;
use App\Services\Pm\ClaudeClient;
use App\Services\Pm\MeetingFollowUpService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class MeetingMinutesController extends Controller
{
    public function __construct(private ClaudeClient $claude) {}

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

    /** Work Items to start a new meeting's minutes with: unfinished ones from the last meeting + stuck board tasks. */
    public function carryOver(MeetingFollowUpService $followUp): JsonResponse
    {
        return response()->json($followUp->carryOver());
    }

    public function show(MeetingMinutes $minute): JsonResponse
    {
        return response()->json(['minute' => $this->full($minute)]);
    }

    public function store(Request $r): JsonResponse
    {
        $data = $this->validated($r);
        $data['created_by'] = $r->user()?->name;
        $minute = MeetingMinutes::create($data);
        return response()->json(['minute' => $this->full($minute)], 201);
    }

    public function update(Request $r, MeetingMinutes $minute): JsonResponse
    {
        $minute->update($this->validated($r));
        return response()->json(['minute' => $this->full($minute)]);
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

    private function strings(mixed $v): array
    {
        return collect(is_array($v) ? $v : [])->filter(fn ($s) => filled($s))->map(fn ($s) => (string) $s)->values()->all();
    }

    private function validated(Request $r): array
    {
        $data = $r->validate([
            'title' => 'required|string|max:200',
            'status' => 'nullable|in:draft,final',
            'meeting_date' => 'required|date_format:Y-m-d',
            'attendees' => 'nullable|array', 'attendees.*' => 'string|max:100',
            'work_items' => 'nullable|array|max:100',
            'work_items.*.owner' => 'nullable|string|max:100',
            'work_items.*.project' => 'nullable|string|max:200',
            'work_items.*.project_id' => ['nullable', 'regex:/^[0-9a-fA-F]{24}$/'],
            'work_items.*.requirement' => 'nullable|string|max:500',
            'work_items.*.discussion' => 'nullable|string|max:8000',
            'work_items.*.due_date' => 'nullable|date_format:Y-m-d',
            'work_items.*.action_items' => 'nullable|array|max:50',
            'work_items.*.action_items.*.task' => 'required_with:work_items.*.action_items|string|max:300',
            'work_items.*.action_items.*.due_date' => 'nullable|date_format:Y-m-d',
            'topics' => 'nullable|array', 'agenda_items' => 'nullable|array',
            'discussion' => 'nullable|string|max:8000', 'decisions' => 'nullable|array',
            'action_items' => 'nullable|array', 'raw_notes' => 'nullable|string|max:8000',
        ]);

        // Blank fields arrive as null (Laravel turns '' into null); store them as '' so the UI never has to guess.
        if (isset($data['work_items'])) {
            $data['work_items'] = collect($data['work_items'])->map(fn ($w) => array_merge($w, [
                'owner' => (string) ($w['owner'] ?? ''),
                'project' => (string) ($w['project'] ?? ''),
                'requirement' => (string) ($w['requirement'] ?? ''),
                'discussion' => (string) ($w['discussion'] ?? ''),
                'action_items' => $w['action_items'] ?? [],
            ]))->values()->all();
        }

        return $data;
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
