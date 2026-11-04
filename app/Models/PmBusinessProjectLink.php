<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class PmBusinessProjectLink extends Model
{
    protected $table = 'pm_business_project_links';

    protected $guarded = [];

    protected $casts = [
        'is_primary' => 'boolean',
    ];

    public function business(): BelongsTo
    {
        return $this->belongsTo(PmBusiness::class, 'business_id');
    }
}
