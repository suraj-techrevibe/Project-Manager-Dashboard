<?php

namespace App\Http\Controllers;

use App\Models\PmQaCheck;
use App\Models\PmQaIssue;
use App\Models\PmQaTaskReview;
use App\Services\Pm\QaCenterService;
use App\Services\Pm\QaStage;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
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
