<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Plain local records — nothing here talks to Taskmandu. The point of
        // the tab is that the PM never has to learn a syntax: every field
        // below is filled by a normal form (or by Claude reshaping pasted
        // rough notes via MeetingMinutesController::draft), never typed markup.
        Schema::create('meeting_minutes', function (Blueprint $t) {
            $t->id();
            $t->string('title', 200);
            $t->date('meeting_date')->index();
            $t->json('attendees')->nullable();    // string[]
            $t->json('agenda_items')->nullable(); // string[]
            $t->text('discussion')->nullable();   // plain paragraphs
            $t->json('decisions')->nullable();    // string[]
            $t->json('action_items')->nullable(); // [{task, owner, due_date}]
            $t->longText('raw_notes')->nullable(); // whatever was pasted in, kept for reference
            $t->string('created_by')->nullable();
            $t->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('meeting_minutes');
    }
};
