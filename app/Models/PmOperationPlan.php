<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class PmOperationPlan extends Model
{
    protected $table = 'pm_operation_plans';

    protected $guarded = [];

    protected $casts = [
        'proposed_tasks' => 'array',
        'timeline' => 'array',
        'submitted_at' => 'datetime',
        'reviewed_at' => 'datetime',
        'archived_at' => 'datetime',
    ];

    public function business(): BelongsTo
    {
        return $this->belongsTo(PmBusiness::class, 'business_id');
    }

    public function goal(): BelongsTo
    {
        return $this->belongsTo(PmOperationGoal::class, 'goal_id');
    }

    public function revisions(): HasMany
    {
        return $this->hasMany(PmOperationPlanRevision::class, 'plan_id')->orderByDesc('revision_number');
    }
}
