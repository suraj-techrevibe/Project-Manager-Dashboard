<?php

namespace App\Http\Controllers;

use App\Services\Pm\AssistantService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;
use RuntimeException;

class PmAssistantController extends Controller
{
    public function __construct(private AssistantService $assistant) {}

    public function page(): Response
    {
        return Inertia::render('Pm/App', ['page' => 'assistant']);
    }

    public function chat(Request $request): JsonResponse
    {
        $data = $request->validate([
            'messages' => 'required|array|min:1|max:30',
            'messages.*.role' => 'required|in:user,assistant',
            'messages.*.content' => 'required|string|max:8000',
        ]);

        @set_time_limit(150);

        try {
            return response()->json($this->assistant->chat($data['messages'], $request->user()));
        } catch (RuntimeException $e) {
            return response()->json(['error' => $e->getMessage()], 422);
        } catch (\Throwable $e) {
            report($e);

            return response()->json(['error' => "The assistant hit a problem: {$e->getMessage()}"], 500);
        }
    }

    public function confirm(Request $request, string $action): JsonResponse
    {
        return $this->handle(fn () => $this->assistant->confirm($action, $request->user()));
    }

    public function cancel(Request $request, string $action): JsonResponse
    {
        return $this->handle(fn () => $this->assistant->cancel($action, $request->user()));
    }

    private function handle(callable $fn): JsonResponse
    {
        try {
            return response()->json($fn());
        } catch (RuntimeException $e) {
            return response()->json(['error' => $e->getMessage()], 410);
        }
    }
}
