<?php

use App\Http\Controllers\EmailController;
use App\Http\Controllers\MeetingMinutesController;
use App\Http\Controllers\PmController;
use App\Http\Controllers\PmDictionaryController;
use App\Http\Controllers\PmPageController;
use App\Http\Controllers\PmOperationsController;
use App\Http\Controllers\PmOperationWorkspaceController;
use App\Http\Controllers\PmAssistantController;
use App\Http\Controllers\PmAutomationController;
use App\Http\Controllers\PmDraftController;
use App\Http\Controllers\PmMeetingTicketController;
use App\Http\Controllers\ProjectController;
use App\Http\Controllers\ReportController;
use App\Http\Controllers\PmQaController;
use App\Http\Controllers\PmQaCenterController;
use App\Http\Controllers\PmActionItemController;
use App\Http\Controllers\PmRoutineController;
use Illuminate\Support\Facades\Route;

// Pages: one real URL per tab, so each opens on its own and Back/Forward/bookmarks work.
Route::middleware('auth')->prefix('pm')->name('pm.')->group(function () {
    Route::get('/', [PmController::class, 'index'])->name('index');
    Route::get('assistant', [PmAssistantController::class, 'page'])->name('page.assistant');
    Route::get('tasks', [PmPageController::class, 'tasks'])->name('page.tasks');
    Route::get('operations', [PmPageController::class, 'operations'])->name('page.operations');
    Route::get('projects', [PmPageController::class, 'projects'])->name('page.projects');
    Route::get('minutes', [PmPageController::class, 'minutes'])->name('page.minutes');
    Route::get('brief', [PmPageController::class, 'brief'])->name('page.brief');
    Route::get('reports', [PmPageController::class, 'reports'])->name('page.reports');
    Route::get('scope', [PmPageController::class, 'scope'])->name('page.scope');
    Route::get('git', [PmPageController::class, 'git'])->name('page.git');
    Route::get('qa', [PmPageController::class, 'qa'])->name('page.qa');
    Route::get('qa-reports', [PmPageController::class, 'qaReports'])->name('page.qa-reports');
    Route::get('checklist', [PmPageController::class, 'checklist'])->name('page.checklist');
    Route::get('action-list', [PmPageController::class, 'actionList'])->name('page.action-list');
    Route::get('dictionary', [PmPageController::class, 'dictionary'])->name('page.dictionary');
});

