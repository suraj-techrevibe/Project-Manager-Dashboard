<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class PmProjectHealth extends Model
{
    protected $table = 'pm_project_health';
    protected $guarded = [];
    protected $casts = [
        'calculated_at' => 'datetime',
    ];
}