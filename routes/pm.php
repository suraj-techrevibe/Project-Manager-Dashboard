<?php

use App\Http\Controllers\PmController;
use App\Http\Controllers\ProjectController;
use App\Http\Controllers\ReportController;
use Illuminate\Support\Facades\Route;

Route::middleware(['auth', 'throttle:30,1'])->prefix('pm')->name('pm.')->group(function () {
    Route::get('/', [PmController::class, 'index'])->name('index');
    Route::post('ask', [PmController::class, 'ask'])->name('ask');
    Route::post('cards/{card}/nudge', [PmController::class, 'nudge'])->name('nudge');
    Route::post('cards/{card}/snooze', [PmController::class, 'snooze'])->name('snooze');
    Route::post('cards/{card}/verify', [PmController::class, 'verify'])->name('verify');
    Route::post('brief', [PmController::class, 'brief'])->name('brief');
    Route::get('brief/context', [PmController::class, 'briefContext'])->name('brief.context');
    Route::post('brief/push', [PmController::class, 'push'])->name('brief.push');
    Route::get('employees', [PmController::class, 'employees'])->name('employees');
    Route::get('reports', [ReportController::class, 'index'])->name('reports.index');
    Route::post('reports', [ReportController::class, 'store'])->name('reports.store');
    Route::delete('reports/{report}', [ReportController::class, 'destroy'])->name('reports.destroy');
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

    // Live passthrough to Taskmandu's real Project API — see ProjectController.
    // Project/task/etc. ids are Mongo ObjectIds (24-char hex), not local
    // Eloquent models, so they're plain route params. The ->where() below
    // enforces that shape so a crafted id can't be used to reach other
    // Taskmandu endpoints through the service account.
    Route::prefix('projects')->name('projects.')->where([
        'project' => '[0-9a-fA-F]{24}',
        'task' => '[0-9a-fA-F]{24}',
        'subTask' => '[0-9a-fA-F]{24}',
        'document' => '[0-9a-fA-F]{24}',
        'variable' => '[0-9a-fA-F]{24}',
        'member' => '[0-9a-fA-F]{24}',
    ])->group(function () {
        Route::get('/', [ProjectController::class, 'index'])->name('index');
        Route::post('/', [ProjectController::class, 'store'])->name('store');
        Route::get('{project}', [ProjectController::class, 'show'])->name('show');
        Route::patch('{project}', [ProjectController::class, 'update'])->name('update');
        Route::delete('{project}', [ProjectController::class, 'destroy'])->name('destroy');

        // Documents (multipart upload)
        Route::post('{project}/documents', [ProjectController::class, 'addDocument'])->name('documents.store');
        Route::patch('{project}/documents/{document}', [ProjectController::class, 'updateDocument'])->name('documents.update');
        Route::delete('{project}/documents/{document}', [ProjectController::class, 'deleteDocument'])->name('documents.destroy');

        // Shared variables ("secrets")
        Route::post('{project}/variables', [ProjectController::class, 'addVariable'])->name('variables.store');
        Route::patch('{project}/variables/{variable}', [ProjectController::class, 'updateVariable'])->name('variables.update');
        Route::delete('{project}/variables/{variable}', [ProjectController::class, 'deleteVariable'])->name('variables.destroy');

        // Tasks + task comments
        Route::post('{project}/tasks', [ProjectController::class, 'addTask'])->name('tasks.store');
        Route::patch('{project}/tasks/{task}', [ProjectController::class, 'updateTask'])->name('tasks.update');
        Route::delete('{project}/tasks/{task}', [ProjectController::class, 'deleteTask'])->name('tasks.destroy');
        Route::post('{project}/tasks/{task}/comments', [ProjectController::class, 'addTaskComment'])->name('tasks.comments.store');

        // Sub-tasks + sub-task comments
        Route::post('{project}/tasks/{task}/subtasks', [ProjectController::class, 'addSubTask'])->name('subtasks.store');
        Route::patch('{project}/tasks/{task}/subtasks/{subTask}', [ProjectController::class, 'updateSubTask'])->name('subtasks.update');
        Route::delete('{project}/tasks/{task}/subtasks/{subTask}', [ProjectController::class, 'deleteSubTask'])->name('subtasks.destroy');
        Route::post('{project}/tasks/{task}/subtasks/{subTask}/comments', [ProjectController::class, 'addSubTaskComment'])->name('subtasks.comments.store');

        // Members
        Route::get('{project}/members', [ProjectController::class, 'members'])->name('members.index');
        Route::post('{project}/members', [ProjectController::class, 'addMember'])->name('members.store');
        Route::delete('{project}/members/{member}', [ProjectController::class, 'removeMember'])->name('members.destroy');
    });
});
