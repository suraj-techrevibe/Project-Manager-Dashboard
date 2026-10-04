<?php

namespace App\Http\Controllers;

use App\Models\MeetingMinutes;
use App\Services\Pm\ClaudeClient;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Plain local CRUD for meeting minutes — nothing here talks to Taskmandu
 * (pushing action items onto a project board goes through the existing
 * /pm/projects/{id}/tasks endpoint, from the frontend). The only AI step is
 * draft(): the PM pastes rough, unstructured notes — no required syntax, no
 * @-mentions, no markdown — and Claude reshapes them into the standard
 * fields below. Nothing is saved until the PM reviews the draft and hits Save.
 */
class MeetingMinutesController extends Controller
{
    public function __construct(private ClaudeClient $claude) {}

    public function index(): JsonResponse
    {
        $minutes = MeetingMinutes::query()
            ->orderByDesc('meeting_date')
            ->orderByDesc('id')
            ->get(['id', 'title', 'status', 'meeting_date', 'attendees', 'action_items'])
            ->map(fn (MeetingMinutes $m) => [
                'id' => $m->id,
                'title' => $m->title,
                'status' => $m->status ?? 'final',
                'meeting_date' => $m->meeting_date?->toDateString(),
                'attendees' => $m->attendees ?? [],
                'action_items' => $m->action_items ?? [],
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

    /**
     * Turns pasted rough notes into the standard minutes shape. Doesn't
     * touch the database — the result lands in the editable form so the PM
     * can fix anything before saving.
     */
    public function draft(Request $r): JsonResponse
    {
        $data = $r->validate(['notes' => 'required|string|max:8000']);

        $out = $this->claude->json(
            'You turn a PM\'s rough, informal meeting notes into standard meeting minutes. '
            .'The notes may be messy bullet points, half-sentences or a stream of thought — '
            .'extract what\'s actually there, never invent attendees, decisions or action items '
            .'that weren\'t mentioned. If something is genuinely unclear, leave it out rather than guess. '
            .'owner on an action item is a person\'s name if one was actually mentioned for that item, otherwise empty string. '
            .'due_date is "YYYY-MM-DD" only if a real or clearly resolvable relative date ("next Friday") was given for that item, otherwise null. '
            .'title is a short descriptive name for the meeting (e.g. "Weekly sync — SEO"), not just a date. '
            .'Shape: {"title":"","attendees":["name"],"agenda_items":["topic"],"discussion":"plain paragraphs, no markdown","decisions":["decision"],"action_items":[{"task":"","owner":"","due_date":null}]}',
            $data['notes']
        );

        return response()->json([
            'draft' => [
                'title' => (string) ($out['title'] ?? ''),
                'attendees' => $this->strings($out['attendees'] ?? []),
                'agenda_items' => $this->strings($out['agenda_items'] ?? []),
                'discussion' => (string) ($out['discussion'] ?? ''),
                'decisions' => $this->strings($out['decisions'] ?? []),
                'action_items' => collect($out['action_items'] ?? [])
                    ->filter(fn ($a) => is_array($a) && filled($a['task'] ?? null))
                    ->map(fn ($a) => [
                        'task' => (string) $a['task'],
                        'owner' => (string) ($a['owner'] ?? ''),
                        'due_date' => $a['due_date'] ?? null,
                    ])
                    ->values(),
            ],
        ]);
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
            'topics' => 'nullable|array|max:40',
            'topics.*.title' => 'nullable|string|max:200',
            'topics.*.notes' => 'nullable|string|max:4000',
            'topics.*.decision' => 'nullable|string|max:300',
            'meeting_date' => 'required|date_format:Y-m-d',
            'attendees' => 'nullable|array',
            'attendees.*' => 'string|max:100',
            'agenda_items' => 'nullable|array',
            'agenda_items.*' => 'string|max:300',
            'discussion' => 'nullable|string|max:8000',
            'decisions' => 'nullable|array',
            'decisions.*' => 'string|max:300',
            'action_items' => 'nullable|array',
            'action_items.*.task' => 'required_with:action_items|string|max:300',
            'action_items.*.owner' => 'nullable|string|max:100',
            'action_items.*.due_date' => 'nullable|date_format:Y-m-d',
            'raw_notes' => 'nullable|string|max:8000',
        ]);
    }

    private function full(MeetingMinutes $m): array
    {
        return [
            'id' => $m->id,
            'title' => $m->title,
            'status' => $m->status ?? 'final',
            'meeting_date' => $m->meeting_date?->toDateString(),
            'attendees' => $m->attendees ?? [],
            'topics' => $m->topics,
            'agenda_items' => $m->agenda_items ?? [],
            'discussion' => $m->discussion,
            'decisions' => $m->decisions ?? [],
            'action_items' => $m->action_items ?? [],
            'raw_notes' => $m->raw_notes,
            'created_by' => $m->created_by,
            'created_at' => $m->created_at?->toIso8601String(),
            'updated_at' => $m->updated_at?->toIso8601String(),
        ];
    }
}
