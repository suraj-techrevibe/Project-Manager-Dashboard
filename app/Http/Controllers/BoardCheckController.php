<?php

namespace App\Http\Controllers;

use App\Services\Pm\BoardChecks;
use Illuminate\Http\JsonResponse;

/** Button-driven "Ask" checklist — answers come from the local board, no AI. */
class BoardCheckController extends Controller
{
    public function __construct(private BoardChecks $checks) {}

    public function index(): JsonResponse
    {
        return response()->json(['checks' => $this->checks->list()]);
    }

    public function show(string $check): JsonResponse
    {
        abort_unless($this->checks->has($check), 404);

        return response()->json($this->checks->run($check));
    }
}
