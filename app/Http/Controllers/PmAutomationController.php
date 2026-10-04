<?php

namespace App\Http\Controllers;

use App\Models\PmMeetingTemplate;
use App\Models\PmNudgeBatch;
use App\Models\PmProjectHealth;
use App\Models\PmTicketPack;
use App\Models\PmWaitingClient;
use App\Services\Pm\AutomationService;
use App\Services\Pm\TaskmanduClient;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Validation\Rule;
use RuntimeException;

class PmAutomationController extends Controller
{
    public function __construct(private AutomationService $automation, private TaskmanduClient $taskmandu) {}

    public function nudgeBatch(): JsonResponse
    {
        $batch = PmNudgeBatch::latest('id')->first();
        return response()->json(['batch' => $batch]);
    }

    public function generateNudgeBatch(Request $r): JsonResponse
    {
        $days = $r->validate(['idle_days' => 'nullable|integer|min:1|max:30'])['idle_days'] ?? null;
        return response()->json(['batch' => $this->automation->generateNudges($days)]);
    }

    public function sendNudgeBatch(PmNudgeBatch $batch): JsonResponse
    {
        try {
            return response()->json($this->automation->sendNudgeBatch($batch));
        } catch (RuntimeException $e) {
            return response()->json(['error' => $e->getMessage()], 422);
        }
    }

    public function updateNudgeBatch(Request $r, PmNudgeBatch $batch): JsonResponse
    {
        $data = $r->validate(['items' => 'required|array|max:500']);
        $batch->update(['items' => $data['items']]);
        return response()->json(['batch' => $batch->fresh()]);
    }

    public function health(): JsonResponse
    {
        return response()->json(['health' => PmProjectHealth::query()->orderBy('health')->orderByDesc('score')->get()]);
    }

    public function waitingClient(): JsonResponse
    {
        return response()->json(['items' => PmWaitingClient::query()->where('status', 'waiting')->orderBy('waiting_since')->get()]);
    }

    public function addWaitingClient(Request $r): JsonResponse
    {
        $data = $r->validate([
            'project_id' => ['nullable','regex:/^[0-9a-fA-F]{24}$/'],
            'task_id' => ['nullable','regex:/^[0-9a-fA-F]{24}$/'],
            'card_id' => 'nullable|integer|exists:pm_cards,id',
            'title' => 'required|string|max:300',
            'waiting_since' => 'required|date_format:Y-m-d',
        ]);
        return response()->json(['item' => PmWaitingClient::create($data)], 201);
    }

    public function resolveWaitingClient(PmWaitingClient $item): JsonResponse
    {
        $item->update(['status' => 'resolved', 'last_checked_at' => now()->toDateString()]);
        return response()->json(['item' => $item->fresh()]);
    }

    public function meetingTemplates(): JsonResponse
    {
        return response()->json(['templates' => PmMeetingTemplate::latest()->get()]);
    }

    public function saveMeetingTemplate(Request $r): JsonResponse
    {
        $data = $r->validate([
            'name' => 'required|string|max:200',
            'project_name' => 'nullable|string|max:200',
            'attendees' => 'nullable|array',
            'attendees.*' => 'string|max:100',
            'topics' => 'nullable|array',
            'topics.*.title' => 'required|string|max:200',
            'weekday' => ['required', Rule::in(['monday','tuesday','wednesday','thursday','friday'])],
            'meeting_time' => 'nullable|date_format:H:i',
            'active' => 'boolean',
        ]);
        return response()->json(['template' => PmMeetingTemplate::create($data)], 201);
    }

    public function ticketPacks(): JsonResponse
    {
        return response()->json(['packs' => PmTicketPack::latest()->get()]);
    }

    public function saveTicketPack(Request $r): JsonResponse
    {
        $data = $r->validate([
            'name' => 'required|string|max:200',
            'description' => 'nullable|string|max:1000',
            'tickets' => 'required|array|min:1|max:50',
            'tickets.*.title' => 'required|string|max:200',
            'tickets.*.description' => 'nullable|string|max:3000',
            'tickets.*.level' => 'nullable|string|max:50',
            'tickets.*.estimate_hours' => 'nullable|numeric|min:0|max:1000',
            'tickets.*.priority' => ['nullable', Rule::in(['Low','Medium','High','Critical'])],
        ]);
        return response()->json(['pack' => PmTicketPack::create($data)], 201);
    }

    public function pushTicketPack(Request $r, PmTicketPack $pack): JsonResponse
    {
        $data = $r->validate(['project_id' => ['required','regex:/^[0-9a-fA-F]{24}$/']]);
        $results = [];
        foreach ($pack->tickets as $ticket) {
            try {
                $payload = [
                    'title' => $ticket['title'],
                    'description' => $ticket['description'] ?? '',
                    'assignedToId' => $ticket['assignee_employee_id'] ?? [],
                    'assignedByName' => $r->user()?->name,
                    'priority' => $ticket['priority'] ?? 'Medium',
                    'dueDate' => $ticket['due_date'] ?? now()->addWeek()->toDateString(),
                    'estimatedHours' => $ticket['estimate_hours'] ?? 0,
                    'tags' => !empty($ticket['level']) ? [$ticket['level']] : [],
                ];
                $res = $this->taskmandu->post("/projects/{$data['project_id']}/tasks", $payload);
                $results[] = ['ok' => true, 'task_id' => $res['data']['task']['_id'] ?? null];
            } catch (\Throwable $e) {
                $results[] = ['ok' => false, 'error' => $e->getMessage()];
            }
        }
        return response()->json(['results' => $results]);
    }
}