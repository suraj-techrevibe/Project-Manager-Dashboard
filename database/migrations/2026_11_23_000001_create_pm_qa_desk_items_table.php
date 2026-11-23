<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('pm_qa_desk_items', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('created_by')->index();
            $table->string('title', 200);
            $table->string('business', 160)->nullable()->index();
            $table->string('site_app', 200)->nullable();
            $table->string('source', 40);
            $table->string('source_id', 100)->nullable();
            $table->string('assignee', 160)->nullable()->index();
            $table->string('url', 1000)->nullable();
            $table->string('status', 20)->default('queue')->index();
            $table->json('checks')->nullable();
            $table->json('screenshots')->nullable();
            $table->text('fail_note')->nullable();
            $table->json('history')->nullable();
            $table->timestamps();
            $table->index(['created_by', 'source', 'source_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('pm_qa_desk_items');
    }
};
