<?php

namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Model;
use Illuminate\\Database\\Eloquent\\Relations\\BelongsTo;
use Illuminate\\Database\\Eloquent\\Relations\\HasMany;

class PmQaTaskReview extends Model
{
    protected $guarded = [];

    protected $casts = [
        'triggered_at' => 'datetime',
        'tested_at' => 'datetime',
        'cycle' => 'integer',
    ];

    public function events(): HasMany
    {
        return $this->hasMany(PmQaTaskReviewEvent::class, 'review_id')->latest();
    }

    public function tester(): BelongsTo
    {
        return $this->belongsTo(User::class, 'tested_by');
    }
}
