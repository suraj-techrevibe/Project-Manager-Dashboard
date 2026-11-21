<?php

use Illuminate\\Database\\Migrations\\Migration;
use Illuminate\\Database\\Schema\\Blueprint;
use Illuminate\\Support\\Facades\\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('pm_qa_task_reviews', function (Blueprint $table) {
            $table->id();
            $table->string('external_id')->unique();
            $table->string('project_id', 24)->nullable()->index();
            $table->string('project_name', 200)->nullable();
            $table->string('task_id', 24);
            $table->string('task_title', 200);
            $table->text('task_description')->nullable();
            $table->string('business', 160)->nullable()->index();
            $table->string('assignee', 160)->nullable();
            $table->string('task_status', 40)->index();
            $table->string('trigger_status', 40);
            $table->string('qa_status', 30)->default('Awaiting QA')->index();
            $table->unsignedSmallInteger('cycle')->default(1);
            $table->timestamp('triggered_at')->nullable();
            $table->timestamp('tested_at')->nullable();
            $table->foreignId('tested_by')->nullable()->constrained('users')->nullOnDelete();
            $table->string('last_result', 20)->nullable();
            $table->string('last_severity', 20)->nullable();
            $table->text('last_notes')->nullable();
            $table->string('last_evidence_url', 1000)->nullable();
            $table->string('taskmandu_url', 1000)->nullable();
            $table->timestamps();
            $table->index(['qa_status', 'task_status']);
        });

        Schema::create('pm_qa_task_review_events', function (Blueprint $table) {
            $table->id();
            $table->foreignId('review_id')->constrained('pm_qa_task_reviews')->cascadeOnDelete();
            $table->unsignedSmallInteger('cycle')->default(1);
            $table->string('result', 20);
            $table->string('severity', 20)->nullable();
            $table->text('notes')->nullable();
            $table->string('evidence_url', 1000)->nullable();
            $table->foreignId('tested_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->index(['review_id', 'cycle']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('pm_qa_task_review_events');
        Schema::dropIfExists('pm_qa_task_reviews');
    }
};
