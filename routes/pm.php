<?php

use App\Http\Controllers\EmailController;
use App\Http\Controllers\MeetingMinutesController;
use App\Http\Controllers\PmController;
use App\Http\Controllers\PmPageController;
use App\Http\Controllers\PmAutomationController;
use App\Http\Controllers\PmDraftController;
use App\Http\Controllers\PmMeetingTicketController;
use App\Http\Controllers\ProjectController;
use App\Http\Controllers\ReportController;
use Illuminate\Support\Facades\Route;

// Pages: one real URL per tab, so each opens on its own and Back/Forward/bookmarks work.
Route::middleware('auth')->prefix('pm')->name('pm.')->group(function () {
    Route::get('/', [PmController::class, 'index'])->name('index');
    Route::get('projects', [PmPageController::class, 'projects'])->name('page.projects');
    Route::get('minutes', [PmPageController::class, 'minutes'])->name('page.minutes');
    Route::get('brief', [PmPageController::class, 'brief'])->name('page.brief');
    Route::get('reports', [PmPageController::class, 'reports'])->name('page.reports');
    Route::get('scope', [PmPageController::class, 'scope'])->name('page.scope');
    Route::get('git', [PmPageController::class, 'git'])->name('page.git');
});

// JSON API used by those pages.
Route::middleware(['auth', 'throttle:30,1'])->prefix('pm/api')->name('pm.')->group(function () {
    Route::get('recent-pushes', [PmController::class, 'recentPushes'])->name('recent-pushes');
    Route::post('ask', [PmController::class, 'ask'])->name('ask');
    Route::get('today', [PmController::class, 'today'])->name('today');
    Route::post('sync', [PmController::class, 'sync'])->name('sync');
    Route::get('digest', [PmController::class, 'digest'])->name('digest');
    Route::post('digest/send', [PmController::class, 'digestSend'])->name('digest.send');
    Route::post('cards/{card}/nudged', [PmController::class, 'nudged'])->name('nudged');
    Route::post('cards/{card}/nudge', [PmController::class, 'nudge'])->name('nudge');
    Route::post('cards/{card}/snooze', [PmController::class, 'snooze'])->name('snooze');
    Route::post('cards/{card}/verify', [PmController::class, 'verify'])->name('verify');
    Route::post('subtasks/{subtask}/assign', [PmController::class, 'assignSubtask'])->name('subtasks.assign');
    Route::post('subtasks/{subtask}/snooze', [PmController::class, 'snoozeSubtask'])->name('subtasks.snooze');
    Route::post('brief', [PmController::class, 'brief'])->name('brief');
    Route::get('brief/context', [PmController::class, 'briefContext'])->name('brief.context');
    Route::post('brief/push', [PmMeetingTicketController::class, 'push'])->name('brief.push');
    Route::get('brief/pushes', [PmController::class, 'recentPushes'])->name('brief.pushes');
    Route::post('brief/pushes/{activity}/undo', [PmController::class, 'undoPush'])->name('brief.pushes.undo');
    Route::get('automation/health', [PmAutomationController::class, 'health'])->name('automation.health');
    Route::get('employees', [PmController::class, 'employees'])->name('employees');
    Route::get('drafts', [PmDraftController::class, 'index'])->name('drafts.index');
    Route::post('drafts', [PmDraftController::class, 'store'])->name('drafts.store');
    Route::get('drafts/{draft}', [PmDraftController::class, 'show'])->name('drafts.show');
    Route::patch('drafts/{draft}', [PmDraftController::class, 'update'])->name('drafts.update');
    Route::post('drafts/{draft}/verify', [PmDraftController::class, 'verify'])->name('drafts.verify');
    Route::delete('drafts/{draft}', [PmDraftController::class, 'destroy'])->name('drafts.destroy');
    Route::get('reports', [ReportController::class, 'index'])->name('reports.index');
    Route::post('reports', [ReportController::class, 'store'])->name('reports.store');
    Route::delete('reports/{report}', [ReportController::class, 'destroy'])->name('reports.destroy');
    Route::post('scope', [PmController::class, 'scope'])->name('scope');
    Route::post('scope/email', [PmController::class, 'scopeEmail'])->name('scope.email');
    Route::get('minutes', [MeetingMinutesController::class, 'index'])->name('minutes.index');
    Route::post('minutes', [MeetingMinutesController::class, 'store'])->name('minutes.store');
    Route::post('minutes/draft', [MeetingMinutesController::class, 'draft'])->name('minutes.draft');
    Route::get('minutes/carry-over', [MeetingMinutesController::class, 'carryOver'])->name('minutes.carry-over');
    Route::post('minutes/activity-draft', [MeetingMinutesController::class, 'activityDraft'])->name('minutes.activity-draft');
    Route::get('minutes/{minute}', [MeetingMinutesController::class, 'show'])->name('minutes.show');
    Route::post('minutes/{minute}/push', [MeetingMinutesController::class, 'pushToTaskmandu'])->name('minutes.push');
    Route::patch('minutes/{minute}', [MeetingMinutesController::class, 'update'])->name('minutes.update');
    Route::delete('minutes/{minute}', [MeetingMinutesController::class, 'destroy'])->name('minutes.destroy');
    Route::get('contacts', [EmailController::class, 'contacts'])->name('contacts.index');
    Route::put('contacts', [EmailController::class, 'saveContacts'])->name('contacts.save');
    Route::post('email', [EmailController::class, 'send'])->name('email.send');
    Route::get('git/status', [PmController::class, 'gitStatus'])->name('git.status');
    Route::post('git/fetch', [PmController::class, 'gitFetch'])->name('git.fetch');
    Route::post('git/pull', [PmController::class, 'gitPull'])->name('git.pull');
    Route::post('git/push', [PmController::class, 'gitPush'])->name('git.push');
    Route::post('git/checkout', [PmController::class, 'gitCheckout'])->name('git.checkout');
    Route::prefix('projects')->name('projects.')->where(['project'=>'[0-9a-fA-F]{24}','task'=>'[0-9a-fA-F]{24}','subTask'=>'[0-9a-fA-F]{24}','document'=>'[0-9a-fA-F]{24}','variable'=>'[0-9a-fA-F]{24}','member'=>'[0-9a-fA-F]{24}'])->group(function () {
        Route::get('/', [ProjectController::class, 'index'])->name('index');
        Route::post('/', [ProjectController::class, 'store'])->name('store');
        Route::get('{project}', [ProjectController::class, 'show'])->name('show');
        Route::patch('{project}', [ProjectController::class, 'update'])->name('update');
        Route::delete('{project}', [ProjectController::class, 'destroy'])->name('destroy');
        Route::post('{project}/documents', [ProjectController::class, 'addDocument'])->name('documents.store');
        Route::patch('{project}/documents/{document}', [ProjectController::class, 'updateDocument'])->name('documents.update');
        Route::delete('{project}/documents/{document}', [ProjectController::class, 'deleteDocument'])->name('documents.destroy');
        Route::post('{project}/variables', [ProjectController::class, 'addVariable'])->name('variables.store');
        Route::patch('{project}/variables/{variable}', [ProjectController::class, 'updateVariable'])->name('variables.update');
        Route::delete('{project}/variables/{variable}', [ProjectController::class, 'deleteVariable'])->name('variables.destroy');
        Route::post('{project}/tasks', [ProjectController::class, 'addTask'])->name('tasks.store');
        Route::patch('{project}/tasks/{task}', [ProjectController::class, 'updateTask'])->name('tasks.update');
        Route::delete('{project}/tasks/{task}', [ProjectController::class, 'deleteTask'])->name('tasks.destroy');
        Route::post('{project}/tasks/{task}/comments', [ProjectController::class, 'addTaskComment'])->name('tasks.comments.store');
        Route::post('{project}/tasks/{task}/subtasks', [ProjectController::class, 'addSubTask'])->name('subtasks.store');
        Route::patch('{project}/tasks/{task}/subtasks/{subTask}', [ProjectController::class, 'updateSubTask'])->name('subtasks.update');
        Route::delete('{project}/tasks/{task}/subtasks/{subTask}', [ProjectController::class, 'deleteSubTask'])->name('subtasks.destroy');
        Route::post('{project}/tasks/{task}/subtasks/{subTask}/comments', [ProjectController::class, 'addSubTaskComment'])->name('subtasks.comments.store');
        Route::get('{project}/members', [ProjectController::class, 'members'])->name('members.index');
        Route::post('{project}/members', [ProjectController::class, 'addMember'])->name('members.store');
        Route::delete('{project}/members/{member}', [ProjectController::class, 'removeMember'])->name('members.destroy');
    });
});
