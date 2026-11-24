<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Only Taskmandu tasks that are currently "Awaiting review" belong in the QA queue.
 *
 *  - qa_in_trigger: the task is in the QA trigger status (or carries the trigger tag) as of the last sync.
 *  - qa_keep: a person re-queued this item by hand (from Failed or Passed), so it stays in the queue
 *    even though the Taskmandu task is no longer awaiting review.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('pm_qa_task_reviews', function (Blueprint $table) {
            $table->boolean('qa_in_trigger')->default(false);
            $table->boolean('qa_keep')->default(false);
        });
    }

    public function down(): void
    {
        Schema::table('pm_qa_task_reviews', function (Blueprint $table) {
            $table->dropColumn(['qa_in_trigger', 'qa_keep']);
        });
    }
};
