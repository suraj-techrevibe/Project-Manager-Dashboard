<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('pm_reports', function (Blueprint $table) {
            $table->string('kind', 20)->default('daily')->change();
            $table->string('period_type', 20)->nullable()->after('kind');
            $table->string('period_end', 10)->nullable()->after('report_date');
        });
    }

    public function down(): void
    {
        Schema::table('pm_reports', function (Blueprint $table) {
            $table->dropColumn(['period_type', 'period_end']);
            $table->string('kind', 10)->default('daily')->change();
        });
    }
};
