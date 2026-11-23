<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('pm_qa_websites', function (Blueprint $table) {
            $table->string('last_check_status', 30)->nullable()->after('is_active');
            $table->unsignedSmallInteger('last_http_status')->nullable()->after('last_check_status');
            $table->unsignedInteger('last_response_ms')->nullable()->after('last_http_status');
            $table->text('last_result')->nullable()->after('last_response_ms');
            $table->timestamp('last_checked_at')->nullable()->after('last_result');
        });
    }

    public function down(): void
    {
        Schema::table('pm_qa_websites', function (Blueprint $table) {
            $table->dropColumn(['last_check_status', 'last_http_status', 'last_response_ms', 'last_result', 'last_checked_at']);
        });
    }
};
