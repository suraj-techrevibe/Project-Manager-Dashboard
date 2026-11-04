<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('pm_businesses', function (Blueprint $table) {
            $table->id();
            $table->string('name', 160)->unique();
            $table->string('slug', 180)->unique();
            $table->text('description')->nullable();
            $table->string('status', 20)->default('active')->index();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
        });

        Schema::create('pm_business_project_links', function (Blueprint $table) {
            $table->id();
            $table->foreignId('business_id')->constrained('pm_businesses')->cascadeOnDelete();
            $table->string('taskmandu_project_id', 24);
            $table->string('taskmandu_project_name', 200);
            $table->boolean('is_primary')->default(false);
            $table->timestamps();
            $table->unique(['business_id', 'taskmandu_project_id'], 'pm_business_project_unique');
            $table->index('taskmandu_project_id');
        });

        Schema::create('pm_intakes', function (Blueprint $table) {
            $table->id();
            $table->foreignId('business_id')->nullable()->constrained('pm_businesses')->nullOnDelete();
            $table->string('kind', 20)->index();
            $table->string('status', 30)->index();
            $table->string('priority', 20)->default('medium');
            $table->string('title', 200);
            $table->text('description')->nullable();
            $table->string('source_type', 30)->default('other');
            $table->string('source_name', 120)->nullable();
            $table->date('requested_due_at')->nullable();
            $table->text('clarification')->nullable();
            $table->text('decision_notes')->nullable();
            $table->string('linked_project_id', 24)->nullable()->index();
            $table->string('linked_project_name', 200)->nullable();
            $table->string('linked_task_id', 24)->nullable()->index();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->index(['kind', 'status']);
            $table->index(['business_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('pm_intakes');
        Schema::dropIfExists('pm_business_project_links');
        Schema::dropIfExists('pm_businesses');
    }
};
