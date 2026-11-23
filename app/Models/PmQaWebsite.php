<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class PmQaWebsite extends Model
{
    protected $fillable = [
        'created_by', 'business', 'project_id', 'project_name',
        'name', 'url', 'website_type', 'frequency', 'is_active',
    ];

    protected $casts = ['is_active' => 'boolean'];
}
