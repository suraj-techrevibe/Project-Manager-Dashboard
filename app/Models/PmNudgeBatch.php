<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class PmNudgeBatch extends Model
{
    protected $guarded = [];
    protected $casts = [
        'items' => 'array',
        'generated_at' => 'datetime',
        'sent_at' => 'datetime',
    ];
}