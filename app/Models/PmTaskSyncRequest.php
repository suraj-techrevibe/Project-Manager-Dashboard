<?php

namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Model;
use Illuminate\\Database\\Eloquent\\Relations\\BelongsTo;

class PmTaskSyncRequest extends Model
{
    protected $guarded = [];

    protected $casts = [
        'payload' => 'array',
        'reviewed_at' => 'datetime',
        'delivered_at' => 'datetime',
    ];

    public function card(): BelongsTo
    {
        return $this->belongsTo(PmCard::class, 'pm_card_id');
    }

    public function requester(): BelongsTo
    {
        return $this->belongsTo(User::class, 'requested_by');
    }

    public function reviewer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'reviewed_by');
    }
}
