<?php

namespace App\Http\Controllers;

use Inertia\Inertia;
use Inertia\Response;

/**
 * One real page per PM tab (Projects, Meeting minutes, Brief to tickets,
 * Reports, Scope check, Git). Each page loads its own data from the JSON API
 * under /pm/api, so opening one never loads the others. Today is still
 * PmController::index because it needs the flag payload up front.
 */
class PmPageController extends Controller
{
    public function projects(): Response
    {
        return Inertia::render('Pm/App', ['page' => 'projects']);
    }

    public function minutes(): Response
    {
        return Inertia::render('Pm/App', ['page' => 'minutes']);
    }

    public function brief(): Response
    {
        return Inertia::render('Pm/App', ['page' => 'brief']);
    }

    public function reports(): Response
    {
        return Inertia::render('Pm/App', ['page' => 'reports']);
    }

    public function scope(): Response
    {
        return Inertia::render('Pm/App', ['page' => 'scope']);
    }

    public function git(): Response
    {
        return Inertia::render('Pm/App', ['page' => 'git']);
    }
}
