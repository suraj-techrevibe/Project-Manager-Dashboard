<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class PmCard extends Model
{
    protected $guarded = [];

    protected $casts = [
        'due_at' => 'date',
        'last_activity_at' => 'datetime',
        'snoozed_until' => 'date',
        'verified' => 'boolean',
        'tags' => 'array',
        'estimated_hours' => 'float',
    ];
}
