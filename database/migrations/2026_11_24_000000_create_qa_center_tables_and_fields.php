<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * QA Center pipeline (Queue -> Testing -> Failed / Passed).
 *
 * Purely additive: existing QA findings (pm_qa_issues) and Taskmandu task reviews
 * (pm_qa_task_reviews) keep every column and status they have today. They only gain the
 * fields the new QA Center needs. Per-business QA codes come from pm_qa_business_codes, which
 * hands out RBH-QA1, RBH-QA2, ... independently for each business and never reuses a number.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('pm_qa_business_codes', function (Blueprint $table) {
            $table->id();
            // Business name exactly as stored on QA records. '' is the "business not detected" bucket.
            $table->string('business', 160)->default('')->unique();
            $table->string('code', 8)->unique();
            $table->unsignedInteger('next_seq')->default(1);
            $table->timestamps();
        });

        Schema::create('pm_qa_checks', function (Blueprint $table) {
            $table->id();
            $table->string('item_type', 10); // 'issue' (site check) or 'task' (Taskmandu task review)
            $table->unsignedBigInteger('item_id');
            $table->string('label', 300);
            $table->boolean('is_done')->default(false);
            $table->unsignedSmallInteger('sort')->default(0);
            $table->timestamps();
            $table->index(['item_type', 'item_id']);
        });

        foreach (['pm_qa_issues', 'pm_qa_task_reviews'] as $name) {
            Schema::table($name, function (Blueprint $table) {
                $table->string('qa_code', 24)->nullable()->unique();
                $table->string('qa_stage', 12)->default('Queue')->index();
                $table->text('qa_remarks')->nullable();
                $table->text('qa_fail_note')->nullable();
                $table->json('qa_screenshots')->nullable();
                $table->json('qa_history')->nullable();
            });
        }
    }

    public function down(): void
    {
        foreach (['pm_qa_issues', 'pm_qa_task_reviews'] as $name) {
            Schema::table($name, function (Blueprint $table) use ($name) {
                $table->dropUnique($name.'_qa_code_unique');
                $table->dropIndex($name.'_qa_stage_index');
                $table->dropColumn(['qa_code', 'qa_stage', 'qa_remarks', 'qa_fail_note', 'qa_screenshots', 'qa_history']);
            });
        }

        Schema::dropIfExists('pm_qa_checks');
        Schema::dropIfExists('pm_qa_business_codes');
    }
};
