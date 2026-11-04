<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class PmIntake extends Model
{
    protected $table = 'pm_intakes';

    protected $guarded = [];

    protected $casts = [
        'requested_due_at' => 'date:Y-m-d',
    ];

    public function business(): BelongsTo
    {
        return $this->belongsTo(PmBusiness::class, 'business_id');
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function taskLinks(): HasMany
    {
        return $this->hasMany(PmIntakeTaskLink::class, 'intake_id')->orderBy('id');
    }
}
