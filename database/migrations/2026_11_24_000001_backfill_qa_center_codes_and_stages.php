<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Gives every QA record that already exists a QA code and a pipeline stage.
 *
 * Codes are handed out in the order records were created, one counter per business
 * (RBH-QA1 is the oldest RB Hair & Beauty record). Records whose business can't be worked out
 * share the GEN counter. Nothing is deleted or rewritten except the new qa_* columns, and rows that
 * already have a code are skipped, so running this twice is safe.
 */
return new class extends Migration
{
    public function up(): void
    {
        $websitesByUser = DB::table('pm_qa_websites')->where('is_active', true)->get()->groupBy('created_by');
        $projectBusiness = DB::table('pm_business_project_links as l')
            ->join('pm_businesses as b', 'b.id', '=', 'l.business_id')
            ->orderByDesc('l.is_primary')
            ->get(['l.taskmandu_project_id as project_id', 'b.name'])
            ->unique('project_id')
            ->pluck('name', 'project_id');

        $rows = collect();
        foreach (DB::table('pm_qa_issues')->whereNull('qa_code')->get() as $r) {
            $stage = match ($r->status) {
                'Passed' => 'Passed',
                'Reported', 'Fixing', 'Failed' => 'Failed',
                default => 'Queue',
            };
            $rows->push([
                'table' => 'pm_qa_issues', 'order' => 0, 'id' => $r->id, 'created' => (string) $r->created_at,
                'business' => filled($r->business) ? $r->business : $this->detectBusiness($r, $websitesByUser, $projectBusiness),
                'stage' => $stage,
                'fail' => $stage === 'Failed' ? mb_substr((string) $r->description, 0, 5000) : null,
            ]);
        }
        foreach (DB::table('pm_qa_task_reviews')->whereNull('qa_code')->get() as $r) {
            $stage = match ($r->qa_status) {
                'Passed' => 'Passed',
                'Failed' => 'Failed',
                default => 'Queue',
            };
            $rows->push([
                'table' => 'pm_qa_task_reviews', 'order' => 1, 'id' => $r->id, 'created' => (string) $r->created_at,
                'business' => $r->business,
                'stage' => $stage,
                'fail' => $stage === 'Failed' ? mb_substr((string) $r->last_notes, 0, 5000) : null,
            ]);
        }

        // Continue from any counters that already exist.
        $counters = [];
        $used = [];
        foreach (DB::table('pm_qa_business_codes')->get() as $c) {
            $counters[$c->business] = ['code' => $c->code, 'seq' => (int) $c->next_seq - 1];
            $used[$c->code] = true;
        }

        $rows = $rows->sortBy([['created', 'asc'], ['order', 'asc'], ['id', 'asc']])->values();
        foreach ($rows as $r) {
            $name = trim((string) $r['business']);
            $counters[$name] ??= ['code' => $this->uniqueCode($name, $used), 'seq' => 0];
            $number = ++$counters[$name]['seq'];

            DB::table($r['table'])->where('id', $r['id'])->update([
                'qa_code' => $counters[$name]['code'].'-QA'.$number,
                'qa_stage' => $r['stage'],
                'qa_fail_note' => $r['fail'],
            ]);
        }

        $now = now();
        foreach ($counters as $name => $c) {
            DB::table('pm_qa_business_codes')->updateOrInsert(
                ['business' => $name],
                ['code' => $c['code'], 'next_seq' => $c['seq'] + 1, 'created_at' => $now, 'updated_at' => $now],
            );
        }
    }

    public function down(): void
    {
        // The qa_* columns are dropped by the previous migration's down().
    }

    private function detectBusiness(object $issue, Collection $websitesByUser, Collection $projectBusiness): ?string
    {
        $site = ($websitesByUser->get($issue->created_by) ?? collect())->first(fn ($w) =>
            ($issue->project_id && $w->project_id === $issue->project_id)
            || ($issue->site_app && strcasecmp($w->name, $issue->site_app) === 0)
            || ($issue->page_url && rtrim($w->url, '/') === rtrim($issue->page_url, '/'))
        );

        return $site->business ?? ($issue->project_id ? ($projectBusiness[(string) $issue->project_id] ?? null) : null);
    }

    private function uniqueCode(string $name, array &$used): string
    {
        $words = array_values(array_filter(preg_split('/[^A-Za-z0-9]+/', $name) ?: []));
        $base = $name === '' || $words === [] ? 'GEN' : strtoupper(
            count($words) === 1 ? substr($words[0], 0, 3) : implode('', array_map(fn ($w) => $w[0], array_slice($words, 0, 3)))
        );
        $code = $base;
        $n = 2;
        while (isset($used[$code])) {
            $code = substr($base, 0, 6).$n++;
        }
        $used[$code] = true;

        return $code;
    }
};
