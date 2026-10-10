<?php

namespace App\Services\Pm;

use App\Models\PmActivity;
use App\Models\PmCard;
use App\Models\PmSubtask;
use App\Models\PmTaskmanduEvent;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use RuntimeException;

class TaskmanduSync
{
    private bool $baseline = false;
    public function __construct(private TaskmanduClient $client) {}
    public function configured(): bool { return $this->client->configured(); }
    public function run(): int { try { $employees=$this->employeeMap(); $count=0; $this->baseline=PmCard::query()->exists(); $count+=$this->syncStandaloneTasks($employees); $count+=$this->syncProjectBoards($employees); try{Cache::forever('pm.last_synced_at',now()->toIso8601String());}catch(\Throwable $e){report($e);} return $count; } catch (\Throwable $e) { throw new RuntimeException('Taskmandu sync failed: '.$e->getMessage(), 0, $e); } }
    public function employeeMap(): array { $map=[]; foreach($this->client->paginate('/employees') as $e){$name=trim(($e['firstName']??'').' '.($e['lastName']??''));foreach(['employeeId','_id','userId'] as $key)if(!empty($e[$key])&&is_string($e[$key]))$map[$e[$key]]=$name;} return $map; }
    private function names(array $employees,array $ids):?string{$names=collect($ids)->map(fn($id)=>$employees[$id]??$id)->filter();return $names->isEmpty()?null:$names->implode(', ');}
    private function syncStandaloneTasks(array $employees):int{$tasks=$this->client->paginate('/tasks');$frontend=rtrim(config('services.taskmandu.frontend_url',''),'/');foreach($tasks as $t){$card=PmCard::firstOrNew(['external_id'=>'task:'.$t['_id']]);[$existed,$oldStatus,$oldComments]=[$card->exists,$card->status,(int)$card->comments_count];$card->fill(['title'=>$t['title'],'description'=>$t['description']??null,'assignee'=>$this->names($employees,$t['assignedToId']??[]),'status'=>$t['status'],'due_at'=>$t['dueDate']??null,'last_activity_at'=>Carbon::parse($t['updatedAt']),'subtasks_count'=>0,'subtasks_completed_count'=>0,'project_id'=>null,'project_name'=>null,'task_id'=>$t['_id'],'priority'=>$t['priority']??null,'estimated_hours'=>$t['estimatedHours']??null,'tags'=>$t['tags']??[],'comments_count'=>count($t['comments']??[]),'assigned_by'=>$t['assignedByName']??null,'url'=>$frontend?"{$frontend}/tasks/{$t['_id']}":null]);$card->save();$this->track($card,$existed,$oldStatus,$oldComments);}return count($tasks);}
    private function syncProjectBoards(array $employees):int{$projects=$this->client->paginate('/projects');$frontend=rtrim(config('services.taskmandu.frontend_url',''),'/');$count=0;$seenSubs=[];foreach($projects as $summary){$p=$this->client->get("/projects/{$summary['_id']}")['data']??$summary;foreach($p['tasks']??[] as $t){$lastComment=collect($t['comments']??[])->last();$lastActivity=collect([$lastComment['createdAt']??null,$t['updatedAt']??null,$t['createdAt']??null])->merge(collect($t['subTasks']??[])->pluck('completedAt'))->filter()->map(fn($at)=>Carbon::parse($at))->max();$card=PmCard::firstOrNew(['external_id'=>"project:{$p['_id']}:task:{$t['_id']}"]);[$existed,$oldStatus,$oldComments]=[$card->exists,$card->status,(int)$card->comments_count];$card->fill(['title'=>$t['title'],'description'=>$t['description']??null,'assignee'=>$this->names($employees,$t['assignedToId']??[]),'status'=>$t['status'],'due_at'=>$t['dueDate']??null,'last_activity_at'=>$lastActivity,'subtasks_count'=>count($t['subTasks']??[]),'subtasks_completed_count'=>$this->completedSubtaskCount($t['subTasks']??[]),'project_id'=>$p['_id'],'project_name'=>$p['name'],'task_id'=>$t['_id'],'priority'=>$t['priority']??null,'estimated_hours'=>$t['estimatedHours']??null,'tags'=>$t['tags']??[],'comments_count'=>count($t['comments']??[]),'assigned_by'=>$t['assignedByName']??null,'url'=>$frontend?"{$frontend}/projects/{$p['_id']}":null]);$card->save();$this->track($card,$existed,$oldStatus,$oldComments);$this->captureStatusEvent($p,$t,$card,$existed,$oldStatus,$t['status']??null,$t['updatedAt']??null);$this->captureComments($p,$t,$card,null,$t['comments']??[]);$count++;$this->syncSubTasks($p,$t,$card,$employees,$seenSubs);}}PmSubtask::query()->whereNotIn('external_id',$seenSubs?:[''])->delete();return $count;}
    private function syncSubTasks(array $project,array $task,PmCard $parent,array $employees,array &$seen):void{
        $frontend=rtrim(config('services.taskmandu.frontend_url',''),'/');
        foreach($task['subTasks']??[] as $s){
            $key="project:{$project['_id']}:task:{$task['_id']}:sub:{$s['_id']}";
            $seen[]=$key;
            $local=PmSubtask::query()->where('external_id',$key)->first();
            $oldStatus=$local?->status;
            $status=(string)($s['status']??'Assigned');
            $completed=$status==='Completed';
            // Older Taskmandu sub-tasks may not have completedAt; updatedAt is the best
            // available timestamp once the status is Completed.
            $completedAt=$completed&&!empty($s['completedAt'])?Carbon::parse($s['completedAt']):($completed&&!empty($s['updatedAt'])?Carbon::parse($s['updatedAt']):null);
            PmSubtask::updateOrCreate(['external_id'=>$key],[
                'project_id'=>$project['_id'],'project_name'=>$project['name'],'task_id'=>$task['_id'],'subtask_id'=>$s['_id'],
                'parent_title'=>$task['title'],'parent_assignee'=>$parent->assignee,'parent_due_at'=>$task['dueDate']??null,
                'title'=>$s['title'],'assignee'=>$this->names($employees,$s['assignedToId']??[]),'assigned_by'=>$s['assignedByName']??null,
                'status'=>$status,'completed_at'=>$completedAt,'comments_count'=>count($s['comments']??[]),
                'remote_created_at'=>!empty($s['createdAt'])?Carbon::parse($s['createdAt']):null,
                'url'=>$frontend?"{$frontend}/projects/{$project['_id']}":null,
            ]);
            if($this->baseline && $oldStatus!==null && $oldStatus!==$status){
                PmActivity::record('subtask_status_change',$parent,[
                    'from'=>$oldStatus,'to'=>$status,'subtask_id'=>(string)$s['_id'],'subtask_title'=>(string)($s['title']??''),
                ]);
                $this->recordTaskmanduEvent([
                    'event_key'=>'substatus:'.$project['_id'].':'.$task['_id'].':'.$s['_id'].':'.$oldStatus.':'.$status.':'.($s['updatedAt']??now()->toIso8601String()),
                    'event_type'=>'subtask_status','project_id'=>(string)$project['_id'],'project_name'=>(string)($project['name']??''),
                    'task_id'=>(string)$task['_id'],'task_title'=>(string)($task['title']??''),'subtask_id'=>(string)$s['_id'],
                    'subtask_title'=>(string)($s['title']??''),'owner_name'=>$parent->assignee,'actor_name'=>null,
                    'body'=>null,'status_from'=>$oldStatus,'status_to'=>$status,'occurred_at'=>$s['updatedAt']??now()->toIso8601String(),
                ]);
            }
            $this->captureComments($project,$task,$parent,(string)($s['title']??''),$s['comments']??[],(string)$s['_id']);
        }
    }
    private function captureComments(array $project,array $task,PmCard $parent,?string $subtaskTitle,array $comments,?string $subtaskId=null):void
    {
        foreach($comments as $comment){
            if(!is_array($comment)) continue;
            $body=trim((string)($comment['text']??$comment['content']??$comment['message']??''));
            $createdAt=$comment['createdAt']??$comment['created_at']??null;
            if($body===''||!$createdAt) continue;
            $author=trim((string)($comment['authorName']??$comment['createdByName']??$comment['userName']??$comment['authorId']??''));
            $sourceId=(string)($comment['_id']??$comment['id']??'');
            $key=$sourceId!==''?'comment:'.$sourceId:'comment:'.sha1(json_encode([$project['_id']??'',$task['_id']??'',$subtaskId,$createdAt,$author,$body]));
            $this->recordTaskmanduEvent([
                'event_key'=>$key,'event_type'=>'comment','project_id'=>(string)($project['_id']??''),
                'project_name'=>(string)($project['name']??''),'task_id'=>(string)($task['_id']??''),
                'task_title'=>(string)($task['title']??''),'subtask_id'=>$subtaskId,'subtask_title'=>$subtaskTitle,
                'owner_name'=>$parent->assignee,'actor_name'=>$author?:null,'body'=>$body,
                'status_from'=>null,'status_to'=>null,'occurred_at'=>$createdAt,
            ]);
        }
    }

