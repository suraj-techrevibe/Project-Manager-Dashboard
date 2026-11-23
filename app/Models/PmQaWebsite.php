<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class PmQaWebsite extends Model
{
    protected $guarded = [];

    protected $casts = [
        'last_checked_at' => 'datetime',
        'is_active' => 'boolean',
    ];
}
