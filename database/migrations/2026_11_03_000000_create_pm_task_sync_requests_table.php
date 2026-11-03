<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('pm_task_sync_requests', function (Blueprint $table) {
            $table->id();
            $table->foreignId('pm_card_id')->nullable()->constrained('pm_cards')->nullOnDelete();
            $table->string('project_id')->nullable()->index();
            $table->string('taskmandu_task_id')->nullable()->index();
            $table->string('action', 20);
            $table->json('payload');
            $table->string('status', 20)->default('pending')->index();
            $table->foreignId('requested_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('reviewed_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('reviewed_at')->nullable();
            $table->timestamp('delivered_at')->nullable();
            $table->text('failure_reason')->nullable();
            $table->string('idempotency_key')->unique();
            $table->timestamps();
            $table->index(['status', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('pm_task_sync_requests');
    }
};
