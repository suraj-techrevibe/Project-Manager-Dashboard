<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class PmQaEvidence extends Model
{
    protected $fillable = ['issue_id', 'created_by', 'disk', 'path', 'original_name', 'mime_type', 'size'];

    protected $hidden = ['created_by', 'disk', 'path'];

    public function issue()
    {
        return $this->belongsTo(PmQaIssue::class);
    }
}
