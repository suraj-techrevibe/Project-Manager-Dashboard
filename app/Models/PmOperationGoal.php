<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class PmOperationGoal extends Model
{
    protected $table = 'pm_operation_goals';

    protected $guarded = [];

    protected $casts = [
        'target_date' => 'date:Y-m-d',
        'start_date' => 'date:Y-m-d',
    ];

    public function business(): BelongsTo
    {
        return $this->belongsTo(PmBusiness::class, 'business_id');
    }

    public function plans(): HasMany
    {
        return $this->hasMany(PmOperationPlan::class, 'goal_id');
    }
}
