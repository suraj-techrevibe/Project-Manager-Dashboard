<?php

namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Model;

class PmQaIssue extends Model
{
    protected $fillable = ['created_by','business','site_app','page_url','title','description','severity','status','assignee','evidence_url','retest_notes'];
}