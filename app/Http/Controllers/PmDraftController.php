<?php

namespace App\Http\Controllers;

use App\Models\PmDraft;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * Saved drafts for "Brief to tickets". Pure local storage — pushing to
 * Taskmandu still goes through PmController::push; the browser then saves the
 * per-ticket results back here so a draft remembers what was already pushed.
 */
class PmDraftController extends Controller
{
    public function index(): JsonResponse
    {
        $drafts = PmDraft::query()
            ->latest('updated_at')
            ->limit(50)
            ->get()
            ->map(fn (PmDraft $d) => $this->summary($d))
            ->all();

        return response()->json(['drafts' => $drafts]);
    }

    public function show(PmDraft $draft): JsonResponse
    {
        return response()->json(['draft' => $this->full($draft)]);
    }

    public function store(Request $r): JsonResponse
    {
        return $this->save(new PmDraft(['created_by' => $r->user()?->name]), $r);
    }

    public function update(Request $r, PmDraft $draft): JsonResponse
    {
        return $this->save($draft, $r);
    }

    public function destroy(PmDraft $draft): JsonResponse
    {
        $draft->delete();

        return response()->json(['ok' => true]);
    }

    private function save(PmDraft $draft, Request $r): JsonResponse
    {
        // Drafts are works in progress, so this is deliberately lenient: blank
        // titles, no assignee etc. are fine here. push() enforces the real rules.
        $data = $r->validate([
            'title' => 'nullable|string|max:200',
            'brief' => 'nullable|string|max:8000',
            'project_id' => ['nullable', 'regex:/^[0-9a-fA-F]{24}$/'],
            'tickets' => 'present|array|max:30',
            'tickets.*.uid' => 'required|string|max:40',
            'tickets.*.title' => 'nullable|string|max:200',
            'tickets.*.description' => 'nullable|string|max:3000',
            'tickets.*.level' => 'nullable|string|max:20',
            'tickets.*.estimate_hours' => 'nullable|numeric|min:0|max:1000',
            'tickets.*.priority' => ['nullable', Rule::in(['Low', 'Medium', 'High', 'Critical'])],
            'tickets.*.assigneeId' => 'nullable|string|max:100',
            'tickets.*.dueDate' => 'nullable|date_format:Y-m-d',
            'tickets.*.state' => ['nullable', Rule::in(['draft', 'pushed', 'failed'])],
            'tickets.*.error' => 'nullable|string|max:500',
        ]);

        // Normalise to exactly the shape the editor expects (no nulls).
        $tickets = collect($data['tickets'])->map(fn ($t) => [
            'uid' => (string) $t['uid'],
            'title' => (string) ($t['title'] ?? ''),
            'description' => (string) ($t['description'] ?? ''),
            'level' => (string) ($t['level'] ?? 'intern'),
            'estimate_hours' => isset($t['estimate_hours']) ? (float) $t['estimate_hours'] : '',
            'priority' => $t['priority'] ?? 'Medium',
            'assigneeId' => (string) ($t['assigneeId'] ?? ''),
            'dueDate' => (string) ($t['dueDate'] ?? ''),
            'state' => $t['state'] ?? 'draft',
            'error' => $t['error'] ?? null,
        ])->values()->all();

        $pushed = collect($tickets)->where('state', 'pushed')->count();
        $status = $tickets === [] || $pushed === 0 ? 'draft' : ($pushed === count($tickets) ? 'pushed' : 'partial');

        $draft->fill([
            'title' => $this->titleFor($data['title'] ?? null, $data['brief'] ?? null, $draft),
            'brief' => $data['brief'] ?? null,
            'project_id' => $data['project_id'] ?? null,
            'tickets' => $tickets,
            'status' => $status,
        ])->save();

        return response()->json(['draft' => $this->summary($draft)]);
    }

    /** Explicit title wins; otherwise the first line of the brief; otherwise keep / "Untitled draft". */
    private function titleFor(?string $title, ?string $brief, PmDraft $draft): string
    {
        if (filled($title)) {
            return mb_substr(trim($title), 0, 200);
        }
        if ($draft->exists && filled($draft->title) && $draft->title !== 'Untitled draft') {
            return $draft->title;
        }
        $first = collect(preg_split('/\R/', (string) $brief))->map(fn ($l) => trim((string) $l))->first(fn ($l) => $l !== '');

        return $first ? mb_substr(ltrim($first, "-*#• \t"), 0, 80) : 'Untitled draft';
    }

    private function summary(PmDraft $d): array
    {
        $tickets = $d->tickets ?? [];

        return [
            'id' => $d->id,
            'title' => $d->title,
            'status' => $d->status,
            'total' => count($tickets),
            'pushed' => collect($tickets)->where('state', 'pushed')->count(),
            'project_id' => $d->project_id,
            'updated_at' => $d->updated_at?->toIso8601String(),
        ];
    }

    private function full(PmDraft $d): array
    {
        return $this->summary($d) + [
            'brief' => (string) $d->brief,
            'tickets' => $d->tickets ?? [],
        ];
    }
}
