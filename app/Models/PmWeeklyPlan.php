<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class PmWeeklyPlan extends Model
{
    protected $guarded = [];

    protected $casts = [
        'week_start' => 'date:Y-m-d',
        'week_end' => 'date:Y-m-d',
        'tickets' => 'array',
        'submitted_at' => 'datetime',
        'approved_at' => 'datetime',
        'release_started_at' => 'datetime',
        'released_at' => 'datetime',
    ];
}
