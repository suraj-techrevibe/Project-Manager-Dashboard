<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/** One keyword or phrase in a private dictionary (see DictionaryMatcher). Local to this dashboard. */
class PmDictionaryTerm extends Model
{
    public const SCOPE_TASK_CATEGORY = 'task_category';

    protected $guarded = [];

    protected $casts = ['enabled' => 'boolean'];

    /** Lower-case, trimmed, single-spaced: how every term is stored and compared. */
    public static function normalize(string $term): string
    {
        return mb_strtolower(trim((string) preg_replace('/\s+/u', ' ', $term)));
    }
}
