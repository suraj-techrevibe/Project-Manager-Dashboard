<?php

namespace App\Services\Pm;

use App\Models\PmQaBusinessCode;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;

/**
 * Hands out QA codes such as RBH-QA1, RBH-QA2 ... one counter per business.
 *
 * A code is assigned once, when the QA item is created, and never changes or gets reused,
 * so a code written in a developer handover or a Taskmandu comment always points at the same item.
 */
class QaCodeService
{
    /** Prefix for items whose business could not be worked out. */
    public const UNASSIGNED_PREFIX = 'GEN';

    /** Next code for this business, e.g. "RBH-QA3". Safe under concurrent requests. */
    public function assign(?string $business): string
    {
        $name = trim((string) $business);

        return DB::transaction(function () use ($name) {
            $row = PmQaBusinessCode::query()->where('business', $name)->lockForUpdate()->first()
                ?? $this->createRow($name);

            $seq = (int) $row->next_seq;
            $row->update(['next_seq' => $seq + 1]);

            return $row->code.'-QA'.$seq;
        });
    }

    /** The short business code (e.g. "RBH"), creating the counter row on first use. */
    public function prefixFor(?string $business): string
    {
        $name = trim((string) $business);

        return (PmQaBusinessCode::query()->where('business', $name)->first() ?? $this->createRow($name))->code;
    }

    private function createRow(string $name): PmQaBusinessCode
    {
        try {
            return PmQaBusinessCode::create([
                'business' => $name,
                'code' => $this->uniqueCode($name),
                'next_seq' => 1,
            ]);
        } catch (UniqueConstraintViolationException) {
            // Another request created this business at the same moment: use theirs.
            return PmQaBusinessCode::query()->where('business', $name)->lockForUpdate()->firstOrFail();
        }
    }

    private function uniqueCode(string $name): string
    {
        $base = $name === '' ? self::UNASSIGNED_PREFIX : self::initials($name);
        $code = $base;
        $n = 2;
        while (PmQaBusinessCode::query()->where('code', $code)->exists()) {
            $code = substr($base, 0, 6).$n++;
        }

        return $code;
    }

    /** "RB Hair & Beauty" -> "RHB", "EventTickets" -> "EVE". */
    public static function initials(string $name): string
    {
        $words = array_values(array_filter(preg_split('/[^A-Za-z0-9]+/', $name) ?: []));
        if ($words === []) {
            return self::UNASSIGNED_PREFIX;
        }
        $code = count($words) === 1
            ? substr($words[0], 0, 3)
            : implode('', array_map(fn ($w) => $w[0], array_slice($words, 0, 3)));

        return strtoupper($code);
    }
}
