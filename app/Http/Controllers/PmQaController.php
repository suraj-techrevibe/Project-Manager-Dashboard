<?php

namespace App\Http\Controllers;

use App\Models\PmQaIssue;
use App\Models\PmBusiness;
use App\Models\PmCard;
use App\Models\PmQaTaskReview;
use App\Models\PmSubtask;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Illuminate\Support\Facades\DB;

class PmQaController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $projects = PmCard::query()->whereNotNull('project_id')->select('project_id', 'project_name')->distinct()->orderBy('project_name')->get();
        $tasks = PmCard::query()->whereNotNull('project_id')->orderBy('project_name')->orderBy('title')->get(['project_id', 'project_name', 'task_id', 'title']);
        $subtasks = PmSubtask::query()->orderBy('title')->get(['project_id', 'task_id', 'subtask_id', 'title']);

        return response()->json([
            'issues' => PmQaIssue::where('created_by', $request->user()->id)->latest()->limit(300)->get(),
            'filters' => [
                'businesses' => PmBusiness::query()->orderBy('name')->pluck('name'),
                'projects' => $projects->map(fn ($p) => ['id' => $p->project_id, 'name' => $p->project_name])->values(),
                'tasks' => $tasks->map(fn ($t) => ['project_id' => $t->project_id, 'id' => $t->task_id, 'title' => $t->title])->values(),
                'subtasks' => $subtasks->map(fn ($s) => ['project_id' => $s->project_id, 'task_id' => $s->task_id, 'id' => $s->subtask_id, 'title' => $s->title])->values(),
            ],
        ]);
    }

    public function taskInbox(): JsonResponse
    {
        $reviews = PmQaTaskReview::query()
            ->with(['events.tester:id,name', 'tester:id,name'])
            ->orderByRaw("CASE WHEN qa_status = 'Awaiting QA' THEN 0 WHEN qa_status = 'Failed' THEN 1 ELSE 2 END")
            ->orderByDesc('triggered_at')->limit(500)->get();

        $projectIds = $reviews->pluck('project_id')->filter()->unique()->values();
        $taskIds = $reviews->pluck('task_id')->filter()->unique()->values();
        $subtasks = collect();
        if ($projectIds->isNotEmpty() && $taskIds->isNotEmpty()) {
            $subtasks = PmSubtask::query()->whereIn('project_id', $projectIds)->whereIn('task_id', $taskIds)
                ->orderBy('title')->get()->groupBy(fn (PmSubtask $s) => $s->project_id.':'.$s->task_id);
        }

        return response()->json([
            'reviews' => $reviews->map(function (PmQaTaskReview $review) use ($subtasks) {
                $row = $review->toArray();
                $key = ($review->project_id ?? '').':'.$review->task_id;
                $row['subtasks'] = ($subtasks->get($key) ?? collect())->map(fn (PmSubtask $s) => [
                    'id' => $s->subtask_id, 'title' => $s->title, 'status' => $s->status,
                    'assignee' => $s->assignee, 'completed_at' => $s->completed_at?->toIso8601String(),
                ])->values();
                $row['tester_name'] = $review->tester?->name;
                $row['events'] = $review->events->map(function ($event) {
                    $item = $event->toArray();
                    $item['tester_name'] = $event->tester?->name;
                    return $item;
                })->values();
                return $row;
            })->values(),
            'trigger_statuses' => ['Completed', 'Review'],
            'last_synced_at' => cache('pm.last_synced_at'),
        ]);
    }

    public function updateTaskReview(Request $request, PmQaTaskReview $review): JsonResponse
    {
        $data = $request->validate([
            'result' => ['required', Rule::in(['Pass', 'Fail'])],
            'severity' => ['nullable', Rule::in(['Critical', 'High', 'Medium', 'Low', 'Enhancement'])],
            'notes' => 'nullable|string|max:5000',
            'evidence_url' => 'nullable|url|max:1000',
        ]);
        $severity = $data['result'] === 'Fail' ? ($data['severity'] ?? 'Medium') : null;
        $qaStatus = $data['result'] === 'Pass' ? 'Passed' : 'Failed';

        DB::transaction(function () use ($request, $review, $data, $severity, $qaStatus) {
            $review->events()->create([
                'cycle' => $review->cycle, 'result' => $data['result'], 'severity' => $severity,
                'notes' => $data['notes'] ?? null, 'evidence_url' => $data['evidence_url'] ?? null,
                'tested_by' => $request->user()->id,
            ]);
            $review->update([
                'qa_status' => $qaStatus, 'last_result' => $data['result'], 'last_severity' => $severity,
                'last_notes' => $data['notes'] ?? null, 'last_evidence_url' => $data['evidence_url'] ?? null,
                'tested_at' => now(), 'tested_by' => $request->user()->id,
            ]);
        });

        return response()->json(['review' => $review->fresh(['events.tester:id,name', 'tester:id,name'])]);
    }
    public function store(Request $request): JsonResponse {
        $data = $request->validate([
            'business'=>'nullable|string|max:160','site_app'=>'nullable|string|max:200',
            'project_id'=>'nullable|string|max:24','project_name'=>'nullable|string|max:200','task_id'=>'nullable|string|max:24',
            'task_title'=>'nullable|string|max:200','subtask_id'=>'nullable|string|max:24','subtask_title'=>'nullable|string|max:200',
            'page_url'=>'nullable|string|max:500',
            'title'=>'required|string|max:200','description'=>'nullable|string|max:5000',
            'severity'=>['required',Rule::in(['Critical','High','Medium','Low'])],
            'status'=>['required',Rule::in(['Draft','Reported','Fixing','Ready for Retest','Passed','Failed'])],
            'assignee'=>'nullable|string|max:160','evidence_url'=>'nullable|string|max:1000','pm_task_url'=>'nullable|url|max:1000','retest_notes'=>'nullable|string|max:5000',
        ]);
        $data['created_by']=$request->user()->id;
        return response()->json(['issue'=>PmQaIssue::create($data)],201);
    }
    public function update(Request $request, PmQaIssue $issue): JsonResponse {
        abort_unless($issue->created_by === $request->user()->id, 404);
        $data = $request->validate([
            'business'=>'nullable|string|max:160','site_app'=>'nullable|string|max:200',
            'project_id'=>'nullable|string|max:24','project_name'=>'nullable|string|max:200','task_id'=>'nullable|string|max:24',
            'task_title'=>'nullable|string|max:200','subtask_id'=>'nullable|string|max:24','subtask_title'=>'nullable|string|max:200',
            'page_url'=>'nullable|string|max:500',
            'title'=>'required|string|max:200','description'=>'nullable|string|max:5000',
            'severity'=>['required',Rule::in(['Critical','High','Medium','Low'])],
            'status'=>['required',Rule::in(['Draft','Reported','Fixing','Ready for Retest','Passed','Failed'])],
            'assignee'=>'nullable|string|max:160','evidence_url'=>'nullable|string|max:1000','pm_task_url'=>'nullable|url|max:1000','retest_notes'=>'nullable|string|max:5000',
        ]);
        $issue->update($data);
        return response()->json(['issue'=>$issue->fresh()]);
    }
    public function destroy(Request $request, PmQaIssue $issue): JsonResponse {
        abort_unless($issue->created_by === $request->user()->id, 404);
        $issue->delete();
        return response()->json(['deleted'=>true]);
    }
}