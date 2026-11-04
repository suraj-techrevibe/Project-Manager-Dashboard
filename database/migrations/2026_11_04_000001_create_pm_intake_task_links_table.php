<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('pm_intake_task_links', function (Blueprint $table) {
            $table->id();
            $table->foreignId('intake_id')->constrained('pm_intakes')->cascadeOnDelete();
            $table->string('project_id', 24);
            $table->string('project_name', 200)->nullable();
            $table->string('task_id', 24);
            $table->unsignedBigInteger('card_id')->nullable()->index();
            $table->string('title', 200);
            $table->text('url')->nullable();
            $table->timestamps();
            $table->unique(['intake_id', 'task_id'], 'pm_intake_task_unique');
            $table->index(['project_id', 'task_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('pm_intake_task_links');
    }
};