// JSON API used by those pages.
Route::middleware(['auth', 'throttle:120,1'])->prefix('pm/api')->name('pm.')->group(function () {
    Route::get('recent-pushes', [PmController::class, 'recentPushes'])->name('recent-pushes');
    Route::post('ask', [PmController::class, 'ask'])->name('ask');
    Route::get('assistant/status', [PmAssistantController::class, 'status'])->name('assistant.status');
    Route::post('assistant/chat', [PmAssistantController::class, 'chat'])->middleware('throttle:20,1')->name('assistant.chat');
    Route::post('assistant/actions/{action}/confirm', [PmAssistantController::class, 'confirm'])->whereUuid('action')->name('assistant.confirm');
    Route::post('assistant/actions/{action}/cancel', [PmAssistantController::class, 'cancel'])->whereUuid('action')->name('assistant.cancel');
    Route::get('today', [PmController::class, 'today'])->name('today');
    Route::get('workload', [PmController::class, 'workload'])->name('workload');
    // Private dictionary of keywords that sort tasks into categories (and can serve other features later).
    Route::prefix('dictionary')->name('dictionary.')->group(function () {
        Route::get('/', [PmDictionaryController::class, 'index'])->name('index');
        Route::post('terms', [PmDictionaryController::class, 'store'])->name('terms.store');
        Route::patch('terms/{term}', [PmDictionaryController::class, 'update'])->name('terms.update');
        Route::delete('terms/{term}', [PmDictionaryController::class, 'destroy'])->name('terms.destroy');
        Route::post('preview', [PmDictionaryController::class, 'preview'])->name('preview');
        Route::post('test', [PmDictionaryController::class, 'test'])->name('test');
        Route::get('review', [PmDictionaryController::class, 'review'])->name('review');
        Route::put('cards/{card}/category', [PmDictionaryController::class, 'setOverride'])->name('override.set');
        Route::delete('cards/{card}/category', [PmDictionaryController::class, 'clearOverride'])->name('override.clear');
    });
    Route::get('routine', [PmRoutineController::class, 'show'])->name('routine.show');
    Route::put('routine', [PmRoutineController::class, 'save'])->name('routine.save');
    Route::post('routine/{day}/catch-up', [PmRoutineController::class, 'catchUp'])->where('day', '\\d{4}-\\d{2}-\\d{2}')->name('routine.catch-up');
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
    Route::prefix('operation')->name('operation.')->group(function () {
        Route::get('goals', [PmOperationWorkspaceController::class, 'goals'])->name('goals.index');
        Route::post('goals', [PmOperationWorkspaceController::class, 'storeGoal'])->name('goals.store');
        Route::patch('goals/{goal}', [PmOperationWorkspaceController::class, 'updateGoal'])->name('goals.update');
        Route::delete('goals/{goal}', [PmOperationWorkspaceController::class, 'deleteGoal'])->name('goals.destroy');
        Route::get('plans', [PmOperationWorkspaceController::class, 'plans'])->name('plans.index');
        Route::post('plans', [PmOperationWorkspaceController::class, 'storePlan'])->name('plans.store');
        Route::patch('plans/{plan}', [PmOperationWorkspaceController::class, 'updatePlan'])->name('plans.update');
        Route::post('plans/{plan}/transition', [PmOperationWorkspaceController::class, 'transitionPlan'])->name('plans.transition');
        Route::post('plans/{plan}/duplicate', [PmOperationWorkspaceController::class, 'duplicatePlan'])->name('plans.duplicate');
        Route::delete('plans/{plan}', [PmOperationWorkspaceController::class, 'deletePlan'])->name('plans.destroy');
    });
    Route::get('businesses', [PmOperationsController::class, 'businesses'])->name('businesses.index');
    Route::post('businesses', [PmOperationsController::class, 'storeBusiness'])->name('businesses.store');
    Route::patch('businesses/{business}', [PmOperationsController::class, 'updateBusiness'])->name('businesses.update');
    Route::post('businesses/{business}/projects', [PmOperationsController::class, 'attachProject'])->name('businesses.projects.store');
    Route::delete('businesses/{business}/projects/{projectId}', [PmOperationsController::class, 'removeProject'])->where('projectId', '[0-9a-fA-F]{24}')->name('businesses.projects.destroy');
    Route::get('intakes', [PmOperationsController::class, 'intakes'])->name('intakes.index');
    Route::post('intakes', [PmOperationsController::class, 'storeIntake'])->name('intakes.store');
    Route::patch('intakes/{intake}', [PmOperationsController::class, 'updateIntake'])->name('intakes.update');
    Route::delete('intakes/{intake}', [PmOperationsController::class, 'deleteIntake'])->name('intakes.destroy');
    Route::get('employees', [PmController::class, 'employees'])->name('employees');
    Route::get('drafts', [PmDraftController::class, 'index'])->name('drafts.index');
    Route::post('drafts', [PmDraftController::class, 'store'])->name('drafts.store');
    Route::get('drafts/{draft}', [PmDraftController::class, 'show'])->name('drafts.show');
    Route::patch('drafts/{draft}', [PmDraftController::class, 'update'])->name('drafts.update');
    Route::post('drafts/{draft}/verify', [PmDraftController::class, 'verify'])->name('drafts.verify');
    Route::delete('drafts/{draft}', [PmDraftController::class, 'destroy'])->name('drafts.destroy');
    Route::get('action-items', [PmActionItemController::class, 'index'])->name('action-items.index');
    Route::post('action-items', [PmActionItemController::class, 'store'])->name('action-items.store');
    Route::patch('action-items/{item}', [PmActionItemController::class, 'update'])->name('action-items.update');
    Route::delete('action-items/{item}', [PmActionItemController::class, 'destroy'])->name('action-items.destroy');
    Route::get('qa', [PmQaController::class, 'index'])->name('qa.index');
    // QA Center tab: Queue -> Testing -> Failed / Passed over site checks and Taskmandu task reviews.
    Route::prefix('qa-center')->name('qa-center.')->where(['kind' => 'issue|task', 'id' => '[0-9]+', 'check' => '[0-9]+'])->group(function () {
        Route::get('/', [PmQaCenterController::class, 'index'])->name('index');
        Route::post('projects', [PmQaCenterController::class, 'storeProject'])->name('projects.store');
        Route::post('items', [PmQaCenterController::class, 'store'])->name('items.store');
        Route::patch('items/{kind}/{id}', [PmQaCenterController::class, 'update'])->name('items.update');
        Route::delete('items/{kind}/{id}', [PmQaCenterController::class, 'destroy'])->name('items.destroy');
        Route::post('items/{kind}/{id}/checks', [PmQaCenterController::class, 'storeChecks'])->name('items.checks.store');
        Route::patch('items/{kind}/{id}/checks/{check}', [PmQaCenterController::class, 'updateCheck'])->name('items.checks.update');
        Route::delete('items/{kind}/{id}/checks/{check}', [PmQaCenterController::class, 'destroyCheck'])->name('items.checks.destroy');
        Route::post('items/{kind}/{id}/screenshots', [PmQaCenterController::class, 'storeScreenshot'])->name('items.screenshots.store');
        Route::post('items/{kind}/{id}/subtasks', [PmQaCenterController::class, 'importSubtasks'])->name('items.subtasks.import');
        // Live Taskmandu data for a task item: subtasks (the checklist) and comments, written back through the Taskmandu API.
        Route::prefix('tasks/{id}/taskmandu')->where(['subtask' => '[A-Za-z0-9]+'])->name('taskmandu.')->group(function () {
            Route::get('/', [PmQaCenterController::class, 'taskmandu'])->name('show');
            Route::patch('task', [PmQaCenterController::class, 'renameTask'])->name('task');
            Route::post('subtasks', [PmQaCenterController::class, 'addSubtask'])->name('subtasks.store');
            Route::patch('subtasks/{subtask}', [PmQaCenterController::class, 'renameSubtask'])->name('subtasks.update');
            Route::delete('subtasks/{subtask}', [PmQaCenterController::class, 'deleteSubtask'])->name('subtasks.destroy');
            Route::post('comments', [PmQaCenterController::class, 'addComment'])->name('comments.store');
        });
        Route::post('reports', [PmQaCenterController::class, 'storeReport'])->name('reports.store');
        Route::patch('reports/{report}', [PmQaCenterController::class, 'updateReport'])->name('reports.update');
        Route::delete('items/{kind}/{id}/screenshots/{screenshot}', [PmQaCenterController::class, 'destroyScreenshot'])->name('items.screenshots.destroy');
    });
    Route::post('qa/websites', [PmQaController::class, 'storeWebsite'])->name('qa.websites.store');
    Route::patch('qa/websites/{website}', [PmQaController::class, 'updateWebsite'])->name('qa.websites.update');
    Route::delete('qa/websites/{website}', [PmQaController::class, 'destroyWebsite'])->name('qa.websites.destroy');
    Route::post('qa/quick-capture/draft', [PmQaController::class, 'draftQuickCapture'])->middleware('throttle:10,1')->name('qa.quick-capture.draft');
    Route::post('qa/quick-capture/save', [PmQaController::class, 'saveQuickCapture'])->name('qa.quick-capture.save');
    Route::get('qa/reports', [PmQaController::class, 'reports'])->name('qa.reports.index');
    Route::post('qa/reports', [PmQaController::class, 'storeReport'])->name('qa.reports.store');
    Route::patch('qa/reports/{report}', [PmQaController::class, 'updateReport'])->name('qa.reports.update');
    Route::patch('qa/reports/{report}/handover', [PmQaController::class, 'handoverReport'])->name('qa.reports.handover');
    Route::get('qa/task-inbox', [PmQaController::class, 'taskInbox'])->name('qa.task-inbox');
    Route::patch('qa/task-inbox/{review}', [PmQaController::class, 'updateTaskReview'])->name('qa.task-inbox.update');
    Route::post('qa', [PmQaController::class, 'store'])->name('qa.store');
    Route::patch('qa/{issue}', [PmQaController::class, 'update'])->name('qa.update');
    Route::delete('qa/{issue}', [PmQaController::class, 'destroy'])->name('qa.destroy');
    Route::get('reports/period', [ReportController::class, 'period'])->name('reports.period');
    Route::get('reports/overview', [ReportController::class, 'overview'])->name('reports.overview');
    Route::get('reports', [ReportController::class, 'index'])->name('reports.index');
    Route::post('reports', [ReportController::class, 'store'])->name('reports.store');
    Route::post('reports/pack', [ReportController::class, 'storePack'])->name('reports.pack');
    Route::patch('reports/{report}', [ReportController::class, 'update'])->name('reports.update');
    Route::get('reports/{report}/docx', [ReportController::class, 'exportDocx'])->name('reports.docx');
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
});

// Project passthrough to Taskmandu: each call fans out to the Taskmandu API and the UI
// re-fetches projects often (open, task polling every 15s), so it gets its own, higher limit.
Route::middleware(['auth', 'throttle:240,1'])->prefix('pm/api')->name('pm.')->group(function () {
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
