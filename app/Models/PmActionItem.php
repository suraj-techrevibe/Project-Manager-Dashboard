<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class PmActionItem extends Model
{
    protected $fillable = ['user_id', 'kind', 'title', 'notes', 'business', 'project_name', 'source', 'priority', 'status', 'due_date', 'completed_at'];

    protected $casts = ['due_date' => 'date', 'completed_at' => 'datetime'];
}
