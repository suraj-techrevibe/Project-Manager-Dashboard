<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class PmRoutineDay extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'day' => 'date:Y-m-d',
            'ticks' => 'array',
            'priorities' => 'array',
            'fresh' => 'boolean',
            'skipped' => 'boolean',
            'summary' => 'array',
            'report_opened_at' => 'datetime',
            'nudged_at' => 'datetime',
        ];
    }
}
