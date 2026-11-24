<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/** One checklist line on a QA item. item_type is 'issue' (site check) or 'task' (Taskmandu review). */
class PmQaCheck extends Model
{
    protected $fillable = ['item_type', 'item_id', 'label', 'is_done', 'sort', 'subtask_id'];

    protected $casts = ['is_done' => 'boolean'];
}
