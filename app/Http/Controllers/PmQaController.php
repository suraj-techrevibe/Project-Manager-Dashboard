<?php

namespace App\Http\Controllers;

use App\Models\PmQaIssue;
use App\Models\PmQaReport;
use Illuminate\Support\Str;
use App\Models\PmBusiness;
use App\Models\PmCard;
use App\Models\PmQaTaskReview;
use App\Models\PmSubtask;
use App\Services\Pm\OpenAiCompatibleClient;
use App\Services\Pm\AiProviderUnavailableException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Illuminate\Support\Facades\DB;

class PmQaController extends Controller
{
    public function __construct(private OpenAiCompatibleClient $ai) {}

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
            'expected_behaviour'=>'nullable|string|max:5000','developer_notes'=>'nullable|string|max:5000',
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
            'expected_behaviour'=>'nullable|string|max:5000','developer_notes'=>'nullable|string|max:5000',
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


    /** Turn free-form inspection notes into editable QA finding drafts. Nothing is persisted here. */
    public function draftQuickCapture(Request $request): JsonResponse
    {
        $data = $request->validate(['notes' => 'required|string|min:5|max:12000']);
        $businesses = PmBusiness::query()->orderBy('name')->pluck('name')->all();
        $projects = PmCard::query()->whereNotNull('project_name')->distinct()->orderBy('project_name')->limit(150)->pluck('project_name')->all();

        $system = 'You organise QA investigation notes for a multi-business software company. Return only structured JSON. Never invent facts, URLs, business names, project names, task names, expected behaviour, or test results. Split distinct defects/observations into separate findings. Keep uncertain items as observations and ask a question rather than turning them into confirmed bugs. Infer business/project/site only when clearly supported by the notes or the supplied known names. Severity is a suggested triage value, not a fact: Critical only for major outage, security/data loss or core flow completely unusable; High for major feature broken; Medium for partial/functionality or usability defect; Low for minor cosmetic/content issue. Enhancement/idea must not be represented as a defect. For incomplete investigations, preserve that uncertainty. Return JSON shape: {"summary":"short capture summary","findings":[{"title":"","business":"","site_app":"","project_name":"","task_title":"","page_url":"","description":"","expected_behaviour":"","developer_notes":"","severity":"Medium","finding_type":"Bug","confidence":"Low","needs_review":true}],"questions":[]}. finding_type must be one of Bug, UI/UX, Content, Performance, Functional, Enhancement, Observation. confidence must be High, Medium or Low. Use empty strings for unknown text. Description should capture observed actual behaviour. Expected behaviour must remain empty unless explicit or unambiguous. Questions should list only genuinely useful missing details.';
        $prompt = "Known businesses: ".json_encode($businesses, JSON_UNESCAPED_UNICODE)."\nKnown projects: ".json_encode($projects, JSON_UNESCAPED_UNICODE)."\n\nRaw notes:\n".$data['notes'];
        $primary = (string) config('pm.assistant.provider', 'groq');
        $fallback = $primary === 'groq' && config('pm.assistant.fallback_provider') === 'openrouter' ? 'openrouter' : null;
        $provider = $this->ai->configured($primary)
            ? $primary
            : (($fallback && $this->ai->configured($fallback)) ? $fallback : null);

        if ($provider === null) {
            throw new \RuntimeException('QA note organisation is unavailable. Configure GROQ_API_KEY or OPENROUTER_API_KEY in your Render environment settings.');
        }

        $messages = [['role' => 'user', 'content' => $prompt]];
        try {
            $response = $this->ai->converse($provider, $system."\n\\nReturn ONLY valid JSON. No markdown fences.", $messages, [], 3000);
        } catch (AiProviderUnavailableException $e) {
            if ($provider !== 'groq' || !$fallback || !$this->ai->configured($fallback)) {
                throw new \RuntimeException(ucfirst($provider).' is temporarily unavailable: '.$e->getMessage(), 0, $e);
            }
            \Illuminate\Support\Facades\Log::warning('QA quick capture switched to OpenRouter after Groq became unavailable.', ['reason' => $e->getMessage()]);
            $response = $this->ai->converse($fallback, $system."\n\\nReturn ONLY valid JSON. No markdown fences.", $messages, [], 3000);
        }

        $raw = collect($response['content'] ?? [])->where('type', 'text')->pluck('text')->implode("\n");
        $raw = trim(preg_replace('/^\x60{3}(?:json)?\\s*|\\s*\x60{3}$/m', '', trim($raw)));
        try {
            $out = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            throw new \RuntimeException("The AI provider returned an unreadable draft. Try again or shorten your notes.");
        }
        if (!is_array($out)) {
            throw new \RuntimeException("The AI provider returned an invalid draft. Please try again.");
        }
        $allowedSeverity = ['Critical', 'High', 'Medium', 'Low'];
        $allowedTypes = ['Bug', 'UI/UX', 'Content', 'Performance', 'Functional', 'Enhancement', 'Observation'];
        $findings = collect($out['findings'] ?? [])->filter(fn ($f) => is_array($f) && filled($f['title'] ?? null))
            ->take(40)->map(fn ($f) => [
                'title' => mb_substr((string) ($f['title'] ?? ''), 0, 200),
                'business' => mb_substr((string) ($f['business'] ?? ''), 0, 160),
                'site_app' => mb_substr((string) ($f['site_app'] ?? ''), 0, 200),
                'project_name' => mb_substr((string) ($f['project_name'] ?? ''), 0, 200),
                'task_title' => mb_substr((string) ($f['task_title'] ?? ''), 0, 200),
                'page_url' => mb_substr((string) ($f['page_url'] ?? ''), 0, 500),
                'description' => mb_substr((string) ($f['description'] ?? ''), 0, 5000),
                'expected_behaviour' => mb_substr((string) ($f['expected_behaviour'] ?? ''), 0, 5000),
                'developer_notes' => mb_substr((string) ($f['developer_notes'] ?? ''), 0, 5000),
                'severity' => in_array($f['severity'] ?? null, $allowedSeverity, true) ? $f['severity'] : 'Medium',
                'finding_type' => in_array($f['finding_type'] ?? null, $allowedTypes, true) ? $f['finding_type'] : 'Observation',
                'confidence' => in_array($f['confidence'] ?? null, ['High', 'Medium', 'Low'], true) ? $f['confidence'] : 'Low',
                'needs_review' => (bool) ($f['needs_review'] ?? true),
            ])->values();

        return response()->json(['draft' => [
            'summary' => mb_substr((string) ($out['summary'] ?? ''), 0, 1000),
            'findings' => $findings,
            'questions' => collect($out['questions'] ?? [])->filter(fn ($q) => is_string($q) && filled($q))->take(12)->values(),
        ]]);
    }

