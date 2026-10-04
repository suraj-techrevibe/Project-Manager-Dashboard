<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class PmMeetingTemplate extends Model
{
    protected $guarded = [];
    protected $casts = [
        'attendees' => 'array',
        'topics' => 'array',
        'active' => 'boolean',
        'meeting_time' => 'datetime:H:i',
    ];
}