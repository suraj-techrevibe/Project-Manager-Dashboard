<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('pm_nudge_batches', function (Blueprint $table) {
            $table->id();
            $table->string('status')->default('draft');
            $table->json('items');
            $table->timestamp('generated_at');
            $table->timestamp('sent_at')->nullable();
            $table->timestamps();
        });

        Schema::create('pm_meeting_templates', function (Blueprint $table) {
            $table->id();
            $table->string('name', 200);
            $table->string('project_name', 200)->nullable();
            $table->json('attendees')->nullable();
            $table->json('topics')->nullable();
            $table->string('weekday', 20)->default('monday');
            $table->time('meeting_time')->nullable();
            $table->boolean('active')->default(true);
            $table->timestamps();
        });

        Schema::create('pm_ticket_packs', function (Blueprint $table) {
            $table->id();
            $table->string('name', 200);
            $table->text('description')->nullable();
            $table->json('tickets');
            $table->timestamps();
        });

        Schema::create('pm_waiting_client', function (Blueprint $table) {
            $table->id();
            $table->string('project_id', 24)->nullable();
            $table->string('task_id', 24)->nullable();
            $table->unsignedBigInteger('card_id')->nullable();
            $table->string('title', 300);
            $table->date('waiting_since');
            $table->date('last_checked_at')->nullable();
            $table->string('status')->default('waiting');
            $table->timestamps();
            $table->index(['project_id', 'task_id']);
        });

        Schema::create('pm_project_health', function (Blueprint $table) {
            $table->id();
            $table->string('project_id', 24);
            $table->string('project_name', 200);
            $table->unsignedInteger('score')->default(100);
            $table->string('health', 20);
            $table->unsignedInteger('overdue_count')->default(0);
            $table->unsignedInteger('idle_days')->default(0);
            $table->timestamp('calculated_at');
            $table->timestamps();
            $table->index(['project_id', 'calculated_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('pm_project_health');
        Schema::dropIfExists('pm_waiting_client');
        Schema::dropIfExists('pm_ticket_packs');
        Schema::dropIfExists('pm_meeting_templates');
        Schema::dropIfExists('pm_nudge_batches');
    }
};