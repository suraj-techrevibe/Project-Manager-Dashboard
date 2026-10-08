<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Already added by 2026_10_05_010000 on databases that had the table back then.
        if (Schema::hasColumn('meeting_minutes', 'work_items')) {
            return;
        }

        Schema::table('meeting_minutes', function (Blueprint $table) {
            $table->json('work_items')->nullable()->after('action_items');
        });
    }

    public function down(): void
    {
        Schema::table('meeting_minutes', function (Blueprint $table) {
            $table->dropColumn('work_items');
        });
    }
};
