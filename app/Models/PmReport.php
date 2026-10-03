<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class PmReport extends Model
{
    protected $guarded = [];

    protected $casts = [
        'content' => 'array',
        'auto' => 'boolean',
    ];
}
