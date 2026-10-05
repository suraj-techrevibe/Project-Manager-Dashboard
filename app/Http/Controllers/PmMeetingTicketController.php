<?php

namespace App\Http\Controllers;

use App\Models\PmActivity;
use App\Models\PmCard;
use App\Services\Pm\TaskmanduSync;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;
use RuntimeException;

class PmMeetingTicketController extends Controller
{
    public function __construct(private TaskmanduSync $taskmandu) {}

    public function push(Request $request): JsonResponse
    {
        $data = Validator::make($request->all(), [
            'tickets'=>'required|array|min:1|max:30','tickets.*.title'=>'required|string|max:200','tickets.*.description'=>'nullable|string|max:3000','tickets.*.level'=>'nullable|string|max:30','tickets.*.estimate_hours'=>'nullable|numeric|min:0|max:1000','tickets.*.priority'=>['nullable',Rule::in(['Low','Medium','High','Critical'])],'tickets.*.assignee_employee_id'=>'required|string|max:100','tickets.*.due_date'=>'nullable|date_format:Y-m-d','tickets.*.project_id'=>['nullable','regex:/^[0-9a-fA-F]{24}$/'],'tickets.*.project_confirmed'=>'boolean','tickets.*.subtasks'=>'nullable|array|max:50','tickets.*.subtasks.*.title'=>'required|string|max:300','tickets.*.subtasks.*.assignee_employee_id'=>'required|string|max:100','tickets.*.subtasks.*.due_date'=>'nullable|date_format:Y-m-d',
        ])->validate();
        $employees=$this->taskmandu->employeeMap(); $results=[];
        foreach($data['tickets'] as $i=>$ticket){try{$results[]=['index'=>$i]+$this->pushOne($ticket,$employees,(string)$request->user()?->name);}catch(RuntimeException $e){$results[]=['index'=>$i,'ok'=>false,'error'=>$e->getMessage()];}}
        $ok=collect($results)->where('ok',true); $updated=$ok->where('action','updated')->count(); $newlyCreated=$ok->where('action','created')->count(); return response()->json(['results'=>$results,'created'=>$ok->count(),'newly_created'=>$newlyCreated,'updated'=>$updated,'failed'=>count($results)-$ok->count()]);
    }

