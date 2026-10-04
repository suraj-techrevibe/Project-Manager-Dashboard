<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('meeting_minutes', function (Blueprint $t) {
            // Existing rows count as finished minutes.
            $t->string('status', 10)->default('final')->after('title')->index();
            // [{title, notes, decision}] — what the guided form writes. The older
            // agenda_items / discussion / decisions columns are still filled from it.
            $t->json('topics')->nullable()->after('attendees');
        });
    }

    public function down(): void
    {
        Schema::table('meeting_minutes', function (Blueprint $t) {
            $t->dropColumn(['status', 'topics']);
        });
    }
};
