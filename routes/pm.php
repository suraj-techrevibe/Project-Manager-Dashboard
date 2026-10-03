<?php

use App\Http\Controllers\PmController;
use App\Http\Controllers\ProjectController;
use Illuminate\Support\Facades\Route;

Route::middleware(['auth', 'throttle:30,1'])->prefix('pm')->name('pm.')->group(function () {
    Route::get('/', [PmController::class, 'index'])->name('index');
    Route::post('ask', [PmController::class, 'ask'])->name('ask');
    Route::post('cards/{card}/nudge', [PmController::class, 'nudge'])->name('nudge');
    Route::post('cards/{card}/snooze', [PmController::class, 'snooze'])->name('snooze');
    Route::post('cards/{card}/verify', [PmController::class, 'verify'])->name('verify');
    Route::post('brief', [PmController::class, 'brief'])->name('brief');
    Route::post('brief/push', [PmController::class, 'push'])->name('brief.push');
    Route::get('employees', [PmController::class, 'employees'])->name('employees');
    Route::post('client-update', [PmController::class, 'clientUpdate'])->name('client-update');
    Route::post('scope', [PmController::class, 'scope'])->name('scope');
    Route::post('scope/email', [PmController::class, 'scopeEmail'])->name('scope.email');

    // Git status is safe to expose to any authed user; the mutating actions
    // (fetch/pull/push/checkout) run real git commands against the server's
    // checkout, so restrict them further in production — see README.
    Route::get('git/status', [PmController::class, 'gitStatus'])->name('git.status');
    Route::post('git/fetch', [PmController::class, 'gitFetch'])->name('git.fetch');
    Route::post('git/pull', [PmController::class, 'gitPull'])->name('git.pull');
    Route::post('git/push', [PmController::class, 'gitPush'])->name('git.push');
    Route::post('git/checkout', [PmController::class, 'gitCheckout'])->name('git.checkout');

    // Live passthrough to Taskmandu's real Project/board API — see
    // ProjectController. Project/task ids are Mongo ObjectIds (24-char hex
    // strings), not local Eloquent models, so they're plain route params.
    Route::get('projects', [ProjectController::class, 'index'])->name('projects.index');
    Route::post('projects', [ProjectController::class, 'store'])->name('projects.store');
    Route::get('projects/{project}', [ProjectController::class, 'show'])->name('projects.show');
    Route::patch('projects/{project}', [ProjectController::class, 'update'])->name('projects.update');
    Route::delete('projects/{project}', [ProjectController::class, 'destroy'])->name('projects.destroy');
    Route::post('projects/{project}/tasks', [ProjectController::class, 'addTask'])->name('projects.tasks.store');
    Route::patch('projects/{project}/tasks/{task}', [ProjectController::class, 'updateTask'])->name('projects.tasks.update');
    Route::delete('projects/{project}/tasks/{task}', [ProjectController::class, 'deleteTask'])->name('projects.tasks.destroy');
});
