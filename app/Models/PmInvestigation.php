<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

/** A Taskmandu project assigned to a developer for structured review. Not a task: it never appears on the Kanban board. */
class PmInvestigation extends Model
{
    public const STATUSES = ['not_started', 'in_progress', 'awaiting_review', 'reviewed', 'completed', 'returned'];
    public const PRIORITIES = ['low', 'medium', 'high', 'urgent'];

    protected $table = 'pm_investigations';

    protected $guarded = [];

    protected $casts = [
        'assigned_on' => 'date:Y-m-d',
        'due_date' => 'date:Y-m-d',
        'last_investigated_on' => 'date:Y-m-d',
        'checklist' => 'array',
        'evidence' => 'array',
        'followups' => 'array',
        'submitted_at' => 'datetime',
        'reviewed_at' => 'datetime',
        'completed_at' => 'datetime',
    ];

    public function events(): HasMany
    {
        return $this->hasMany(PmInvestigationEvent::class, 'investigation_id')->orderBy('id');
    }

    /** Developer-editable while the work is still with them. */
    public function findingsEditable(): bool
    {
        return in_array($this->status, ['not_started', 'in_progress', 'returned'], true);
    }
}
