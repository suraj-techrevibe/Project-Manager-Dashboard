<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('pm_qa_issues', function (Blueprint $table) {
            $table->string('project_id', 24)->nullable()->after('site_app')->index();
            $table->string('project_name', 200)->nullable()->after('project_id');
            $table->string('task_id', 24)->nullable()->after('project_name')->index();
            $table->string('task_title', 200)->nullable()->after('task_id');
            $table->string('subtask_id', 24)->nullable()->after('task_title');
            $table->string('subtask_title', 200)->nullable()->after('subtask_id');
        });
    }

    public function down(): void
    {
        Schema::table('pm_qa_issues', function (Blueprint $table) {
            $table->dropIndex(['project_id']);
            $table->dropIndex(['task_id']);
            $table->dropColumn([
                'project_id', 'project_name', 'task_id', 'task_title', 'subtask_id', 'subtask_title',
            ]);
        });
    }
};
