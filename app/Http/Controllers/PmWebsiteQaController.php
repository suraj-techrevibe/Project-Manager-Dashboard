<?php

namespace App\Http\Controllers;

use App\Models\PmBusiness;
use App\Models\PmQaWebsite;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Validation\Rule;

class PmWebsiteQaController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        return response()->json([
            'websites' => PmQaWebsite::query()->where('created_by', $request->user()->id)
                ->orderBy('business')->orderBy('name')->get(),
            'businesses' => PmBusiness::query()->orderBy('name')->pluck('name'),
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $businesses = PmBusiness::query()->pluck('name')->all();
        $data = $request->validate([
            'business' => ['required', 'string', 'max:160', Rule::in($businesses)],
            'name' => ['required', 'string', 'max:200'],
            'url' => ['required', 'url', 'max:1000'],
        ]);

        $website = PmQaWebsite::create([
            ...$data,
            'created_by' => $request->user()->id,
        ]);

        return response()->json(['website' => $website], 201);
    }

    public function destroy(Request $request, PmQaWebsite $website): JsonResponse
    {
        abort_unless($website->created_by === $request->user()->id, 404);
        $website->delete();

        return response()->json(['deleted' => true]);
    }

    public function run(Request $request, PmQaWebsite $website): JsonResponse
    {
        abort_unless($website->created_by === $request->user()->id, 404);

        $parts = parse_url($website->url);
        $host = strtolower($parts['host'] ?? '');
        if (!in_array($parts['scheme'] ?? '', ['http', 'https'], true)
            || $host === ''
            || isset($parts['user'])
            || isset($parts['pass'])
            || $host === 'localhost'
            || filter_var($host, FILTER_VALIDATE_IP)) {
            return response()->json(['message' => 'Only public HTTP or HTTPS website addresses can be checked.'], 422);
        }

        $records = @dns_get_record($host, DNS_A | DNS_AAAA) ?: [];
        $ips = collect($records)->map(fn ($record) => $record['ip'] ?? $record['ipv6'] ?? null)->filter()->unique();
        if ($ips->isEmpty() || $ips->contains(fn ($ip) => !filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE))) {
            return response()->json(['message' => 'The website must resolve only to public IP addresses before it can be checked.'], 422);
        }

        $started = microtime(true);
        try {
            // Redirects are deliberately not followed: each redirect target must be registered and checked separately.
            $response = Http::timeout(10)->withoutRedirecting()->withHeaders([
                'User-Agent' => 'PM-Dashboard-QA/1.0',
            ])->get($website->url);
            $elapsed = (int) round((microtime(true) - $started) * 1000);
            $status = $response->status();
            $healthy = $status >= 200 && $status < 400;
            $website->update([
                'status' => $healthy ? 'Healthy' : 'Issues found',
                'last_http_status' => $status,
                'last_response_ms' => $elapsed,
                'last_result' => $healthy
                    ? ($status >= 300 ? 'Website responded with a redirect. Register the final destination to monitor it directly.' : 'Website responded successfully.')
                    : 'Website returned an HTTP error response.',
                'last_checked_at' => now(),
            ]);
        } catch (\Throwable $exception) {
            $website->update([
                'status' => 'Issues found',
                'last_http_status' => null,
                'last_response_ms' => (int) round((microtime(true) - $started) * 1000),
                'last_result' => 'The website did not respond successfully: '.$exception->getMessage(),
                'last_checked_at' => now(),
            ]);
        }

        return response()->json(['website' => $website->fresh()]);
    }
}
