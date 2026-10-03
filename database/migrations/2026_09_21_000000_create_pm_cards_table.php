<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('pm_cards', function (Blueprint $t) {
            $t->id();
            $t->string('external_id')->nullable()->unique();
            $t->string('title');
            $t->text('description')->nullable();
            $t->string('assignee')->nullable();
            $t->string('status')->default('todo')->index();
            $t->date('due_at')->nullable();
            $t->timestamp('last_activity_at')->nullable();
            $t->unsignedSmallInteger('subtasks_count')->default(0);
            $t->boolean('verified')->default(false);
            $t->date('snoozed_until')->nullable();
            $t->string('url')->nullable();
            $t->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('pm_cards');
    }
};
