<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class PmQaDeskItem extends Model
{
    protected $guarded = [];

    protected $casts = [
        'checks' => 'array',
        'screenshots' => 'array',
        'history' => 'array',
    ];
}
