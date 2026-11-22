<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('pm_action_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('kind', 20)->default('Action');
            $table->string('title', 200);
            $table->text('notes')->nullable();
            $table->string('business', 160)->nullable();
            $table->string('project_name', 200)->nullable();
            $table->string('source', 80)->default('My Action List');
            $table->string('priority', 10)->default('Medium');
            $table->string('status', 12)->default('Open');
            $table->date('due_date')->nullable();
            $table->timestamp('completed_at')->nullable();
            $table->timestamps();
            $table->index(['user_id', 'status', 'priority']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('pm_action_items');
    }
};
