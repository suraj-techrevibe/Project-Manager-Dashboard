<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/** A check that mirrors a Taskmandu subtask keeps its id, so renames, deletes and comments reach the right subtask. */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('pm_qa_checks', function (Blueprint $table) {
            $table->string('subtask_id', 40)->nullable()->index();
        });
    }

    public function down(): void
    {
        Schema::table('pm_qa_checks', function (Blueprint $table) {
            $table->dropIndex(['subtask_id']);
            $table->dropColumn('subtask_id');
        });
    }
};
