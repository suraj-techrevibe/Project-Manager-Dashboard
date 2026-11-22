<?php

namespace App\Http\Controllers;

use App\Models\PmActionItem;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class PmActionItemController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $items = PmActionItem::where('user_id', $request->user()->id)
            ->orderByRaw("CASE status WHEN 'Open' THEN 0 WHEN 'Waiting' THEN 1 ELSE 2 END")
            ->orderByRaw("CASE priority WHEN 'High' THEN 0 WHEN 'Medium' THEN 1 ELSE 2 END")
            ->latest()->limit(500)->get();

        return response()->json(['items' => $items]);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'kind' => ['required', Rule::in(['Action', 'Rough note'])],
            'title' => 'required|string|max:200',
            'notes' => 'nullable|string|max:5000',
            'business' => 'nullable|string|max:160',
            'project_name' => 'nullable|string|max:200',
            'source' => 'required|string|max:80',
            'priority' => ['required', Rule::in(['High', 'Medium', 'Low'])],
            'due_date' => 'nullable|date',
        ]);
        $data['user_id'] = $request->user()->id;
        $item = PmActionItem::create($data);
        return response()->json(['item' => $item], 201);
    }

    public function update(Request $request, PmActionItem $item): JsonResponse
    {
        abort_unless($item->user_id === $request->user()->id, 404);
        $data = $request->validate([
            'kind' => ['sometimes', Rule::in(['Action', 'Rough note'])],
            'title' => 'sometimes|required|string|max:200',
            'notes' => 'nullable|string|max:5000',
            'business' => 'nullable|string|max:160',
            'project_name' => 'nullable|string|max:200',
            'priority' => ['sometimes', Rule::in(['High', 'Medium', 'Low'])],
            'status' => ['sometimes', Rule::in(['Open', 'Waiting', 'Done', 'Archived'])],
            'due_date' => 'nullable|date',
        ]);
        if (($data['status'] ?? null) === 'Done') $data['completed_at'] = $item->completed_at ?? now();
        elseif (isset($data['status']) && $data['status'] !== 'Done') $data['completed_at'] = null;
        $item->update($data);
        return response()->json(['item' => $item->fresh()]);
    }

    public function destroy(Request $request, PmActionItem $item): JsonResponse
    {
        abort_unless($item->user_id === $request->user()->id, 404);
        $item->delete();
        return response()->json(['deleted' => true]);
    }
}
