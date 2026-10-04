<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class PmDraft extends Model
{
    protected $guarded = [];

    protected $casts = [
        'tickets' => 'array',
    ];
}
