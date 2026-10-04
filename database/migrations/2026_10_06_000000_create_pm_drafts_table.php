<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // A saved "brief -> tickets" working copy. Nothing here touches Taskmandu:
        // tickets only leave this table when someone presses Push.
        Schema::create('pm_drafts', function (Blueprint $t) {
            $t->id();
            $t->string('title', 200);
            $t->longText('brief')->nullable();
            $t->string('project_id', 24)->nullable(); // target project board, null = standalone
            $t->json('tickets');                      // the editable ticket list, incl. per-ticket state
            $t->string('status', 10)->default('draft')->index(); // draft | partial | pushed
            $t->string('created_by')->nullable();
            $t->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('pm_drafts');
    }
};
