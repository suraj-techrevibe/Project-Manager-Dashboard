<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class PmWaitingClient extends Model
{
    protected $table = 'pm_waiting_client';
    protected $guarded = [];
    protected $casts = [
        'waiting_since' => 'date',
        'last_checked_at' => 'date',
    ];
}