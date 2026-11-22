<?php

namespace Tests\Feature;

use App\Models\PmQaEvidence;
use App\Models\PmQaIssue;
use App\Models\PmQaReport;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class PmQaEvidenceReportTest extends TestCase
{
    use RefreshDatabase;

    private function png(): string
    {
        return base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=');
    }

    private function issue(User $user, string $business = 'Techmandu'): PmQaIssue
    {
        return PmQaIssue::create([
            'created_by' => $user->id, 'business' => $business, 'site_app' => 'Website',
            'title' => 'Screenshot test finding', 'description' => 'Actual behaviour before edit',
            'expected_behaviour' => 'Expected behaviour', 'severity' => 'High', 'status' => 'Reported',
        ]);
    }

    private function upload(User $user, PmQaIssue $issue): PmQaEvidence
    {
        $this->actingAs($user)->post('/pm/api/qa/' . $issue->id . '/evidence', [
            'files' => [UploadedFile::fake()->createWithContent('capture.png', $this->png())],
        ])->assertCreated();
        return $issue->fresh('evidenceFiles')->evidenceFiles->first();
    }

    public function test_private_evidence_is_owner_scoped_and_validated(): void
    {
        Storage::fake('qa-evidence');
        $owner = User::factory()->create();
        $other = User::factory()->create();
        $issue = $this->issue($owner);
        $evidence = $this->upload($owner, $issue);

        $this->actingAs($owner)->get('/pm/api/qa/evidence/' . $evidence->id)->assertOk();
        $this->actingAs($other)->get('/pm/api/qa/evidence/' . $evidence->id)->assertNotFound();

        $this->actingAs($owner)->post('/pm/api/qa/' . $issue->id . '/evidence', [
            'files' => [UploadedFile::fake()->create('not-an-image.txt', 1, 'text/plain')],
        ])->assertUnprocessable();
    }

    public function test_report_snapshots_selected_findings_and_screenshot_ids_and_survive_issue_edits_or_deletion(): void
    {
        Storage::fake('qa-evidence');
        $owner = User::factory()->create();
        $issue = $this->issue($owner);
        $evidence = $this->upload($owner, $issue);

        $response = $this->actingAs($owner)->post('/pm/api/qa/reports', [
            'business' => 'Techmandu', 'site_app' => 'Website', 'report_date' => '2026-11-23',
            'areas_tested' => 'Collection pages', 'environment' => 'Desktop browser',
            'summary' => 'Snapshot test', 'fix_first' => 'Fix the first issue', 'open_questions' => '',
            'issue_ids' => [$issue->id], 'checklist' => [],
        ])->assertCreated();
        $reportId = $response->json('report.id');
        $snapshot = $response->json('report.findings.0');
        $this->assertSame([$evidence->id], collect($snapshot['evidence_files'])->pluck('id')->all());
        $this->assertSame('Actual behaviour before edit', $snapshot['description']);

        $issue->update(['description' => 'Changed live finding']);
        $report = PmQaReport::findOrFail($reportId);
        $this->assertSame('Actual behaviour before edit', $report->findings[0]['description']);

        $issue->delete();
        $this->assertNull($evidence->fresh()->issue_id);
        $this->actingAs($owner)->get('/pm/api/qa/reports/' . $reportId . '/evidence/' . $evidence->id)->assertOk();
        $docx = $this->actingAs($owner)->get('/pm/api/qa/reports/' . $reportId . '/docx');
        if (!class_exists('ZipArchive')) { $docx->assertStatus(501); return; }
        $docx->assertDownload($report->report_code . '.docx');
    }

    public function test_report_evidence_cannot_be_accessed_by_another_user(): void
    {
        Storage::fake('qa-evidence');
        $owner = User::factory()->create();
        $other = User::factory()->create();
        $issue = $this->issue($owner);
        $evidence = $this->upload($owner, $issue);
        $report = PmQaReport::create([
            'created_by' => $owner->id, 'report_code' => 'QA-TEST-OWNER', 'business' => 'Techmandu',
            'report_date' => '2026-11-23', 'findings' => [['id' => $issue->id, 'evidence_files' => [['id' => $evidence->id]]]],
            'checklist' => [],
        ]);
        $this->actingAs($other)->get('/pm/api/qa/reports/' . $report->id . '/evidence/' . $evidence->id)->assertNotFound();
    }
}
