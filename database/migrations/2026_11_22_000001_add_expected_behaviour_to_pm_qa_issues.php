<?php

use Illuminate\\Database\\Migrations\\Migration;
use Illuminate\\Database\\Schema\\Blueprint;
use Illuminate\\Support\\Facades\\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('pm_qa_issues', function (Blueprint $table) {
            $table->text('expected_behaviour')->nullable();
            $table->text('developer_notes')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('pm_qa_issues', function (Blueprint $table) {
            $table->dropColumn(['expected_behaviour', 'developer_notes']);
        });
    }
};
