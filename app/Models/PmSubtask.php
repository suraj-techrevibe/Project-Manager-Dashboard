<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/** A sub-task of a Taskmandu project task, as of the last sync. See the create migration for why it's separate from PmCard. */
class PmSubtask extends Model
{
    protected $guarded = [];

    protected $casts = [
        'parent_due_at' => 'date',
        'remote_created_at' => 'datetime',
        'completed_at' => 'datetime',
        'snoozed_until' => 'date',
    ];
}
