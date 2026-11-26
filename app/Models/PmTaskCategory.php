<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/** Cached category for one mirrored task, plus the PM's manual override. Never written back to Taskmandu. */
class PmTaskCategory extends Model
{
    protected $guarded = [];

    protected $casts = [
        'matches' => 'array',
        'confidence' => 'integer',
    ];

    public function card()
    {
        return $this->belongsTo(PmCard::class, 'card_id');
    }

    /** The category used everywhere: the manual override when set, otherwise the automatic one. */
    public function effective(): string
    {
        return $this->override ?: $this->category;
    }
}
