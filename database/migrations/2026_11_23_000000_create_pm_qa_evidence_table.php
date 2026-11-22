<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('pm_qa_evidence', function (Blueprint $table) {
            $table->id();
            $table->foreignId('issue_id')->nullable()->constrained('pm_qa_issues')->nullOnDelete();
            $table->foreignId('created_by')->constrained('users')->cascadeOnDelete();
            $table->string('disk', 40);
            $table->string('path', 500);
            $table->string('original_name', 255);
            $table->string('mime_type', 100);
            $table->unsignedBigInteger('size');
            $table->timestamps();
            $table->index(['created_by', 'issue_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('pm_qa_evidence');
    }
};
