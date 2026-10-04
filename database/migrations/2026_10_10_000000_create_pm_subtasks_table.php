<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Sub-tasks live inside a project task in Taskmandu, so they used to be invisible to Today:
     * an unassigned sub-task could sit there forever. They are kept in their own table (not
     * pm_cards) so reports, board checks and the AI snapshot keep counting real tasks only.
     */
    public function up(): void
    {
        Schema::create('pm_subtasks', function (Blueprint $t) {
            $t->id();
            $t->string('external_id')->unique(); // project:<pid>:task:<tid>:sub:<sid>
            $t->string('project_id')->index();
            $t->string('project_name');
            $t->string('task_id');
            $t->string('subtask_id');
            $t->string('parent_title');
            $t->string('parent_assignee')->nullable();
            $t->date('parent_due_at')->nullable();
            $t->string('title');
            $t->string('assignee')->nullable();
            $t->string('assigned_by')->nullable();
            $t->string('status')->default('Assigned')->index();
            $t->unsignedSmallInteger('comments_count')->default(0);
            $t->timestamp('remote_created_at')->nullable();
            $t->date('snoozed_until')->nullable();
            $t->string('url')->nullable();
            $t->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('pm_subtasks');
    }
};
