<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // One row per investigation assignment: a Taskmandu project given to a developer to review.
        Schema::create('pm_investigations', function (Blueprint $t) {
            $t->id();
            $t->string('project_id', 64)->index();          // Taskmandu project id (stable)
            $t->string('project_name', 200);                // name when assigned; the id stays authoritative
            $t->string('developer_name', 160);
            $t->string('developer_employee_id', 64)->nullable()->index();
            $t->date('assigned_on');
            $t->date('due_date')->nullable();
            $t->string('priority', 10)->default('medium');
            $t->string('status', 20)->default('not_started');
            $t->text('scope')->nullable();
            $t->text('instructions')->nullable();
            $t->text('deliverables')->nullable();
            $t->json('checklist')->nullable();              // [{id,label,done}]
            $t->text('areas_reviewed')->nullable();
            $t->text('findings')->nullable();
            $t->text('issues')->nullable();
            $t->text('recommendations')->nullable();
            $t->json('evidence')->nullable();               // [{label,url}]
            $t->text('notes')->nullable();
            $t->json('followups')->nullable();              // proposed follow-up tasks (proposals only)
            $t->string('effort_estimate', 120)->nullable();
            $t->timestamp('submitted_at')->nullable();
            $t->date('last_investigated_on')->nullable();   // the day findings were last submitted
            $t->text('review_comments')->nullable();
            $t->string('reviewer_name', 160)->nullable();
            $t->timestamp('reviewed_at')->nullable();
            $t->timestamp('completed_at')->nullable();
            $t->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $t->timestamps();
            $t->index(['status', 'due_date']);
            $t->index(['developer_name', 'status']);
        });

        // Assignment and review history: assigned, reassigned, edited, started, submitted, reviewed, returned, closed.
        Schema::create('pm_investigation_events', function (Blueprint $t) {
            $t->id();
            $t->foreignId('investigation_id')->constrained('pm_investigations')->cascadeOnDelete();
            $t->string('event', 30);
            $t->string('from_status', 20)->nullable();
            $t->string('to_status', 20)->nullable();
            $t->string('actor_name', 160)->nullable();
            $t->text('detail')->nullable();
            $t->timestamp('created_at')->useCurrent();
            $t->index(['investigation_id', 'id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('pm_investigation_events');
        Schema::dropIfExists('pm_investigations');
    }
};