    private function captureStatusEvent(array $project,array $task,PmCard $card,bool $existed,?string $oldStatus,?string $newStatus,?string $updatedAt):void
    {
        if(!$this->baseline||!$existed||$oldStatus===null||$newStatus===null||$oldStatus===$newStatus) return;
        $this->recordTaskmanduEvent([
            'event_key'=>'taskstatus:'.($project['_id']??'').':'.($task['_id']??'').':'.$oldStatus.':'.$newStatus.':'.($updatedAt??now()->toIso8601String()),
            'event_type'=>'task_status','project_id'=>(string)($project['_id']??''),'project_name'=>(string)($project['name']??''),
            'task_id'=>(string)($task['_id']??''),'task_title'=>(string)($task['title']??''),'subtask_id'=>null,
            'subtask_title'=>null,'owner_name'=>$card->assignee,'actor_name'=>null,'body'=>null,
            'status_from'=>$oldStatus,'status_to'=>$newStatus,'occurred_at'=>$updatedAt??now()->toIso8601String(),
        ]);
    }

    private function recordTaskmanduEvent(array $event):void
    {
        try {
            PmTaskmanduEvent::firstOrCreate(['event_key'=>$event['event_key']],$event);
        } catch (\Throwable $e) {
            report($e);
        }
    }

