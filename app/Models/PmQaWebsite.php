<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class PmQaWebsite extends Model
{
    protected $fillable = [
        'created_by', 'business', 'project_id', 'project_name',
        'name', 'url', 'website_type', 'frequency', 'is_active',
        'last_check_status', 'last_http_status', 'last_response_ms', 'last_result', 'last_checked_at',
    ];

    protected $casts = ['is_active' => 'boolean', 'last_checked_at' => 'datetime'];
}
