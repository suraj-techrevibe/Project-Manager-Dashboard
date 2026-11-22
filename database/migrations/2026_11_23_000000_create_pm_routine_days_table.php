<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('pm_routine_days', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->date('day');
            $table->json('ticks')->nullable();
            $table->json('priorities')->nullable();
            $table->boolean('fresh')->default(false);
            $table->boolean('skipped')->default(false);
            $table->json('summary')->nullable();
            $table->timestamp('report_opened_at')->nullable();
            $table->timestamp('nudged_at')->nullable();
            $table->timestamps();
            $table->unique(['user_id', 'day']);
            $table->index(['day', 'skipped']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('pm_routine_days');
    }
};
