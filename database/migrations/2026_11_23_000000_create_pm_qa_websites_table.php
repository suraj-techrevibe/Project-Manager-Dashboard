<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('pm_qa_websites', function (Blueprint $table) {
            $table->id();
            $table->foreignId('created_by')->constrained('users')->cascadeOnDelete();
            $table->string('business', 160);
            $table->string('name', 200);
            $table->string('url', 1000);
            $table->string('status', 30)->default('Not checked');
            $table->unsignedSmallInteger('last_http_status')->nullable();
            $table->unsignedInteger('last_response_ms')->nullable();
            $table->text('last_result')->nullable();
            $table->timestamp('last_checked_at')->nullable();
            $table->boolean('is_active')->default(true);
            $table->timestamps();
            $table->index(['created_by', 'business']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('pm_qa_websites');
    }
};
