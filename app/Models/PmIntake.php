<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

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
}
