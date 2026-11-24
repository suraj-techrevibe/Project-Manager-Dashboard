<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Taskmandu syncs keep overwriting the task fields on a review, so QA edits are stored beside them
 * and win when shown. Clearing an override falls back to the Taskmandu value.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('pm_qa_task_reviews', function (Blueprint $table) {
            $table->string('qa_title', 200)->nullable();
            $table->string('qa_business', 160)->nullable();
            $table->string('qa_site', 200)->nullable();
            $table->string('qa_url', 1000)->nullable();
            $table->string('qa_assignee', 160)->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('pm_qa_task_reviews', function (Blueprint $table) {
            $table->dropColumn(['qa_title', 'qa_business', 'qa_site', 'qa_url', 'qa_assignee']);
        });
    }
};
