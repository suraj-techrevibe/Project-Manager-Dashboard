<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Things that happened, with a date: status changes seen at sync time and
        // actions taken in this app (tasks pushed, nudges drafted, verify, snooze).
        // Daily reports are built from this.
        Schema::create('pm_activities', function (Blueprint $t) {
            $t->id();
            $t->string('type', 30)->index(); // created | status_change | pushed | nudge | verify | snooze
            $t->unsignedBigInteger('card_id')->nullable()->index();
            $t->string('title')->nullable();
            $t->json('meta')->nullable();
            $t->timestamp('occurred_at')->index();
            $t->timestamps();
        });

        // Generated reports. One per day: generating a day again replaces it.
        Schema::create('pm_reports', function (Blueprint $t) {
            $t->id();
            $t->string('report_date', 10)->unique(); // YYYY-MM-DD
            $t->json('content');
            $t->longText('body'); // the same report as plain text, for copy/paste
            $t->text('notes')->nullable(); // the custom text typed by the user
            $t->string('generated_by')->nullable();
            $t->boolean('auto')->default(false);
            $t->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('pm_reports');
        Schema::dropIfExists('pm_activities');
    }
};
