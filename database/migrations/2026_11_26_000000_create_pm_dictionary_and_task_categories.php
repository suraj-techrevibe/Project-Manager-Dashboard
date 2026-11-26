<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Private rule dictionary + cached task classification.
 *
 * Nothing here touches Taskmandu: terms and manual overrides live only in this
 * dashboard's database. pm_task_categories is keyed by pm_cards.id (a local mirror
 * row), so task ids and sync relationships are unchanged.
 */
return new class extends Migration
{
    public function up(): void
    {
        // Generic keyword dictionary. `scope` lets other features reuse it later
        // (e.g. request triage), `label` is what a matching term votes for.
        Schema::create('pm_dictionary_terms', function (Blueprint $t) {
            $t->id();
            $t->string('scope', 40);
            $t->string('label', 40);
            $t->string('term', 120);
            $t->boolean('enabled')->default(true);
            $t->timestamps();

            $t->unique(['scope', 'label', 'term']);
            $t->index(['scope', 'enabled']);
        });

        // One cached result per mirrored task. Re-computed only when the task's
        // title/description (source_hash) or the enabled rules (rules_hash) change.
        Schema::create('pm_task_categories', function (Blueprint $t) {
            $t->id();
            $t->unsignedBigInteger('card_id')->unique();
            $t->string('category', 20)->index();
            $t->unsignedTinyInteger('confidence')->default(0);
            $t->string('suggested', 20)->nullable();
            $t->string('reason')->nullable();
            $t->json('matches')->nullable();
            $t->char('source_hash', 40);
            $t->char('rules_hash', 40);
            // Manual correction. Wins over the automatic category until reset.
            $t->string('override', 20)->nullable()->index();
            $t->timestamps();
        });

        $now = now();
        $rows = [];
        foreach (self::defaults() as $label => $terms) {
            foreach ($terms as $term) {
                $rows[] = [
                    'scope' => 'task_category',
                    'label' => $label,
                    'term' => $term,
                    'enabled' => true,
                    'created_at' => $now,
                    'updated_at' => $now,
                ];
            }
        }
        DB::table('pm_dictionary_terms')->insert($rows);
    }

    public function down(): void
    {
        Schema::dropIfExists('pm_task_categories');
        Schema::dropIfExists('pm_dictionary_terms');
    }

    /** Starting lists only; all of them are editable from the Dictionary tab. */
    private static function defaults(): array
    {
        return [
            'Development' => ['build', 'develop', 'development', 'implement', 'implementation', 'create', 'add feature', 'new feature', 'integrate', 'integration', 'fix', 'modify', 'functionality', 'frontend', 'backend', 'api', 'coding', 'programming'],
            // "check" and "issue" are included so titles like "Check mobile navigation issue" land in QA.
            'QA' => ['qa', 'test', 'testing', 'verify', 'verification', 'validation', 'regression', 'bug', 'defect', 'broken', 'not working', 'functionality check', 'responsive check', 'browser testing', 'mobile testing', 'check', 'issue'],
            'Research' => ['research', 'investigate', 'investigation', 'competitor', 'competition', 'comparison', 'analyse', 'analysis', 'explore', 'review website', 'improvement', 'opportunity', 'benchmark', 'audit', 'discover', 'evaluate'],
            'Maintenance' => ['maintenance', 'dependency', 'dependencies', 'upgrade', 'update version', 'backup', 'server maintenance', 'security', 'optimisation', 'optimization', 'cleanup', 'monitoring', 'uptime', 'database maintenance', 'performance maintenance'],
        ];
    }
};
