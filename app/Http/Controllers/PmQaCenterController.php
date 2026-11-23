<?php

namespace App\Http\Controllers;

use App\Models\PmQaCheck;
use App\Models\PmQaIssue;
use App\Models\PmQaReport;
use App\Models\PmQaTaskReview;
use App\Services\Pm\QaCenterService;
use App\Services\Pm\QaStage;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

/** JSON API for the QA Center tab. The rules live in QaCenterService; this only validates and routes. */
class PmQaCenterController extends Controller
{
    public function __construct(private QaCenterService $qa) {}

    public function index(Request $request): JsonResponse
    {
        return response()->json($this->qa->payload($request->user()));
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'title' => 'required|string|max:200',
            'business' => 'nullable|string|max:160',
            'site' => 'nullable|string|max:200',
            'url' => 'nullable|string|max:1000',
            'assignee' => 'nullable|string|max:160',
            'checks' => 'nullable|array|max:'.QaCenterService::MAX_CHECKS,
            'checks.*' => 'nullable|string|max:300',
        ]);

        $issue = $this->qa->create($request->user(), $data);

        return response()->json(['item' => $this->qa->present($issue, QaCenterService::ISSUE, $request->user())], 201);
    }

    public function update(Request $request, string $kind, int $id): JsonResponse
    {
        $item = $this->find($request, $kind, $id);
        $data = $request->validate([
            'stage' => ['sometimes', Rule::in(QaStage::ALL)],
            'fail_note' => 'nullable|string|max:5000',
            'remarks' => 'nullable|string|max:5000',
            'title' => 'sometimes|required|string|max:200',
            'assignee' => 'nullable|string|max:160',
            'url' => 'nullable|string|max:1000',
            'business' => 'nullable|string|max:160',
            'site' => 'nullable|string|max:200',
        ]);

        $this->qa->update($item, $kind, $data, $request->user());

        return $this->respond($item, $kind, $request);
    }

    public function destroy(Request $request, string $kind, int $id): JsonResponse
    {
        $item = $this->find($request, $kind, $id);
        if ($kind !== QaCenterService::ISSUE) {
            return response()->json(['message' => 'Taskmandu reviews mirror a real task and can\'t be deleted here.'], 422);
        }
        $this->qa->delete($item);

        return response()->json(['deleted' => true]);
    }

    public function storeChecks(Request $request, string $kind, int $id): JsonResponse
    {
        $item = $this->find($request, $kind, $id);
        $data = $request->validate([
            'label' => 'nullable|string|max:300',
            'labels' => 'nullable|array|max:'.QaCenterService::MAX_CHECKS,
            'labels.*' => 'nullable|string|max:300',
        ]);

        $this->qa->addChecks($item, $kind, $data['labels'] ?? [$data['label'] ?? '']);

        return $this->respond($item, $kind, $request, 201);
    }

    public function updateCheck(Request $request, string $kind, int $id, PmQaCheck $check): JsonResponse
    {
        $item = $this->find($request, $kind, $id);
        abort_unless($check->item_type === $kind && (int) $check->item_id === $id, 404);
        $data = $request->validate(['is_done' => 'required|boolean']);

        $this->qa->setCheckDone($item, $kind, $check, (bool) $data['is_done'], $request->user());

        return $this->respond($item, $kind, $request);
    }

    public function destroyCheck(Request $request, string $kind, int $id, PmQaCheck $check): JsonResponse
    {
        $item = $this->find($request, $kind, $id);
        abort_unless($check->item_type === $kind && (int) $check->item_id === $id, 404);

        $this->qa->removeCheck($item, $check);

        return $this->respond($item, $kind, $request);
    }

    public function storeScreenshot(Request $request, string $kind, int $id): JsonResponse
    {
        $item = $this->find($request, $kind, $id);
        $data = $request->validate(['file' => 'required|image|max:5120']);

        $this->qa->addScreenshot($item, $data['file'], $request->user());

        return $this->respond($item, $kind, $request, 201);
    }

    public function destroyScreenshot(Request $request, string $kind, int $id, string $screenshot): JsonResponse
    {
        $item = $this->find($request, $kind, $id);
        abort_unless($this->qa->removeScreenshot($item, $screenshot, $request->user()), 404);

        return $this->respond($item, $kind, $request);
    }

    /** Save a report snapshot built from QA Center items. Later changes to the items never alter it. */
    public function storeReport(Request $request): JsonResponse
    {
        $data = $request->validate([
            'business' => 'required|string|max:160',
            'site_app' => 'nullable|string|max:200',
            'report_date' => 'required|date',
            'areas_tested' => 'nullable|string|max:5000',
            'environment' => 'nullable|string|max:1000',
            'summary' => 'nullable|string|max:5000',
            'fix_first' => 'nullable|string|max:5000',
            'open_questions' => 'nullable|string|max:5000',
            'item_keys' => 'required|array|min:1|max:300',
            'item_keys.*' => ['required', 'string', 'regex:/^(issue|task):[0-9]+$/'],
            'checklist' => 'nullable|array',
            'checklist.*.label' => 'required_with:checklist|string|max:300',
            'checklist.*.result' => ['required_with:checklist', Rule::in(['Pass', 'Fail', 'Not tested', 'Retest required'])],
        ]);

        $items = $this->qa->snapshot($request->user(), $data['item_keys']);
        if (count($items) === 0) {
            return response()->json(['message' => 'None of the selected QA items could be found. Refresh and try again.'], 422);
        }

        $report = PmQaReport::create([
            'created_by' => $request->user()->id,
            'report_code' => 'QA-'.now()->format('Ymd').'-'.Str::upper(Str::random(5)),
            'business' => $data['business'],
            'site_app' => $data['site_app'] ?? null,
            'report_date' => $data['report_date'],
            'areas_tested' => $data['areas_tested'] ?? null,
            'environment' => $data['environment'] ?? null,
            'summary' => $data['summary'] ?? null,
            'fix_first' => $data['fix_first'] ?? null,
            'open_questions' => $data['open_questions'] ?? null,
            'findings' => $items,
            'checklist' => $data['checklist'] ?? [],
        ]);

        return response()->json(['report' => $report], 201);
    }

    /** Edit a saved snapshot only; the live QA items are untouched. */
    public function updateReport(Request $request, PmQaReport $report): JsonResponse
    {
        abort_unless($report->created_by === $request->user()->id, 404);
        $data = $request->validate([
            'areas_tested' => 'nullable|string|max:5000',
            'environment' => 'nullable|string|max:1000',
            'summary' => 'nullable|string|max:5000',
            'fix_first' => 'nullable|string|max:5000',
            'open_questions' => 'nullable|string|max:5000',
            'findings' => 'required|array|max:300',
            'findings.*.key' => 'nullable|string|max:40',
            'findings.*.code' => 'nullable|string|max:24',
            'findings.*.title' => 'required|string|max:200',
            'findings.*.stage' => ['required', Rule::in(QaStage::ALL)],
            'findings.*.business' => 'nullable|string|max:160',
            'findings.*.site' => 'nullable|string|max:200',
            'findings.*.source' => 'nullable|string|max:40',
            'findings.*.assignee' => 'nullable|string|max:160',
            'findings.*.url' => 'nullable|string|max:1000',
            'findings.*.fail_note' => 'nullable|string|max:5000',
            'findings.*.remarks' => 'nullable|string|max:5000',
            'findings.*.checks' => 'nullable|array|max:'.QaCenterService::MAX_CHECKS,
            'findings.*.checks.*.label' => 'required|string|max:300',
            'findings.*.checks.*.is_done' => 'required|boolean',
            'findings.*.screenshots' => 'nullable|array|max:50',
            'findings.*.screenshots.*' => 'nullable|string|max:1000',
            'findings.*.updated_at' => 'nullable|string|max:40',
        ]);
        $report->update($data);

        return response()->json(['report' => $report->fresh()]);
    }

    /** Site checks belong to the person who made them; Taskmandu reviews are shared. */
    private function find(Request $request, string $kind, int $id): Model
    {
        return $kind === QaCenterService::ISSUE
            ? PmQaIssue::query()->where('created_by', $request->user()->id)->findOrFail($id)
            : PmQaTaskReview::query()->findOrFail($id);
    }

    private function respond(Model $item, string $kind, Request $request, int $status = 200): JsonResponse
    {
        return response()->json(['item' => $this->qa->present($item->refresh(), $kind, $request->user())], $status);
    }
}
