<?php

namespace App\Http\Controllers;

use Inertia\Inertia;
use Inertia\Response;

/**
 * Each PM tab has a real URL and loads its own data from the JSON API.
 */
class PmPageController extends Controller
{
    public function operations(): Response
    {
        return Inertia::render('Pm/App', ['page' => 'operations']);
    }

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
