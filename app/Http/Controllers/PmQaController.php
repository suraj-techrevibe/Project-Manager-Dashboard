<?php

namespace App\Http\Controllers;

use App\Models\PmQaIssue;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class PmQaController extends Controller
{
    public function index(Request $request): JsonResponse {
        return response()->json(['issues' => PmQaIssue::where('created_by', $request->user()->id)->latest()->limit(300)->get()]);
    }
    public function store(Request $request): JsonResponse {
        $data = $request->validate([
            'business'=>'nullable|string|max:160','site_app'=>'nullable|string|max:200','page_url'=>'nullable|string|max:500',
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
            'business'=>'nullable|string|max:160','site_app'=>'nullable|string|max:200','page_url'=>'nullable|string|max:500',
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