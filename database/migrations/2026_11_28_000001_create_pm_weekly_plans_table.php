<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('pm_weekly_plans', function (Blueprint $table) {
            $table->id();
            $table->string('title', 200);
            $table->date('week_start')->unique();
            $table->date('week_end');
            $table->string('team_timezone', 64)->default('Asia/Kathmandu');
            $table->string('status', 32)->default('draft');
            $table->text('notes')->nullable();
            $table->json('tickets');
            $table->string('created_by')->nullable();
            $table->unsignedBigInteger('created_by_id')->nullable();
            $table->string('submitted_by')->nullable();
            $table->timestamp('submitted_at')->nullable();
            $table->string('approved_by')->nullable();
            $table->unsignedBigInteger('approved_by_id')->nullable();
            $table->timestamp('approved_at')->nullable();
            $table->text('approval_notes')->nullable();
            $table->timestamp('release_started_at')->nullable();
            $table->timestamp('released_at')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('pm_weekly_plans');
    }
};
