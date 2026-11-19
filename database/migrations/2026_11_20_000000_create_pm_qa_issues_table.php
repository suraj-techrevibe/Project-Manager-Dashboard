<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void {
        Schema::create('pm_qa_issues', function (Blueprint $table) {
            $table->id();
            $table->foreignId('created_by')->constrained('users')->cascadeOnDelete();
            $table->string('business', 160)->nullable();
            $table->string('site_app', 200)->nullable();
            $table->string('page_url', 500)->nullable();
            $table->string('title', 200);
            $table->text('description')->nullable();
            $table->string('severity', 20)->default('Medium');
            $table->string('status', 30)->default('Draft');
            $table->string('assignee', 160)->nullable();
            $table->string('evidence_url', 1000)->nullable();
            $table->string('pm_task_url', 1000)->nullable();
            $table->text('retest_notes')->nullable();
            $table->timestamps();
            $table->index(['status', 'severity']);
        });
    }
    public function down(): void { Schema::dropIfExists('pm_qa_issues'); }
};