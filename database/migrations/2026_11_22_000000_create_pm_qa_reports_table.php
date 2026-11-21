<?php

use Illuminate\\Database\\Migrations\\Migration;
use Illuminate\\Database\\Schema\\Blueprint;
use Illuminate\\Support\\Facades\\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('pm_qa_reports', function (Blueprint $table) {
            $table->id();
            $table->foreignId('created_by')->constrained('users')->cascadeOnDelete();
            $table->string('report_code', 40)->unique();
            $table->string('business', 160);
            $table->string('site_app', 200)->nullable();
            $table->date('report_date');
            $table->text('areas_tested')->nullable();
            $table->string('environment', 500)->nullable();
            $table->text('summary')->nullable();
            $table->text('fix_first')->nullable();
            $table->text('open_questions')->nullable();
            $table->json('findings');
            $table->json('checklist')->nullable();
            $table->timestamp('handed_over_at')->nullable();
            $table->timestamps();
            $table->index(['created_by', 'report_date']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('pm_qa_reports');
    }
};
