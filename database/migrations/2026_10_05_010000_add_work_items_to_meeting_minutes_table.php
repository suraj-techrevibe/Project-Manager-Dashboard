<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // This file sorts before the migration that creates meeting_minutes (2026_10_07), so on a fresh
        // database the table doesn't exist yet. 2026_10_09_000000 adds the column in that case.
        if (! Schema::hasTable('meeting_minutes') || Schema::hasColumn('meeting_minutes', 'work_items')) {
            return;
        }

        Schema::table('meeting_minutes', function (Blueprint $table) {
            $table->json('work_items')->nullable();
        });
    }

    public function down(): void
    {
        if (! Schema::hasColumn('meeting_minutes', 'work_items')) {
            return;
        }

        Schema::table('meeting_minutes', function (Blueprint $table) {
            $table->dropColumn('work_items');
        });
    }
};
