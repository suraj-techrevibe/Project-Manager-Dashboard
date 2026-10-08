<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('pm_subtasks') && ! Schema::hasColumn('pm_subtasks', 'completed_at')) {
            Schema::table('pm_subtasks', function (Blueprint $table) {
                $table->timestamp('completed_at')->nullable()->after('status');
            });
        }

        if (Schema::hasTable('pm_cards') && ! Schema::hasColumn('pm_cards', 'subtasks_completed_count')) {
            Schema::table('pm_cards', function (Blueprint $table) {
                $table->unsignedInteger('subtasks_completed_count')->default(0)->after('subtasks_count');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('pm_subtasks') && Schema::hasColumn('pm_subtasks', 'completed_at')) {
            Schema::table('pm_subtasks', function (Blueprint $table) {
                $table->dropColumn('completed_at');
            });
        }

        if (Schema::hasTable('pm_cards') && Schema::hasColumn('pm_cards', 'subtasks_completed_count')) {
            Schema::table('pm_cards', function (Blueprint $table) {
                $table->dropColumn('subtasks_completed_count');
            });
        }
    }
};