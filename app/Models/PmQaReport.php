<?php

namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Model;

class PmQaReport extends Model
{
    protected $fillable = ['created_by', 'report_code', 'business', 'site_app', 'report_date', 'areas_tested', 'environment', 'summary', 'fix_first', 'open_questions', 'findings', 'checklist', 'handed_over_at'];

    protected $casts = [
        'report_date' => 'date',
        'findings' => 'array',
        'checklist' => 'array',
        'handed_over_at' => 'datetime',
    ];
}
