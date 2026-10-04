<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class MeetingMinutes extends Model
{
    protected $table = 'meeting_minutes';

    protected $guarded = [];

    protected $casts = [
        'meeting_date' => 'date:Y-m-d',
        'attendees' => 'array',
        'agenda_items' => 'array',
        'decisions' => 'array',
        'topics' => 'array',
        'action_items' => 'array',
    ];
}
