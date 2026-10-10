<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('pm_taskmandu_events', function (Blueprint $table) {
            $table->id();
            $table->string('event_key', 191)->unique();
            $table->string('event_type', 32)->index();
            $table->string('project_id', 64)->nullable()->index();
            $table->string('project_name')->nullable();
            $table->string('task_id', 64)->nullable()->index();
            $table->string('task_title')->nullable();
            $table->string('subtask_id', 64)->nullable()->index();
            $table->string('subtask_title')->nullable();
            $table->string('owner_name')->nullable();
            $table->string('actor_name')->nullable();
            $table->text('body')->nullable();
            $table->string('status_from', 40)->nullable();
            $table->string('status_to', 40)->nullable();
            $table->timestamp('occurred_at')->index();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('pm_taskmandu_events');
    }
};
