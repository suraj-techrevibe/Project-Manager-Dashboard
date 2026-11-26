<?php

namespace App\Http\Controllers;

use App\Models\PmInvestigation;
use App\Services\Pm\Investigation\InvestigationService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * Command Center → Team Workload → Investigation. Everything is stored in this dashboard's database.
 * Nothing here writes to Taskmandu: follow-up recommendations are proposals until you create tasks yourself.
 */
class PmInvestigationController extends Controller
{
    public function __construct(private InvestigationService $svc) {}

    public function index(Request $r): JsonResponse
    {
        $f = $r->validate([
            'developer' => 'nullable|string|max:160',
            'project_id' => 'nullable|string|max:64',
            'status' => 'nullable|string|max:200',
            'priority' => ['nullable', Rule::in(PmInvestigation::PRIORITIES)],
            'date_from' => 'nullable|date_format:Y-m-d',
            'date_to' => 'nullable|date_format:Y-m-d',
            'search' => 'nullable|string|max:200',
            'page' => 'nullable|integer|min:1',
            'per_page' => 'nullable|integer|min:5|max:100',
        ]);

        $warnings = [];
        $coverage = $this->svc->coverage($warnings);

        return response()->json($this->svc->list($f) + [
            'summary' => $this->svc->summary($coverage['needing']),
            'warnings' => array_values(array_unique($warnings)),
        ]);
    }

    /** Developers, projects and the default checklist for the Assign form. */
    public function options(): JsonResponse
    {
        $warnings = [];

        return response()->json([
            'developers' => $this->svc->developers($warnings),
            'projects' => $this->svc->projects($warnings)->values(),
            'default_checklist' => InvestigationService::DEFAULT_CHECKLIST,
            'warnings' => array_values(array_unique($warnings)),
        ]);
    }

    public function coverage(): JsonResponse
    {
        $warnings = [];
        $c = $this->svc->coverage($warnings);

        return response()->json($c + ['warnings' => array_values(array_unique($warnings))]);
    }

    /** For the Workload view: active investigations per developer. Not counted as task hours. */
    public function byDeveloper(): JsonResponse
    {
        return response()->json(['developers' => $this->svc->byDeveloper()]);
    }

    public function show(PmInvestigation $investigation): JsonResponse
    {
        return response()->json(['investigation' => $this->svc->present($investigation->load('events'), true)]);
    }

    public function store(Request $r): JsonResponse
    {
        $d = $r->validate($this->assignmentRules() + [
            'project_id' => 'required|string|max:64',
            'project_name' => 'nullable|string|max:200',
            'developer_name' => 'required|string|max:160',
            'developer_employee_id' => 'nullable|string|max:64',
        ]);
        $i = $this->svc->assign($d, $r->user()?->id, $r->user()?->name);

        return response()->json(['investigation' => $this->svc->present($i->load('events'), true)], 201);
    }

    public function update(Request $r, PmInvestigation $investigation): JsonResponse
    {
        $d = $r->validate($this->assignmentRules(partial: true) + ['developer_name' => 'sometimes|string|max:160']);
        $i = $this->svc->updateAssignment($investigation, $d, $r->user()?->name);

        return response()->json(['investigation' => $this->svc->present($i->fresh('events'), true)]);
    }

    public function reassign(Request $r, PmInvestigation $investigation): JsonResponse
    {
        $d = $r->validate(['developer_name' => 'required|string|max:160', 'developer_employee_id' => 'nullable|string|max:64', 'note' => 'nullable|string|max:1000']);
        $i = $this->svc->reassign($investigation, $d['developer_name'], $d['developer_employee_id'] ?? null, $d['note'] ?? null, $r->user()?->name);

        return response()->json(['investigation' => $this->svc->present($i->fresh('events'), true)]);
    }

    public function findings(Request $r, PmInvestigation $investigation): JsonResponse
    {
        $d = $r->validate([
            'areas_reviewed' => 'sometimes|nullable|string|max:20000',
            'findings' => 'sometimes|nullable|string|max:50000',
            'issues' => 'sometimes|nullable|string|max:50000',
            'recommendations' => 'sometimes|nullable|string|max:50000',
            'notes' => 'sometimes|nullable|string|max:20000',
            'effort_estimate' => 'sometimes|nullable|string|max:120',
            'checklist' => 'sometimes|array|max:60',
            'checklist.*.id' => 'nullable|string|max:60',
            'checklist.*.label' => 'required|string|max:200',
            'checklist.*.done' => 'nullable|boolean',
            'evidence' => 'sometimes|nullable|array|max:50',
            'evidence.*.label' => 'nullable|string|max:200',
            'evidence.*.url' => 'nullable|string|max:1000',
            'followups' => 'sometimes|nullable|array|max:50',
            'followups.*.uid' => 'nullable|string|max:60',
            'followups.*.title' => 'required|string|max:200',
            'followups.*.description' => 'nullable|string|max:5000',
            'followups.*.effort' => 'nullable|string|max:60',
            'followups.*.priority' => ['nullable', Rule::in(PmInvestigation::PRIORITIES)],
        ]);
        $i = $this->svc->saveFindings($investigation, $d, $r->user()?->name);

        return response()->json(['investigation' => $this->svc->present($i->fresh('events'), true)]);
    }

    public function review(Request $r, PmInvestigation $investigation): JsonResponse
    {
        $d = $r->validate([
            'review_comments' => 'sometimes|nullable|string|max:20000',
            'followups' => 'sometimes|array|max:50',
            'followups.*.uid' => 'required|string|max:60',
            'followups.*.convert' => 'nullable|boolean',
            'followups.*.reference' => 'nullable|string|max:300',
        ]);
        $i = $this->svc->saveReview($investigation, $d, $r->user()?->name);

        return response()->json(['investigation' => $this->svc->present($i->fresh('events'), true)]);
    }

    /** start, submit, review, return, close, reopen. */
    public function transition(Request $r, PmInvestigation $investigation): JsonResponse
    {
        $d = $r->validate(['action' => ['required', Rule::in(['start', 'submit', 'review', 'return', 'close', 'reopen'])], 'comments' => 'nullable|string|max:20000']);
        $i = $this->svc->transition($investigation, $d['action'], $r->user()?->name, $d['comments'] ?? null);

        return response()->json(['investigation' => $this->svc->present($i->fresh('events'), true)]);
    }

    private function assignmentRules(bool $partial = false): array
    {
        $req = $partial ? 'sometimes' : 'nullable';

        return [
            'assigned_on' => "{$req}|date_format:Y-m-d",
            'due_date' => 'sometimes|nullable|date_format:Y-m-d|after_or_equal:assigned_on',
            'priority' => ['sometimes', Rule::in(PmInvestigation::PRIORITIES)],
            'scope' => 'sometimes|nullable|string|max:20000',
            'instructions' => 'sometimes|nullable|string|max:20000',
            'deliverables' => 'sometimes|nullable|string|max:20000',
            'checklist' => 'sometimes|nullable|array|max:60',
            'checklist.*.id' => 'nullable|string|max:60',
            'checklist.*.label' => 'required|string|max:200',
            'checklist.*.done' => 'nullable|boolean',
        ];
    }
}
