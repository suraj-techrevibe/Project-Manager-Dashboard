<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class PmQaIssue extends Model
{
    protected $fillable = ['created_by','business','site_app','project_id','project_name','task_id','task_title','subtask_id','subtask_title','page_url','title','description','expected_behaviour','developer_notes','severity','status','assignee','evidence_url','pm_task_url','retest_notes'];

    public function evidenceFiles()
    {
        return $this->hasMany(PmQaEvidence::class)->orderBy('id');
    }
}