<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class PmOperationPlanRevision extends Model
{
    protected $table = 'pm_operation_plan_revisions';

    protected $guarded = [];

    protected $casts = ['snapshot' => 'array'];

    public function plan(): BelongsTo
    {
        return $this->belongsTo(PmOperationPlan::class, 'plan_id');
    }
}
