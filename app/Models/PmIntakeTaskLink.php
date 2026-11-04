<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class PmIntakeTaskLink extends Model
{
    protected $table = 'pm_intake_task_links';

    protected $guarded = [];

    public function intake(): BelongsTo
    {
        return $this->belongsTo(PmIntake::class, 'intake_id');
    }

    public function card(): BelongsTo
    {
        return $this->belongsTo(PmCard::class, 'card_id');
    }
}
