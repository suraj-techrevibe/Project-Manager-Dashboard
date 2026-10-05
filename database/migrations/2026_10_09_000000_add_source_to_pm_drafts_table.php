<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('pm_drafts', function (Blueprint $table) {
            $table->string('source_type')->default('brief')->after('title');
            $table->unsignedBigInteger('source_id')->nullable()->after('source_type');
            $table->string('source_title')->nullable()->after('source_id');
            $table->index(['source_type', 'source_id']);
        });
    }

    public function down(): void
    {
        Schema::table('pm_drafts', function (Blueprint $table) {
            $table->dropIndex(['source_type', 'source_id']);
            $table->dropColumn(['source_type', 'source_id', 'source_title']);
        });
    }
};
