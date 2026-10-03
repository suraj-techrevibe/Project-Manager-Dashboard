<?php

namespace App\Http\Controllers;

use App\Models\PmReport;
use App\Services\Pm\ReportService;
use App\Services\Pm\TaskmanduSync;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Throwable;

class ReportController extends Controller
{
    public function __construct(
        private ReportService $reports,
        private TaskmanduSync $taskmandu,
    ) {}

    public function index(): JsonResponse
    {
        return response()->json([
            'reports' => PmReport::query()->orderByDesc('report_date')->orderBy('kind')->limit(120)->get()->map(fn ($r) => $this->present($r))->all(),
        ]);
    }

    public function store(Request $r): JsonResponse
    {
        $data = $r->validate([
            'date' => 'nullable|date_format:Y-m-d|before_or_equal:today',
            'notes' => 'nullable|string|max:6000',
            'sync' => 'nullable|boolean',
            'kind' => 'nullable|in:daily,weekly',
        ], [
            'date.before_or_equal' => 'Pick today or an earlier date — a report can’t be written for a day that hasn’t happened.',
            'notes.max' => 'The custom text is over the 6,000 character limit.',
        ]);

        // Refresh from Taskmandu first so the report reflects what is on the board now.
        // A failure here is reported, not fatal: the report is still built from the last sync.
        $warning = null;
        if (($data['sync'] ?? true) && $this->taskmandu->configured()) {
            try {
                $this->taskmandu->run();
            } catch (Throwable $e) {
                $warning = 'Couldn’t refresh from Taskmandu ('.$e->getMessage().') — used the last synced data.';
            }
        }

        $report = $this->reports->generate(
            isset($data['date']) ? Carbon::parse($data['date']) : now(),
            $data['notes'] ?? null,
            (string) ($r->user()?->name ?? 'PM'),
            kind: $data['kind'] ?? 'daily',
        );

        return response()->json(['report' => $this->present($report), 'warning' => $warning], 201);
    }

    public function destroy(PmReport $report): JsonResponse
    {
        $report->delete();

        return response()->json(['deleted' => true]);
    }

    private function present(PmReport $r): array
    {
        return [
            'id' => $r->id,
            'kind' => $r->kind,
            'report_date' => $r->report_date,
            'auto' => $r->auto,
            'generated_by' => $r->generated_by,
            'generated_at' => $r->updated_at?->toIso8601String(),
            'notes' => $r->notes,
            'body' => $r->body,
            'content' => $r->content,
        ];
    }
}
