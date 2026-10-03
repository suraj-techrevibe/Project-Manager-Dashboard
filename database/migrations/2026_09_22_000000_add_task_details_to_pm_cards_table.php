<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('pm_cards', function (Blueprint $t) {
            $t->string('project_id')->nullable()->index()->after('external_id');
            $t->string('project_name')->nullable()->after('project_id');
            $t->string('task_id')->nullable()->after('project_name');
            $t->string('priority')->nullable()->after('status');
            $t->decimal('estimated_hours', 6, 2)->nullable();
            $t->json('tags')->nullable();
            $t->unsignedSmallInteger('comments_count')->default(0);
            $t->string('assigned_by')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('pm_cards', function (Blueprint $t) {
            $t->dropIndex(['project_id']);
            $t->dropColumn([
                'project_id', 'project_name', 'task_id', 'priority',
                'estimated_hours', 'tags', 'comments_count', 'assigned_by',
            ]);
        });
    }
};