    private function completedSubtaskCount(array $subtasks): int
    {
        return collect($subtasks)->filter(fn($s)=>(string)($s['status']??'')==='Completed')->count();
    }
    public function assignSubTask(PmSubtask $sub,string $employeeId):string{$this->client->patch("/projects/{$sub->project_id}/tasks/{$sub->task_id}/subtasks/{$sub->subtask_id}",['assignedToId'=>[$employeeId]]);$name=collect($this->listEmployees())->firstWhere('employeeId',$employeeId)['name']??null;return $name?:$employeeId;}
    public function createSubTask(string $projectId,string $taskId,string $title,string $assigneeEmployeeId,string $assignedByName):array{return $this->client->post("/projects/{$projectId}/tasks/{$taskId}/subtasks",['title'=>$title,'assignedToId'=>[$assigneeEmployeeId],'assignedByName'=>$assignedByName,'status'=>'Assigned']);}
    public function updateTask(string $taskId,string $title,string $description,string $assigneeEmployeeId,string $dueDate,array $extra=[]):array{return $this->client->patch("/tasks/{$taskId}",array_merge(['title'=>$title,'description'=>$description,'assignedToId'=>[$assigneeEmployeeId],'dueDate'=>$dueDate],array_filter($extra,fn($v)=>$v!==null&&$v!==[]&&$v!=='')));}
    public function updateProjectTask(string $projectId,string $taskId,string $title,string $description,string $assigneeEmployeeId,string $assignedByName,string $dueDate,array $extra=[]):array{return $this->client->patch("/projects/{$projectId}/tasks/{$taskId}",array_merge(['title'=>$title,'description'=>$description,'assignedToId'=>[$assigneeEmployeeId],'assignedByName'=>$assignedByName,'dueDate'=>$dueDate],array_filter($extra,fn($v)=>$v!==null&&$v!==[]&&$v!=='')));}
    public function getProjectTask(string $projectId,string $taskId):array{$project=$this->client->get("/projects/{$projectId}")['data']??[];foreach($project['tasks']??[] as $task){if(($task['_id']??null)===$taskId)return $task;}throw new RuntimeException('Taskmandu project task was not found.');}
    public function updateProjectSubTask(string $projectId,string $taskId,string $subTaskId,string $title,string $assigneeEmployeeId):array{return $this->client->patch("/projects/{$projectId}/tasks/{$taskId}/subtasks/{$subTaskId}",['title'=>$title,'assignedToId'=>[$assigneeEmployeeId]]);}
    public function deleteProjectSubTask(string $projectId,string $taskId,string $subTaskId):array{return $this->client->delete("/projects/{$projectId}/tasks/{$taskId}/subtasks/{$subTaskId}");}
    public function syncProjectTaskSubtasks(string $projectId,string $taskId,array $desired,string $assignedByName):array{$task=$this->getProjectTask($projectId,$taskId);$existing=$task['subTasks']??[];$byTitle=collect($existing)->keyBy(fn($s)=>mb_strtolower(trim((string)($s['title']??''))));$matched=[];$created=0;$updated=0;foreach($desired as $sub){$title=trim($sub['title']);$key=mb_strtolower($title);$assignee=$sub['assignee_employee_id'];$current=$byTitle->get($key);if($current){$this->updateProjectSubTask($projectId,$taskId,$current['_id'],$title,$assignee);$matched[]=$current['_id'];$updated++;}else{$this->createSubTask($projectId,$taskId,$title,$assignee,$assignedByName);$created++;}}foreach($existing as $current){if(($current['status']??'')!=='Completed'&&!in_array($current['_id'],$matched,true)&&!collect($desired)->contains(fn($sub)=>mb_strtolower(trim($sub['title']))===mb_strtolower(trim((string)$current['title']))))$this->deleteProjectSubTask($projectId,$taskId,$current['_id']);}return ['created'=>$created,'updated'=>$updated,'total'=>$created+$updated];}
    private function track(PmCard $card,bool $existed,?string $oldStatus,int $oldComments=0):void{if(!$this->baseline)return;if(!$existed)PmActivity::record('created',$card);else{if($oldStatus!==$card->status)PmActivity::record('status_change',$card,['from'=>$oldStatus,'to'=>$card->status]);if((int)$card->comments_count>$oldComments)PmActivity::record('comment',$card,['count'=>(int)$card->comments_count-$oldComments]);}}
    /**
     * Convert one final meeting Work Item into the normal Project -> Tasks structure.
     * This method is intentionally backend-only; the existing Meeting Minutes UI remains unchanged.
     */
    public function syncMeetingWorkItem(
        string $projectId,
        string $title,
        string $description,
        ?string $ownerName,
        ?string $dueDate,
        array $actionItems,
        string $assignedByName,
    ): array {
        $employees = $this->employeeMap();
        $ownerId = $this->employeeIdForName($employees, $ownerName);

        if ($ownerName !== null && trim($ownerName) !== '' && $ownerId === null) {
            throw new RuntimeException("Meeting Work Item owner “{$ownerName}” was not found in Taskmandu employees.");
        }

        $project = $this->client->get("/projects/{$projectId}")['data'] ?? [];
        $existing = collect($project['tasks'] ?? [])->first(
            fn ($task) => mb_strtolower(trim((string) ($task['title'] ?? ''))) === mb_strtolower(trim($title))
        );

        $payload = [
            'title' => $title,
            'description' => $description,
            'assignedToId' => $ownerId ? [$ownerId] : [],
            'assignedByName' => $assignedByName,
            'dueDate' => $dueDate ?: now()->addWeek()->toDateString(),
            'status' => 'Assigned',
        ];

        if ($existing && !empty($existing['_id'])) {
            $this->client->patch("/projects/{$projectId}/tasks/{$existing['_id']}", $payload);
            $taskId = (string) $existing['_id'];
        } else {
            $res = $this->client->post("/projects/{$projectId}/tasks", $payload);
            $updatedProject = $res['data'] ?? [];
            $tasks = collect($updatedProject['tasks'] ?? []);
            $task = $tasks->last(fn ($t) => ($t['title'] ?? null) === $title) ?? $tasks->last() ?? [];
            $taskId = (string) ($task['_id'] ?? '');
            if ($taskId === '') {
                throw new RuntimeException("Taskmandu created meeting task “{$title}” but didn't return its task id.");
            }
        }

        $task = $this->getProjectTask($projectId, $taskId);
        $existingSubs = collect($task['subTasks'] ?? [])->keyBy(
            fn ($sub) => mb_strtolower(trim((string) ($sub['title'] ?? '')))
        );

        foreach ($actionItems as $action) {
            $subTitle = trim((string) ($action['task'] ?? ''));
            if ($subTitle === '') {
                continue;
            }

            $subOwner = trim((string) ($action['owner'] ?? $ownerName ?? ''));
            $subOwnerId = $this->employeeIdForName($employees, $subOwner);
            if ($subOwner !== '' && $subOwnerId === null) {
                throw new RuntimeException("Meeting Action Item owner “{$subOwner}” was not found in Taskmandu employees.");
            }

            $subPayload = [
                'title' => $subTitle,
                'assignedToId' => $subOwnerId ? [$subOwnerId] : [],
                'assignedByName' => $assignedByName,
                'status' => 'Assigned',
            ];
            if (!empty($action['due_date'])) {
                $subPayload['dueDate'] = $action['due_date'];
            }

            $key = mb_strtolower($subTitle);
            $current = $existingSubs->get($key);
            if ($current && !empty($current['_id'])) {
                $this->client->patch("/projects/{$projectId}/tasks/{$taskId}/subtasks/{$current['_id']}", $subPayload);
            } else {
                $this->client->post("/projects/{$projectId}/tasks/{$taskId}/subtasks", $subPayload);
            }
        }

        return ['task_id' => $taskId, 'created' => !$existing];
    }