    private function pushOne(array $ticket,array $employees,string $assignedBy):array
    {
        $projectId=$ticket['project_id']??null; $subtasks=$ticket['subtasks']??[];
        if(!$projectId && $subtasks) throw new RuntimeException('A meeting Work Item with Action Items must have a confirmed project so its Subtasks can be created.');
        if($projectId && empty($ticket['project_confirmed'])) throw new RuntimeException('Project confirmation is required before this Work Item can be pushed.');
        $assigneeId=$ticket['assignee_employee_id']; $due=$ticket['due_date']??now()->addWeek()->toDateString(); $priority=$ticket['priority']??'Medium'; $hours=isset($ticket['estimate_hours'])?(float)$ticket['estimate_hours']:null; $level=$ticket['level']??null; $extra=['priority'=>$priority,'estimatedHours'=>$hours,'tags'=>$level?[$level]:[]]; $fallback='Level: '.($level?:'-').' | Est: '.($hours??'?').'h | Priority: '.$priority;

        $existing=$projectId
            ? PmCard::query()->where('project_id',$projectId)->where('title',$ticket['title'])->whereNotNull('task_id')->first()
            : PmCard::query()->whereNull('project_id')->where('title',$ticket['title'])->whereNotNull('task_id')->first();

        if($existing){
            $taskId=(string)$existing->task_id;
            if($projectId){
                $task=$this->taskmandu->getProjectTask($projectId,$taskId);
                $res=$this->taskmandu->updateProjectTask($projectId,$taskId,$ticket['title'],trim($ticket['description']??''),$assigneeId,$assignedBy,$due,$extra);
                $subSync=$this->taskmandu->syncProjectTaskSubtasks($projectId,$taskId,$subtasks,$assignedBy);
                $projectName=$existing->project_name??$ticket['project_name']??null; $updatedTasks=$res['data']['tasks']??[]; $task=collect($updatedTasks)->firstWhere('_id',$taskId)??$this->taskmandu->getProjectTask($projectId,$taskId); $subtasksCount=count($subtasks);
                $url=rtrim((string)config('services.taskmandu.frontend_url'),'/')."/projects/{$projectId}";
            } else {
                $res=$this->taskmandu->updateTask($taskId,$ticket['title'],trim($ticket['description']??''),$assigneeId,$due,$extra); $task=$res['data']??[]; $projectName=null; $subtasksCount=0; $subSync=['created'=>0,'updated'=>0,'total'=>0]; $url=rtrim((string)config('services.taskmandu.frontend_url'),'/')."/tasks/{$taskId}";
            }
            $attrs=['title'=>$ticket['title'],'description'=>$task['description']??$ticket['description']??'','assignee'=>$employees[$assigneeId]??$assigneeId,'status'=>$task['status']??$existing->status??'Assigned','priority'=>$task['priority']??$priority,'due_at'=>$task['dueDate']??$due,'estimated_hours'=>$task['estimatedHours']??$hours,'tags'=>$task['tags']??($level?[$level]:[]),'subtasks_count'=>$subtasksCount,'project_id'=>$projectId,'project_name'=>$projectName,'task_id'=>$taskId,'assigned_by'=>$assignedBy?:null,'url'=>$url,'last_activity_at'=>now()];
            $existing->fill($attrs)->save(); PmActivity::record('updated',$existing,['project'=>$projectName,'subtasks_created'=>$subSync['created']??0,'subtasks_updated'=>$subSync['updated']??0]);
            return ['ok'=>true,'action'=>'updated','task_id'=>$taskId,'card_id'=>$existing->id,'fields_fallback'=>false,'subtasks_created'=>$subSync['created']??0,'subtasks_updated'=>$subSync['updated']??0];
        }

        if($projectId){$res=$this->taskmandu->createProjectTask($projectId,$ticket['title'],trim($ticket['description']??''),$assigneeId,$assignedBy,$due,$extra,$fallback);$task=$res['task'];$taskId=$task['_id']??null;$projectName=$res['project']['name']??($ticket['project_name']??null);$externalId=$taskId?"project:{$projectId}:task:{$taskId}":null;$url=rtrim((string)config('services.taskmandu.frontend_url'),'/')."/projects/{$projectId}";}else{$res=$this->taskmandu->createTask($ticket['title'],trim($ticket['description']??''),$assigneeId,$due,$extra,$fallback);$task=$res['data'];$taskId=$task['_id']??null;$projectName=null;$externalId=$taskId?"task:{$taskId}":null;$url=$taskId?rtrim((string)config('services.taskmandu.frontend_url'),'/')."/tasks/{$taskId}":null;}
        if(!$taskId)throw new RuntimeException('Taskmandu created the task but did not return its task id.');
        $subtasksCreated=0; foreach($subtasks as $sub){$this->taskmandu->createSubTask($projectId,$taskId,trim($sub['title']),$sub['assignee_employee_id'],$assignedBy);$subtasksCreated++;}
        $attrs=['title'=>$ticket['title'],'description'=>$task['description']??($res['fallback']?trim(($ticket['description']??'')."\n\n".$fallback):($ticket['description']??'')),'assignee'=>$employees[$assigneeId]??$assigneeId,'status'=>$task['status']??'Assigned','priority'=>$task['priority']??($res['fallback']?null:$priority),'due_at'=>$due,'estimated_hours'=>$task['estimatedHours']??$hours,'tags'=>$task['tags']??($level?[$level]:[]),'subtasks_count'=>$subtasksCreated,'comments_count'=>0,'assigned_by'=>$assignedBy?:null,'project_id'=>$projectId,'project_name'=>$projectName,'task_id'=>$taskId,'url'=>$url,'last_activity_at'=>now()];
        $card=$externalId?PmCard::updateOrCreate(['external_id'=>$externalId],$attrs):PmCard::create($attrs); PmActivity::record('pushed',$card,['project'=>$projectName,'subtasks'=>$subtasksCreated]);
        return ['ok'=>true,'action'=>'created','task_id'=>$taskId,'card_id'=>$card->id,'fields_fallback'=>$res['fallback'],'subtasks_created'=>$subtasksCreated,'subtasks_updated'=>0];
    }
}
