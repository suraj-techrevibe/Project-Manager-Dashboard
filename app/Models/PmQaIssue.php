<?php

namespace App\Models;

use App\Services\Pm\QaCenterService;
use App\Services\Pm\QaCodeService;
use App\Services\Pm\QaStage;
use Illuminate\Database\Eloquent\Model;

class PmQaIssue extends Model
{
    protected $fillable = [
        'created_by','record_type','business','site_app','project_id','project_name','task_id','task_title','subtask_id','subtask_title','page_url','title','description','expected_behaviour','developer_notes','severity','status','assignee','evidence_url','pm_task_url','retest_notes',
        // QA Center pipeline fields
        'qa_code','qa_stage','qa_remarks','qa_fail_note','qa_screenshots','qa_history',
    ];

    protected $casts = ['qa_screenshots' => 'array', 'qa_history' => 'array'];

    protected static function booted(): void
    {
        // Every finding gets its per-business QA code once, when it is created, whichever screen created it.
        static::creating(function (self $issue) {
            if (blank($issue->qa_code)) {
                $business = filled($issue->business) ? $issue->business : app(QaCenterService::class)->detectBusinessFor($issue);
                $issue->qa_code = app(QaCodeService::class)->assign($business);
            }
            if (blank($issue->qa_stage)) {
                $issue->qa_stage = QaStage::fromIssueStatus($issue->status ?: 'Draft');
            }
        });

        // Older screens still change `status`; keep the pipeline stage in step with it.
        static::updating(function (self $issue) {
            if ($issue->isDirty('status') && ! $issue->isDirty('qa_stage')) {
                $issue->qa_stage = QaStage::fromIssueStatus($issue->status);
            }
        });
    }
}
