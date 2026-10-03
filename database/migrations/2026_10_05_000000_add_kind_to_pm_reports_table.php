<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Daily and weekly reports share the table; a weekly report is dated by its Monday,
        // so uniqueness is per (kind, date), not per date alone.
        Schema::table('pm_reports', function (Blueprint $t) {
            $t->string('kind', 10)->default('daily')->after('id');
            $t->dropUnique(['report_date']);
            $t->unique(['kind', 'report_date']);
        });
    }

    public function down(): void
    {
        Schema::table('pm_reports', function (Blueprint $t) {
            $t->dropUnique(['kind', 'report_date']);
            $t->unique('report_date');
            $t->dropColumn('kind');
        });
    }
};
