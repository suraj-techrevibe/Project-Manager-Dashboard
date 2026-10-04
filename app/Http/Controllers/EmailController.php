<?php

namespace App\Http\Controllers;

use App\Models\PmActivity;
use App\Models\PmCard;
use App\Models\PmContact;
use App\Services\Pm\TaskmanduSync;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Mail;
use Throwable;

/**
 * Plain email (Brevo SMTP via the MAIL_* settings) for nudges and meeting minutes.
 * The PM reviews the message in the modal first; nothing is sent automatically.
 */
class EmailController extends Controller
{
    public function __construct(private TaskmanduSync $taskmandu) {}

    /** Team members from Taskmandu plus anyone saved by hand, each with their saved email (or ''). */
    public function contacts(): JsonResponse
    {
        $saved = PmContact::query()->get()->keyBy(fn ($c) => mb_strtolower($c->name));

        $staff = [];
        if ($this->taskmandu->configured()) {
            $staff = Cache::get('pm.employees');
            if ($staff === null) {
                try {
                    $staff = $this->taskmandu->listEmployees();
                    Cache::put('pm.employees', $staff, 600);
                } catch (Throwable $e) {
                    report($e);
                    $staff = [];
                }
            }
        }

        $rows = collect($staff)->map(fn ($e) => [
            'name' => $e['name'],
            'designation' => $e['designation'] ?? null,
            'email' => $saved->get(mb_strtolower($e['name']))?->email ?? '',
        ]);

        $known = $rows->pluck('name')->map(fn ($n) => mb_strtolower($n));
        $extras = $saved->filter(fn ($c, $key) => ! $known->contains($key))
            ->map(fn ($c) => ['name' => $c->name, 'designation' => null, 'email' => $c->email])
            ->values();

        return response()->json(['contacts' => $rows->concat($extras)->values()]);
    }

    public function saveContacts(Request $r): JsonResponse
    {
        $data = $r->validate([
            'contacts' => 'required|array|max:200',
            'contacts.*.name' => 'required|string|max:200',
            'contacts.*.email' => 'required|email|max:200',
        ]);

        foreach ($data['contacts'] as $c) {
            PmContact::updateOrCreate(['name' => trim($c['name'])], ['email' => trim($c['email'])]);
        }

        return response()->json(['saved' => count($data['contacts'])]);
    }

    public function send(Request $r): JsonResponse
    {
        $data = $r->validate([
            'to' => 'required|array|min:1|max:20',
            'to.*' => 'required|email|max:200',
            'subject' => 'required|string|max:200',
            'body' => 'required|string|max:20000',
            'card_id' => 'nullable|integer|exists:pm_cards,id',
        ]);

        $to = array_values(array_unique(array_map('strtolower', $data['to'])));
        $replyTo = config('pm.mail.reply_to');

        try {
            Mail::raw($data['body'], function ($m) use ($to, $data, $replyTo) {
                $m->to($to)->subject($data['subject']);
                if ($replyTo) {
                    $m->replyTo($replyTo);
                }
            });
        } catch (Throwable $e) {
            report($e);

            return response()->json(['error' => "Couldn't send the email: ".$e->getMessage()], 422);
        }

        // A nudge by email counts as a nudge, so Today shows "Nudged today".
        if (! empty($data['card_id']) && ($card = PmCard::find($data['card_id']))) {
            PmActivity::record('nudge', $card, ['email' => true]);
        }

        return response()->json(['sent' => count($to), 'at' => now()->toIso8601String()]);
    }
}
