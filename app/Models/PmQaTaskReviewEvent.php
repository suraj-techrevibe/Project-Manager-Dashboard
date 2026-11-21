<?php

namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Model;
use Illuminate\\Database\\Eloquent\\Relations\\BelongsTo;

class PmQaTaskReviewEvent extends Model
{
    protected $guarded = [];

    public function tester(): BelongsTo
    {
        return $this->belongsTo(User::class, 'tested_by');
    }

    public function review(): BelongsTo
    {
        return $this->belongsTo(PmQaTaskReview::class, 'review_id');
    }
}
