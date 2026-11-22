<?php

namespace App\Http\Controllers;

use App\Models\PmRoutineDay;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;

class PmRoutineController extends Controller
{
    private const MORNING = ['sync', 'decide', 'late', 'owners', 'qa', 'meetings', 'capacity', 'priorities'];
    private const MIDDAY = ['mid_requests', 'mid_blocked', 'mid_qa'];
    private const END_OF_DAY = ['eod_statuses', 'eod_standup', 'eod_report', 'eod_waiting', 'eod_tomorrow'];
    private const FRIDAY = ['fri_ideas', 'fri_balance', 'fri_health'];

    private function stepsFor(Carbon $date): array
    {
        return array_merge(self::MORNING, self::MIDDAY, self::END_OF_DAY, $date->isFriday() ? self::FRIDAY : []);
    }

    private function today(): Carbon
    {
        return Carbon::today(config('pm.routine.timezone', 'Australia/Sydney'));
    }

    public function show(Request $request): JsonResponse
    {
        $userId = $request->user()->getKey();
        $today = $this->today();
        $day = PmRoutineDay::query()->firstOrNew(['user_id' => $userId, 'day' => $today->toDateString()]);
        $history = PmRoutineDay::query()
            ->where('user_id', $userId)
            ->whereDate('day', '<', $today->toDateString())
            ->orderByDesc('day')
            ->limit(20)
            ->get()
            ->filter(fn (PmRoutineDay $row) => $row->day->isWeekday())
            ->take(5)
            ->map(fn (PmRoutineDay $row) => $this->present($row))
            ->values();

        $streak = 0;
        foreach ($history as $row) {
            if ($row['skipped']) continue;
            if ($row['complete']) $streak++;
            else break;
        }
        if ($day->exists && $day->skipped) {
            // A day off does not break the previous completed-day streak.
        } elseif ($day->exists && $this->complete($day)) {
            $streak++;
        }

        return response()->json([
            'day' => $this->present($day),
            'history' => $history,
            'streak' => $streak,
            'steps' => $this->stepsFor($today),
            'is_workday' => $today->isWeekday(),
        ]);
    }

    public function save(Request $request): JsonResponse
    {
        $data = $request->validate([
            'ticks' => 'sometimes|array',
            'ticks.*' => 'boolean',
            'priorities' => 'sometimes|array|max:3',
            'priorities.*' => 'nullable|string|max:160',
            'fresh' => 'sometimes|boolean',
            'skipped' => 'sometimes|boolean',
        ]);

        $today = $this->today()->toDateString();
        $ticks = collect($data['ticks'] ?? [])->only($this->stepsFor($this->today()))->all();
        $priorities = array_slice(array_map(fn ($value) => trim((string) $value), $data['priorities'] ?? []), 0, 3);

        $row = PmRoutineDay::query()->firstOrNew(['user_id' => $request->user()->getKey(), 'day' => $today]);
        if (array_key_exists('ticks', $data)) $row->ticks = $ticks;
        if (array_key_exists('priorities', $data)) $row->priorities = $priorities;
        if (array_key_exists('fresh', $data)) $row->fresh = $data['fresh'];
        if (array_key_exists('skipped', $data)) $row->skipped = $data['skipped'];
        $row->save();

        return response()->json(['day' => $this->present($row)]);
    }

    public function catchUp(Request $request, string $day): JsonResponse
    {
        $data = $request->validate([
            'ticks' => 'required|array',
            'ticks.*' => 'boolean',
        ]);
        try {
            $date = Carbon::createFromFormat('!Y-m-d', $day, config('pm.routine.timezone', 'Australia/Sydney'));
        } catch (\Throwable) {
            return response()->json(['message' => 'Invalid routine date.'], 422);
        }
        if (! $date || $date->toDateString() !== $day || $date->greaterThanOrEqualTo($this->today())) {
            return response()->json(['message' => 'Catch-up is only available for a previous day.'], 422);
        }

        $row = PmRoutineDay::query()->firstOrNew(['user_id' => $request->user()->getKey(), 'day' => $day]);
        if ($row->skipped) return response()->json(['message' => 'This day was marked as a day off.'], 422);
        $row->ticks = collect(array_merge($row->ticks ?? [], $data['ticks']))->only($this->stepsFor($date))->all();
        $row->summary = ['caught_up_at' => now()->toIso8601String()];
        $row->save();

        return response()->json(['day' => $this->present($row)]);
    }

    private function complete(PmRoutineDay $row): bool
    {
        if ($row->skipped) return false;
        $ticks = $row->ticks ?? [];
        return collect($this->stepsFor($row->day ? Carbon::parse($row->day) : $this->today()))->every(fn ($step) => (bool) ($ticks[$step] ?? false));
    }

    private function present(PmRoutineDay $row): array
    {
        $ticks = $row->ticks ?? [];
        $missed = collect($this->stepsFor($row->day ? Carbon::parse($row->day) : $this->today()))->reject(fn ($step) => (bool) ($ticks[$step] ?? false))->values()->all();
        return [
            'day' => $row->day?->toDateString(),
            'exists' => $row->exists,
            'ticks' => $ticks,
            'priorities' => $row->priorities ?? [],
            'fresh' => (bool) $row->fresh,
            'skipped' => (bool) $row->skipped,
            'missed' => $row->skipped ? [] : $missed,
            'complete' => $this->complete($row),
        ];
    }
}
