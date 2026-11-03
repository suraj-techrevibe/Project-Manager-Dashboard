<?php

namespace App\Services\Pm;

use App\Models\PmTaskSyncRequest;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class TaskSyncApprovalService
{
    /** Queue a proposed Taskmandu write. This method never calls Taskmandu. */
    public function request(
        string $action,
        array $payload,
        ?int $cardId = null,
        ?string $projectId = null,
        ?string $taskmanduTaskId = null,
        ?int $requestedBy = null,
        ?string $idempotencyKey = null,
    ): PmTaskSyncRequest {
        if (!in_array($action, ['create', 'update', 'delete'], true)) {
            throw ValidationException::withMessages(['action' => 'Unsupported Taskmandu sync action.']);
        }

        return PmTaskSyncRequest::firstOrCreate(
            ['idempotency_key' => $idempotencyKey ?: (string) Str::uuid()],
            [
                'pm_card_id' => $cardId,
                'project_id' => $projectId,
                'taskmandu_task_id' => $taskmanduTaskId,
                'action' => $action,
                'payload' => $payload,
                'status' => 'pending',
                'requested_by' => $requestedBy,
            ],
        );
    }

    public function approve(int $id, int $reviewerId): PmTaskSyncRequest
    {
        return DB::transaction(function () use ($id, $reviewerId) {
            $request = PmTaskSyncRequest::query()->lockForUpdate()->findOrFail($id);
            if ($request->status !== 'pending') {
                throw ValidationException::withMessages(['status' => 'Only pending requests can be approved.']);
            }
            $request->forceFill([
                'status' => 'approved',
                'reviewed_by' => $reviewerId,
                'reviewed_at' => now(),
                'failure_reason' => null,
            ])->save();

            return $request->refresh();
        });
    }

    public function reject(int $id, int $reviewerId): PmTaskSyncRequest
    {
        return DB::transaction(function () use ($id, $reviewerId) {
            $request = PmTaskSyncRequest::query()->lockForUpdate()->findOrFail($id);
            if ($request->status !== 'pending') {
                throw ValidationException::withMessages(['status' => 'Only pending requests can be rejected.']);
            }
            $request->forceFill([
                'status' => 'rejected',
                'reviewed_by' => $reviewerId,
                'reviewed_at' => now(),
            ])->save();

            return $request->refresh();
        });
    }

    public function markDelivered(PmTaskSyncRequest $request): void
    {
        if ($request->status !== 'approved') {
            throw ValidationException::withMessages(['status' => 'Only approved requests can be delivered.']);
        }
        $request->forceFill(['status' => 'delivered', 'delivered_at' => now(), 'failure_reason' => null])->save();
    }

    public function markFailed(PmTaskSyncRequest $request, string $reason): void
    {
        if ($request->status !== 'approved') {
            throw ValidationException::withMessages(['status' => 'Only approved requests can be delivered.']);
        }
        $request->forceFill(['status' => 'failed', 'failure_reason' => mb_substr($reason, 0, 10000)])->save();
    }

    public function retry(int $id): PmTaskSyncRequest
    {
        $request = PmTaskSyncRequest::query()->findOrFail($id);
        if ($request->status !== 'failed') {
            throw ValidationException::withMessages(['status' => 'Only failed requests can be retried.']);
        }
        $request->forceFill(['status' => 'approved', 'failure_reason' => null])->save();

        return $request->refresh();
    }
}
