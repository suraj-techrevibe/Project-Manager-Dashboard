<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('pm_operation_goals', function (Blueprint $table) {
            $table->id();
            $table->foreignId('business_id')->nullable()->constrained('pm_businesses')->nullOnDelete();
            $table->string('title', 200);
            $table->text('description')->nullable();
            $table->string('goal_type', 40)->default('other');
            $table->date('target_date')->nullable()->index();
            $table->date('start_date')->nullable();
            $table->string('priority', 20)->default('auto');
            $table->string('status', 20)->default('active')->index();
            $table->text('source_notes')->nullable();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->index(['business_id', 'goal_type']);
            $table->index(['status', 'target_date']);
        });

        Schema::create('pm_operation_plans', function (Blueprint $table) {
            $table->id();
            $table->foreignId('business_id')->nullable()->constrained('pm_businesses')->nullOnDelete();
            $table->foreignId('goal_id')->nullable()->constrained('pm_operation_goals')->nullOnDelete();
            $table->string('title', 200);
            $table->string('priority', 20)->default('auto');
            $table->string('status', 32)->default('draft')->index();
            $table->text('objective')->nullable();
            $table->longText('background')->nullable();
            $table->longText('proposed_approach')->nullable();
            $table->json('proposed_tasks')->nullable();
            $table->json('timeline')->nullable();
            $table->longText('resource_requirements')->nullable();
            $table->longText('expected_outcomes')->nullable();
            $table->longText('risks')->nullable();
            $table->longText('boss_comments')->nullable();
            $table->longText('approval_notes')->nullable();
            $table->longText('additional_notes')->nullable();
            $table->timestamp('submitted_at')->nullable();
            $table->timestamp('reviewed_at')->nullable();
            $table->timestamp('archived_at')->nullable();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->index(['business_id', 'status']);
            $table->index(['goal_id']);
        });

        Schema::create('pm_operation_plan_revisions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('plan_id')->constrained('pm_operation_plans')->cascadeOnDelete();
            $table->unsignedInteger('revision_number');
            $table->json('snapshot');
            $table->string('event', 40)->default('submitted');
            $table->text('change_reason')->nullable();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->unique(['plan_id', 'revision_number']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('pm_operation_plan_revisions');
        Schema::dropIfExists('pm_operation_plans');
        Schema::dropIfExists('pm_operation_goals');
    }
};
