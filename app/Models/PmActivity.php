<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class PmActivity extends Model
{
    protected $guarded = [];

    protected $casts = [
        'meta' => 'array',
        'occurred_at' => 'datetime',
    ];

    /** Never lets a logging problem break the action being logged. */
    public static function record(string $type, ?PmCard $card = null, array $meta = [], ?string $title = null): void
    {
        try {
            static::create([
                'type' => $type,
                'card_id' => $card?->id,
                'title' => $title ?? $card?->title,
                'meta' => $meta + array_filter([
                    'assignee' => $card?->assignee,
                    'project' => $card?->project_name,
                ]),
                'occurred_at' => now(),
            ]);
        } catch (\Throwable $e) {
            report($e);
        }
    }
}
