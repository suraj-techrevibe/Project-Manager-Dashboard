<?php

namespace App\Http\Controllers;

use App\Models\PmQaDeskItem;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

class PmQaDeskController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        return response()->json([
            'items' => PmQaDeskItem::query()
                ->where('created_by', $request->user()->id)
                ->latest('updated_at')
                ->limit(500)
                ->get(),
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'title' => 'required|string|max:200',
            'business' => 'nullable|string|max:160',
            'site_app' => 'nullable|string|max:200',
            'source' => ['required', Rule::in(['Taskmandu', 'Site check', 'Client report'])],
            'source_id' => 'nullable|string|max:100',
            'assignee' => 'nullable|string|max:160',
            'url' => 'nullable|url|max:1000',
            'checks' => 'nullable|array|max:40',
            'checks.*.id' => 'required_with:checks|string|max:40',
            'checks.*.text' => 'required_with:checks|string|max:160',
            'checks.*.done' => 'sometimes|boolean',
        ]);

        if (!empty($data['source_id'])) {
            $existing = PmQaDeskItem::query()
                ->where('created_by', $request->user()->id)
                ->where('source', $data['source'])
                ->where('source_id', $data['source_id'])
                ->first();
            if ($existing) {
                return response()->json(['item' => $existing, 'existing' => true]);
            }
        }

        $now = now()->toIso8601String();
        $item = PmQaDeskItem::create([
            ...$data,
            'created_by' => $request->user()->id,
            'status' => 'queue',
            'checks' => $data['checks'] ?? [],
            'screenshots' => [],
            'fail_note' => null,
            'history' => [['at' => $now, 'message' => 'Added to QA queue']],
        ]);

        return response()->json(['item' => $item], 201);
    }

    public function update(Request $request, PmQaDeskItem $item): JsonResponse
    {
        abort_unless($item->created_by === $request->user()->id, 404);

        $data = $request->validate([
            'title' => 'sometimes|required|string|max:200',
            'business' => 'nullable|string|max:160',
            'site_app' => 'nullable|string|max:200',
            'assignee' => 'nullable|string|max:160',
            'url' => 'nullable|url|max:1000',
            'status' => ['sometimes', Rule::in(['queue', 'testing', 'failed', 'passed'])],
            'checks' => 'sometimes|array|max:40',
            'checks.*.id' => 'required|string|max:40',
            'checks.*.text' => 'required|string|max:160',
            'checks.*.done' => 'required|boolean',
            'fail_note' => 'nullable|string|max:5000',
        ]);

        $before = $item->status;
        $item->fill($data);
        $history = $item->history ?? [];
        if (isset($data['status']) && $data['status'] !== $before) {
            $labels = ['queue' => 'Queue', 'testing' => 'Testing', 'failed' => 'Failed and sent back', 'passed' => 'Passed'];
            $history[] = ['at' => now()->toIso8601String(), 'message' => $labels[$data['status']] ?? $data['status']];
        }
        if (array_key_exists('fail_note', $data) && $data['fail_note']) {
            $history[] = ['at' => now()->toIso8601String(), 'message' => 'Failure note updated'];
        }
        $item->history = array_slice($history, -40);
        $item->save();

        return response()->json(['item' => $item->fresh()]);
    }

    public function destroy(Request $request, PmQaDeskItem $item): JsonResponse
    {
        abort_unless($item->created_by === $request->user()->id, 404);
        foreach (($item->screenshots ?? []) as $shot) {
            if (!empty($shot['path'])) Storage::disk('public')->delete($shot['path']);
        }
        $item->delete();

        return response()->json(['deleted' => true]);
    }

    public function storeScreenshot(Request $request, PmQaDeskItem $item): JsonResponse
    {
        abort_unless($item->created_by === $request->user()->id, 404);
        $data = $request->validate(['file' => 'required|image|max:5120']);
        $file = $data['file'];
        $path = $file->store('qa-desk/'.$request->user()->id, 'public');
        $shots = $item->screenshots ?? [];
        $shots[] = [
            'id' => (string) Str::uuid(),
            'name' => $file->getClientOriginalName(),
            'path' => $path,
            'url' => Storage::disk('public')->url($path),
            'created_at' => now()->toIso8601String(),
        ];
        $item->screenshots = $shots;
        $item->save();

        return response()->json(['item' => $item->fresh(), 'screenshot' => end($shots)], 201);
    }

    public function destroyScreenshot(Request $request, PmQaDeskItem $item, string $screenshot): JsonResponse
    {
        abort_unless($item->created_by === $request->user()->id, 404);
        $shots = $item->screenshots ?? [];
        $target = collect($shots)->firstWhere('id', $screenshot);
        if (!$target) abort(404);
        if (!empty($target['path'])) Storage::disk('public')->delete($target['path']);
        $item->screenshots = array_values(array_filter($shots, fn ($shot) => ($shot['id'] ?? null) !== $screenshot));
        $history = $item->history ?? [];
        $history[] = ['at' => now()->toIso8601String(), 'message' => 'Screenshot removed'];
        $item->history = array_slice($history, -40);
        $item->save();

        return response()->json(['item' => $item->fresh()]);
    }
}