    /** Save reviewed quick-capture drafts as ordinary QA findings, without assigning or closing them. */
    public function saveQuickCapture(Request $request): JsonResponse
    {
        $data = $request->validate([
            'findings' => 'required|array|min:1|max:40',
            'findings.*.title' => 'required|string|max:200',
            'findings.*.business' => 'nullable|string|max:160',
            'findings.*.site_app' => 'nullable|string|max:200',
            'findings.*.project_name' => 'nullable|string|max:200',
            'findings.*.task_title' => 'nullable|string|max:200',
            'findings.*.page_url' => 'nullable|string|max:500',
            'findings.*.description' => 'nullable|string|max:5000',
            'findings.*.expected_behaviour' => 'nullable|string|max:5000',
            'findings.*.developer_notes' => 'nullable|string|max:5000',
            'findings.*.severity' => ['required', Rule::in(['Critical', 'High', 'Medium', 'Low'])],
            'findings.*.finding_type' => ['nullable', Rule::in(['Bug', 'UI/UX', 'Content', 'Performance', 'Functional', 'Enhancement', 'Observation'])],
        ]);

        $saved = DB::transaction(function () use ($request, $data) {
            return collect($data['findings'])->map(function ($finding) use ($request) {
                $notes = trim((string) ($finding['developer_notes'] ?? ''));
                $type = $finding['finding_type'] ?? 'Observation';
                $finding['developer_notes'] = trim("Finding type: {$type}".($notes !== '' ? "\n".$notes : ''));
                $finding['status'] = 'Draft';
                $finding['created_by'] = $request->user()->id;
                unset($finding['finding_type']);
                return PmQaIssue::create($finding);
            });
        });

        return response()->json(['saved' => $saved->count(), 'issues' => $saved], 201);
    }

    public function reports(Request $request): JsonResponse
    {
        return response()->json(['reports' => PmQaReport::where('created_by', $request->user()->id)->latest('report_date')->latest()->limit(100)->get()]);
    }

    public function storeReport(Request $request): JsonResponse
    {
        $data = $request->validate([
            'business' => 'required|string|max:160', 'site_app' => 'nullable|string|max:200',
            'report_date' => 'required|date', 'areas_tested' => 'nullable|string|max:5000',
            'environment' => 'nullable|string|max:1000', 'summary' => 'nullable|string|max:5000',
            'fix_first' => 'nullable|string|max:5000', 'open_questions' => 'nullable|string|max:5000',
            'issue_ids' => 'required|array|min:1|max:200', 'issue_ids.*' => 'required|integer|distinct',
            'checklist' => 'nullable|array', 'checklist.*.label' => 'required_with:checklist|string|max:300',
            'checklist.*.result' => ['required_with:checklist', Rule::in(['Pass', 'Fail', 'Not tested', 'Retest required'])],
        ]);
        $findings = PmQaIssue::where('created_by', $request->user()->id)->whereIn('id', $data['issue_ids'])->orderBy('id')->get();
        if ($findings->count() !== count($data['issue_ids'])) {
            return response()->json(['message' => 'One or more selected findings could not be found. Refresh and try again.'], 422);
        }
        if ($findings->contains(fn (PmQaIssue $issue) => $issue->business !== $data['business'])) {
            return response()->json(['message' => 'All findings in a report must belong to the selected business.'], 422);
        }
        $report = PmQaReport::create([
            'created_by' => $request->user()->id,
            'report_code' => 'QA-' . now()->format('Ymd') . '-' . Str::upper(Str::random(5)),
            'business' => $data['business'], 'site_app' => $data['site_app'] ?? null,
            'report_date' => $data['report_date'], 'areas_tested' => $data['areas_tested'] ?? null,
            'environment' => $data['environment'] ?? null, 'summary' => $data['summary'] ?? null,
            'fix_first' => $data['fix_first'] ?? null, 'open_questions' => $data['open_questions'] ?? null,
            'findings' => $findings->map(fn (PmQaIssue $issue) => $issue->toArray())->values()->all(),
            'checklist' => $data['checklist'] ?? [],
        ]);
        return response()->json(['report' => $report], 201);
    }

    public function handoverReport(Request $request, PmQaReport $report): JsonResponse
    {
        abort_unless($report->created_by === $request->user()->id, 404);
        $report->update(['handed_over_at' => $report->handed_over_at ?? now()]);
        return response()->json(['report' => $report->fresh()]);
    }

}