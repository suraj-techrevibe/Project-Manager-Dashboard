<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/** One row per business: its short QA code (e.g. RBH) and the next number to hand out. */
class PmQaBusinessCode extends Model
{
    protected $fillable = ['business', 'code', 'next_seq'];
}
