<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/** Marks reviews whose Taskmandu subtasks were already pulled in as checks, so a check you delete stays deleted. */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('pm_qa_task_reviews', function (Blueprint $table) {
            $table->timestamp('qa_subtasks_imported_at')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('pm_qa_task_reviews', function (Blueprint $table) {
            $table->dropColumn('qa_subtasks_imported_at');
        });
    }
};