    private function employeeIdForName(array $employees, ?string $name): ?string
    {
        $needle = mb_strtolower(trim((string) $name));
        if ($needle === '') {
            return null;
        }

        foreach ($employees as $id => $employeeName) {
            if (mb_strtolower(trim($employeeName)) === $needle) {
                return (string) $id;
            }
        }

        return null;
    }

    public function createTask(string $title,string $description,string $assigneeEmployeeId,string $dueDate,array $extra=[],string $fallbackLine=''):array{[$res,$fallback]=$this->postWithFallback('/tasks',['title'=>$title,'description'=>$description,'assignedToId'=>[$assigneeEmployeeId],'dueDate'=>$dueDate,'status'=>'Assigned'],$extra,$fallbackLine);return ['data'=>$res['data']??[],'fallback'=>$fallback];}
    public function createProjectTask(string $projectId,string $title,string $description,string $assigneeEmployeeId,string $assignedByName,string $dueDate,array $extra=[],string $fallbackLine=''):array{[$res,$fallback]=$this->postWithFallback("/projects/{$projectId}/tasks",['title'=>$title,'description'=>$description,'assignedToId'=>[$assigneeEmployeeId],'assignedByName'=>$assignedByName,'dueDate'=>$dueDate,'status'=>'Assigned'],$extra,$fallbackLine);$project=$res['data']??[];$tasks=collect($project['tasks']??[]);$task=$tasks->last(fn($t)=>($t['title']??null)===$title)??$tasks->last()??[];return ['project'=>$project,'task'=>$task,'fallback'=>$fallback];}
    private function postWithFallback(string $path,array $base,array $extra,string $fallbackLine):array{$extra=array_filter($extra,fn($v)=>$v!==null&&$v!==[]&&$v!=='');if(!$extra)return[$this->client->post($path,$base),false];try{return[$this->client->post($path,$base+$extra),false];}catch(RuntimeException $e){if(!preg_match('/\((400|422)\)/',$e->getMessage()))throw $e;$base['description']=trim(($base['description']??'')."\n\n".$fallbackLine);return[$this->client->post($path,$base),true];}}
    public function listEmployees():array{return collect($this->client->paginate('/employees'))->map(fn($e)=>['employeeId'=>$e['employeeId'],'id'=>$e['_id']??null,'name'=>trim($e['firstName'].' '.$e['lastName']),'designation'=>$e['designation']??null])->values()->all();}

    /** Deletes a ticket the PM pushed, by the exact Taskmandu id recorded at push time. */
    public function deletePushedTask(string $taskId, ?string $projectId = null): void
    {
        $path = $projectId ? "/projects/{$projectId}/tasks/{$taskId}" : "/tasks/{$taskId}";
        $this->client->delete($path);
    }
}
