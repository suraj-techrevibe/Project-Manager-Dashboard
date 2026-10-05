<?php

namespace App\Http\Controllers;

use App\Models\PmActivity;
use App\Models\PmCard;
use App\Services\Pm\TaskmanduSync;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;
use RuntimeException;

class PmMeetingTicketController extends Controller
{
    public function __construct(private TaskmanduSync $taskmandu) {}

    public function push(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'tickets' => 'required|array|min:1|max:30',
            'tickets.*.title' => 'required|string|max:200',
            'tickets.*.description' => 'nullable|string|max:3000',
            'tickets.*.level' => 'nullable|string|max:30',
            'tickets.*.estimate_hours' => 'nullable|numeric|min:0|max:1000',
            'tickets.*.priority' => ['nullable', Rule::in(['Low','Medium','High','Critical'])],
            'tickets.*.assignee_employee_id' => 'required|string|max:100',
            'tickets.*.due_date' => 'nullable|date_format:Y-m-d',
            'tickets.*.project_id' => ['nullable','regex:/^[0-9a-fA-F]{24}$/'],
            'tickets.*.project_confirmed' => 'boolean',
            'tickets.*.subtasks' => 'nullable|array|max:50',
            'tickets.*.subtasks.*.title' => 'required|string|max:300',
            'tickets.*.subtasks.*.assignee_employee_id' => 'required|string|max:100',
            'tickets.*.subtasks.*.due_date' => 'nullable|date_format:Y-m-d',
        ]);
        $data = $validator->validate();

        $employees = $this->taskmandu->employeeMap();
        $results = [];
        foreach ($data['tickets'] as $i => $ticket) {
            try {
                if (empty($ticket['project_id'])) {
                    throw new RuntimeException('This meeting Work Item has no confirmed project. Select or create the project before pushing.');
                }
                if (empty($ticket['project_confirmed'])) {
                    throw new RuntimeException('Project confirmation is required before this Work Item can be pushed.');
                }
                $results[] = ['index' => $i] + $this->create($ticket, $employees, (string) $request->user()?->name);
            } catch (RuntimeException $e) {
                $results[] = ['index' => $i, 'ok' => false, 'error' => $e->getMessage()];
            }
        }

        $created = collect($results)->where('ok', true)->count();
        return response()->json(['results' => $results, 'created' => $created, 'failed' => count($results) - $created]);
    }

    private function create(array $ticket, array $employees, string $assignedBy): array
    {
        $projectId = $ticket['project_id'];
        $assigneeId = $ticket['assignee_employee_id'];
        $due = $ticket['due_date'] ?? now()->addWeek()->toDateString();
        $priority = $ticket['priority'] ?? 'Medium';
        $hours = isset($ticket['estimate_hours']) ? (float) $ticket['estimate_hours'] : null;
        $level = $ticket['level'] ?? null;
        $extra = ['priority'=>$priority,'estimatedHours'=>$hours,'tags'=>$level ? [$level] : []];
        $fallback = 'Level: '.($level ?: '-').' | Est: '.($hours ?? '?').'h | Priority: '.$priority;

        $res = $this->taskmandu->createProjectTask($projectId, $ticket['title'], trim($ticket['description'] ?? ''), $assigneeId, $assignedBy, $due, $extra, $fallback);
        $task = $res['task'];
        $taskId = $task['_id'] ?? null;
        if (!$taskId) throw new RuntimeException('Taskmandu created the project task but did not return its task id, so subtasks were not created.');

        $subtasksCreated = 0;
        foreach ($ticket['subtasks'] ?? [] as $sub) {
            $this->taskmandu->createSubTask($projectId, $taskId, trim($sub['title']), $sub['assignee_employee_id'], $assignedBy);
            $subtasksCreated++;
        }

        $assignee = $employees[$assigneeId] ?? $assigneeId;
        $attrs = [
            'title' => $ticket['title'],
            'description' => $task['description'] ?? ($res['fallback'] ? trim(($ticket['description'] ?? '')."\n\n".$fallback) : ($ticket['description'] ?? '')),
            'assignee' => $assignee,
            'status' => $task['status'] ?? 'Assigned',
            'priority' => $task['priority'] ?? ($res['fallback'] ? null : $priority),
            'due_at' => $due,
            'estimated_hours' => $task['estimatedHours'] ?? $hours,
            'tags' => $task['tags'] ?? ($level ? [$level] : []),
            'subtasks_count' => $subtasksCreated,
            'comments_count' => 0,
            'assigned_by' => $assignedBy ?: null,
            'project_id' => $projectId,
            'project_name' => $res['project']['name'] ?? ($ticket['project_name'] ?? null),
            'task_id' => $taskId,
            'url' => rtrim((string) config('services.taskmandu.frontend_url'), '/')."/projects/{$projectId}",
            'last_activity_at' => now(),
        ];
        $card = PmCard::updateOrCreate(['external_id' => "project:{$projectId}:task:{$taskId}"], $attrs);
        PmActivity::record('pushed', $card, ['project' => $attrs['project_name'], 'subtasks' => $subtasksCreated]);

        return ['ok'=>true,'task_id'=>$taskId,'card_id'=>$card->id,'fields_fallback'=>$res['fallback'],'subtasks_created'=>$subtasksCreated];
    }
}
