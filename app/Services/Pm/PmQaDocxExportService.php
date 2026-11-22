<?php

namespace App\Services\Pm;

use App\Models\PmQaEvidence;
use App\Models\PmQaReport;
use Illuminate\Support\Facades\Storage;
use ZipArchive;

class PmQaDocxExportService
{
    public function export(PmQaReport $report)
    {
        if (!class_exists(ZipArchive::class)) {
            return response()->json(['message' => 'DOCX export requires the PHP Zip extension.'], 501);
        }

        $findings = is_array($report->findings) ? $report->findings : [];
        $evidenceIds = collect($findings)->flatMap(fn ($finding) => collect($finding['evidence_files'] ?? [])->pluck('id'))
            ->filter()->unique()->values()->all();
        $evidence = $evidenceIds
            ? PmQaEvidence::where('created_by', $report->created_by)->whereIn('id', $evidenceIds)->get()->keyBy('id')
            : collect();

        $tmp = tempnam(sys_get_temp_dir(), 'qa-report-');
        $zip = new ZipArchive();
        if ($zip->open($tmp, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) {
            @unlink($tmp);
            return response()->json(['message' => 'Could not create DOCX file.'], 500);
        }

        $body = [];
        $imageRelationships = [];
        $imageTypes = [];
        $imageCounter = 0;
        $relationshipCounter = 2;

        $body[] = $this->paragraph('QA Report: ' . ($report->site_app ?: $report->business), true, 44, '1F2937');
        $body[] = $this->paragraph('Storefront / application testing findings for the development team. Fix order follows severity.', false, 22, '4B5563');
        $body[] = $this->paragraph('Report overview', true, 32);
        $counts = $this->counts($findings);
        $overview = [
            ['Business', $report->business],
            ['Site / app', $report->site_app ?: 'Not specified'],
            ['Report date', optional($report->report_date)->format('d F Y') ?: (string) $report->report_date],
            ['Areas tested', $report->areas_tested ?: 'Not specified'],
            ['Environment', $report->environment ?: 'Not recorded'],
            ['Result', count($findings) . ' findings: ' . $counts['Critical'] . ' Critical, ' . $counts['High'] . ' High, ' . $counts['Medium'] . ' Medium, ' . $counts['Low'] . ' Low, ' . $counts['Enhancement'] . ' Enhancement'],
            ['Report code', $report->report_code],
        ];
        $body[] = $this->table($overview, false);
        $body[] = $this->paragraph('Testing summary', true, 28);
        $body[] = $this->paragraph($report->summary ?: 'No testing summary recorded.');
        $body[] = $this->paragraph('Fix first', true, 28);

        $fixes = array_filter(array_map('trim', preg_split('/\r?\n/', (string) $report->fix_first)));
        if (!$fixes) {
            $fixes = collect($findings)->filter(fn ($f) => ($f['status'] ?? '') !== 'Passed')
                ->sortBy(fn ($f) => $this->severityRank($f['severity'] ?? 'Low'))->take(3)
                ->map(fn ($f) => ($f['severity'] ?? 'Low') . ': ' . ($f['title'] ?? 'Untitled finding'))->all();
        }
        foreach ($fixes as $index => $fix) {
            $body[] = $this->paragraph(($index + 1) . '. ' . $fix);
        }

        $body[] = $this->paragraph('Issue index', true, 28);
        $indexRows = [['ID', 'Severity', 'Issue', 'Where']];
        foreach ($findings as $index => $finding) {
            $indexRows[] = ['QA-' . str_pad((string) ($index + 1), 2, '0', STR_PAD_LEFT), $finding['severity'] ?? 'Low', $finding['title'] ?? 'Untitled finding', $finding['page_url'] ?? 'Not specified'];
        }
        $body[] = $this->table($indexRows, true);
        $body[] = $this->paragraph('Severity guide: Critical / High = broken or materially harmful customer behaviour; Medium = inconsistent or confusing; Low = minor wording or presentation; Enhancement = new work.', false, 18, '666666');

        $body[] = $this->paragraph('Detailed findings', true, 32);
        foreach ($findings as $index => $finding) {
            $qaId = 'QA-' . str_pad((string) ($index + 1), 2, '0', STR_PAD_LEFT);
            $body[] = $this->paragraph($qaId . ' ' . ($finding['title'] ?? 'Untitled finding'), true, 28);
            $body[] = $this->paragraph('Severity: ' . ($finding['severity'] ?? 'Not recorded') . '    Status: ' . ($finding['status'] ?? 'Not recorded'), false, 20, '4B5563');
            $body[] = $this->paragraph('Where: ' . ($finding['page_url'] ?? 'Not specified'));
            $body[] = $this->paragraph('Actual behaviour: ' . ($finding['description'] ?? 'Not recorded'));
            $body[] = $this->paragraph('Expected behaviour: ' . ($finding['expected_behaviour'] ?? 'Not recorded'));
            if (!empty($finding['developer_notes'])) $body[] = $this->paragraph('Developer notes: ' . $finding['developer_notes']);
            if (!empty($finding['assignee'])) $body[] = $this->paragraph('Assigned to: ' . $finding['assignee']);
            if (!empty($finding['pm_task_url'])) $body[] = $this->paragraph('Taskmandu task: ' . $finding['pm_task_url']);
            if (!empty($finding['evidence_url'])) $body[] = $this->paragraph('Legacy evidence URL: ' . $finding['evidence_url']);
            if (!empty($finding['retest_notes'])) $body[] = $this->paragraph('Retest notes: ' . $finding['retest_notes']);

            foreach (collect($finding['evidence_files'] ?? []) as $attachment) {
                $record = $evidence->get($attachment['id'] ?? null);
                if (!$record || !in_array($record->mime_type, ['image/png', 'image/jpeg'], true)) continue;
                $disk = Storage::disk($record->disk);
                if (!$disk->exists($record->path)) continue;
                $absolutePath = $disk->path($record->path);
                if (!is_file($absolutePath)) continue;
                $ext = $record->mime_type === 'image/png' ? 'png' : 'jpg';
                $imageCounter++;
                $mediaName = 'image' . $imageCounter . '.' . $ext;
                $zip->addFile($absolutePath, 'word/media/' . $mediaName);
                $imageTypes[$ext] = $record->mime_type;
                $relId = 'rId' . $relationshipCounter++;
                $imageRelationships[] = '<Relationship Id="' . $relId . '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/' . $mediaName . '"/>';
                $body[] = $this->imageParagraph($absolutePath, $relId, 'Image' . $imageCounter . ' ' . $qaId . ' evidence', $imageCounter);
                $body[] = $this->paragraph('Fig. ' . $imageCounter . ': Evidence for ' . $qaId . ' — ' . $record->original_name, false, 18, '666666');
            }
            $body[] = $this->paragraph('');
        }

        $body[] = $this->paragraph('Checklist results', true, 32);
        $checklist = is_array($report->checklist) ? $report->checklist : [];
        if ($checklist) {
            $rows = [['Checklist item', 'Result']];
            foreach ($checklist as $item) $rows[] = [$item['label'] ?? '', $item['result'] ?? 'Not recorded'];
            $body[] = $this->table($rows, true);
            $body[] = $this->paragraph('Pass means the item was verified. Items conflicting with findings should be marked Retest required.', false, 18, '666666');
        } else {
            $body[] = $this->paragraph('No checklist results recorded.');
        }

        $body[] = $this->paragraph('Open questions for the tester', true, 32);
        $questions = array_filter(array_map('trim', preg_split('/\r?\n/', (string) $report->open_questions)));
        if ($questions) {
            foreach ($questions as $index => $question) $body[] = $this->paragraph(($index + 1) . '. ' . $question);
        } else {
            $body[] = $this->paragraph('No open questions recorded.');
        }
        $body[] = $this->paragraph('Generated from the saved QA report snapshot. Later edits to live findings do not change this report.', false, 18, '666666');

        $document = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            . '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>'
            . implode('', $body)
            . '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="900" w:right="900" w:bottom="900" w:left="900"/></w:sectPr></w:body></w:document>';

        $zip->addFromString('[Content_Types].xml', $this->contentTypes($imageTypes));
        $zip->addFromString('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
        $zip->addFromString('word/document.xml', $document);
        $zip->addFromString('word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' . implode('', $imageRelationships) . '</Relationships>');
        $zip->close();

        return response()->download($tmp, $report->report_code . '.docx', [
            'Content-Type' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'Cache-Control' => 'private, no-store',
        ])->deleteFileAfterSend(true);
    }

    private function counts(array $findings): array
    {
        $counts = ['Critical' => 0, 'High' => 0, 'Medium' => 0, 'Low' => 0, 'Enhancement' => 0];
        foreach ($findings as $finding) {
            $severity = $finding['severity'] ?? 'Low';
            if (isset($counts[$severity])) $counts[$severity]++;
        }
        return $counts;
    }

    private function severityRank(string $severity): int
    {
        return ['Critical' => 0, 'High' => 1, 'Medium' => 2, 'Low' => 3, 'Enhancement' => 4][$severity] ?? 5;
    }

    private function paragraph(string $text, bool $bold = false, int $size = 22, ?string $color = null): string
    {
        $rPr = '<w:rPr>' . ($bold ? '<w:b/>' : '') . '<w:sz w:val="' . $size . '"/>' . ($color ? '<w:color w:val="' . $color . '"/>' : '') . '</w:rPr>';
        return '<w:p><w:pPr><w:spacing w:after="140"/></w:pPr><w:r>' . $rPr . '<w:t xml:space="preserve">' . $this->xml($text) . '</w:t></w:r></w:p>';
    }

    private function table(array $rows, bool $header): string
    {
        $columnCount = max(1, count($rows[0] ?? []));
        $columnWidth = (int) floor(10000 / $columnCount);
        $grid = '';
        for ($column = 0; $column < $columnCount; $column++) $grid .= '<w:gridCol w:w="' . $columnWidth . '"/>';
        $xml = '<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders><w:top w:val="single" w:sz="4" w:color="B7C1CC"/><w:left w:val="single" w:sz="4" w:color="B7C1CC"/><w:bottom w:val="single" w:sz="4" w:color="B7C1CC"/><w:right w:val="single" w:sz="4" w:color="B7C1CC"/><w:insideH w:val="single" w:sz="4" w:color="B7C1CC"/><w:insideV w:val="single" w:sz="4" w:color="B7C1CC"/></w:tblBorders></w:tblPr><w:tblGrid>' . $grid . '</w:tblGrid>';
        foreach ($rows as $index => $row) {
            $xml .= '<w:tr>';
            foreach ($row as $cell) {
                $shade = $header && $index === 0 ? '<w:shd w:fill="E5E7EB"/>' : '';
                $bold = $header && $index === 0 ? '<w:b/>' : '';
                $xml .= '<w:tc><w:tcPr>' . $shade . '<w:tcW w:w="' . $columnWidth . '" w:type="dxa"/></w:tcPr><w:p><w:r><w:rPr>' . $bold . '<w:sz w:val="20"/></w:rPr><w:t xml:space="preserve">' . $this->xml((string) $cell) . '</w:t></w:r></w:p></w:tc>';
            }
            $xml .= '</w:tr>';
        }
        return $xml . '</w:tbl>';
    }

    private function imageParagraph(string $path, string $relationshipId, string $name, int $drawingId): string
    {
        $size = @getimagesize($path);
        $width = $size[0] ?? 800;
        $height = $size[1] ?? 600;
        $maxWidth = 5486400; // 6 inches
        $maxHeight = 7315200; // 8 inches
        $scale = min(1, $maxWidth / max(1, $width * 9525), $maxHeight / max(1, $height * 9525));
        $cx = (int) ($width * 9525 * $scale);
        $cy = (int) ($height * 9525 * $scale);
        $id = $drawingId;
        return '<w:p><w:r><w:drawing><wp:inline><wp:extent cx="' . $cx . '" cy="' . $cy . '"/><wp:docPr id="' . $id . '" name="' . $this->xml($name) . '"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="' . $id . '" name="' . $this->xml($name) . '"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="' . $relationshipId . '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' . $cx . '" cy="' . $cy . '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
    }

    private function contentTypes(array $types): string
    {
        $defaults = '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>';
        foreach ($types as $ext => $mime) $defaults .= '<Default Extension="' . $ext . '" ContentType="' . $mime . '"/>';
        return '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' . $defaults . '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>';
    }

    private function xml(string $value): string
    {
        return htmlspecialchars($value, ENT_XML1 | ENT_QUOTES, 'UTF-8');
    }
}
