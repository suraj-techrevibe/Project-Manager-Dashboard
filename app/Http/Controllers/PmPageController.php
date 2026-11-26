<?php

namespace App\Http\Controllers;

use Inertia\Inertia;
use Inertia\Response;

/**
 * Each PM tab has a real URL and loads its own data from the JSON API.
 */
class PmPageController extends Controller
{
    public function tasks(): Response
    {
        return Inertia::render('Pm/App', ['page' => 'tasks']);
    }

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

    public function qa(): Response
    {
        return Inertia::render('Pm/App', ['page' => 'qa']);
    }

    public function qaReports(): Response
    {
        return Inertia::render('Pm/App', ['page' => 'qa-reports']);
    }

    public function checklist(): Response
    {
        return Inertia::render('Pm/App', ['page' => 'checklist']);
    }

    public function actionList(): Response
    {
        return Inertia::render('Pm/App', ['page' => 'action-list']);
    }

    public function dictionary(): Response
    {
        return Inertia::render('Pm/App', ['page' => 'dictionary']);
    }
}
