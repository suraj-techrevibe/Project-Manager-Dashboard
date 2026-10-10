<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class PmTaskmanduEvent extends Model
{
    protected $table = 'pm_taskmandu_events';
    protected $guarded = [];
    protected $casts = ['occurred_at' => 'datetime'];
}
