<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class PmInvestigationEvent extends Model
{
    public $timestamps = false;

    protected $table = 'pm_investigation_events';

    protected $guarded = [];

    protected $casts = ['created_at' => 'datetime'];
}
