<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('pm_qa_issues', function (Blueprint $table) {
            $table->string('record_type', 20)->default('Ad-hoc')->after('created_by')->index();
        });

        Schema::create('pm_qa_websites', function (Blueprint $table) {
            $table->id();
            $table->foreignId('created_by')->constrained('users')->cascadeOnDelete();
            $table->string('business', 160)->index();
            $table->string('project_id', 24)->nullable()->index();
            $table->string('project_name', 200)->nullable();
            $table->string('name', 200);
            $table->string('url', 1000);
            $table->string('website_type', 40)->default('Business website');
            $table->string('frequency', 20)->default('Manual');
            $table->boolean('is_active')->default(true);
            $table->timestamps();
            $table->index(['created_by', 'business']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('pm_qa_websites');
        Schema::table('pm_qa_issues', function (Blueprint $table) {
            $table->dropIndex(['record_type']);
            $table->dropColumn('record_type');
        });
    }
};
