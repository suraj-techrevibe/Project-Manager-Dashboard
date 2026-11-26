export type Severity = 'danger' | 'warning' | 'neutral';
export interface PmFlag { card_id:number; title:string; assignee:string|null; type:'overdue'|'stuck'|'blocked'|'unassigned'|'unverified'|'due_today'|'due_soon'|'subtasks_incomplete'; severity:Severity; detail:string; url:string|null; project_id:string|null; project_name:string|null; task_id:string|null; status:string; priority:string|null; due_at:string|null; estimated_hours:number|null; tags:string[]; subtasks_count:number; subtasks_completed_count:number; subtasks_remaining_count:number; subtasks_progress:number|null; comments_count:number; assigned_by:string|null; last_activity_at:string|null; last_nudged_at:string|null; description:string|null; }
export interface TaskFocus { projectId:string; taskId:string; subId?:string; }
export interface SubtaskFlag { id:number; issues:('unassigned'|'blocked')[]; title:string; status:string; assignee:string|null; assigned_by:string|null; comments_count:number; project_id:string; project_name:string; task_id:string; subtask_id:string; parent_title:string; parent_assignee:string|null; parent_due_at:string|null; parent_overdue:boolean; age_days:number|null; }
export interface PmMetrics { overdue:number; stuck:number; blocked:number; unverified:number; unassigned:number; due_today:number; due_soon:number; subtasks_incomplete:number; }
export type TaskCategory = 'Development' | 'Research' | 'QA' | 'Maintenance' | 'Unclassified';
export type CategoryHours = Record<TaskCategory, number>;
export interface WorkloadRow { name:string; designation?:string|null; open:number; overdue:number; blocked:number; due_today?:number; hours?:number; week_hours?:number; subtasks?:number; no_estimate?:number; capacity?:number; /** Same hours as `hours`, split by task category. */ category_hours?:CategoryHours; /** Same hours as `week_hours`, split by task category. */ category_week_hours?:CategoryHours; /** Open task counts per category (tasks only, not sub-tasks). */ category_tasks?:CategoryHours; }
export interface WorkloadProject { id:string; name:string; tasks:number; hours:CategoryHours; }
export interface WorkloadResponse { workload:WorkloadRow[]; projects:WorkloadProject[]; review_count:number; }
export interface DictionaryTerm { id:number; term:string; enabled:boolean; /** Open tasks matching this term; null while disabled. */ matches:number|null; }
export interface DictionaryData { scope:string; categories:Exclude<TaskCategory,'Unclassified'>[]; terms:Record<string,DictionaryTerm[]>; open_tasks:number; }
export type DictionaryChange = { op:'add'; label:string; term:string } | { op:'remove'; id:number } | { op:'toggle'; id:number; enabled:boolean } | { op:'edit'; id:number; term:string };
export interface DictionaryPreview { total:number; before:CategoryHours; after:CategoryHours; changed_count:number; changed:{ card_id:number; title:string; assignee:string|null; project_name:string|null; from:TaskCategory; to:TaskCategory }[]; }
export interface ClassifyResult { category:TaskCategory; confidence:number; suggested:TaskCategory|null; reason:string|null; matches:{ label:string; term:string; in:'title'|'description'; points:number }[]; }
export interface CategoryReviewTask { card_id:number; title:string; description:string|null; assignee:string|null; project_id:string|null; project_name:string|null; status:string; url:string|null; category:TaskCategory; auto_category:TaskCategory; suggested:TaskCategory|null; confidence:number; reason:string|null; override:TaskCategory|null; }
export interface CategoryReview { unclassified:CategoryReviewTask[]; overrides:CategoryReviewTask[]; }
export interface SinceItem { card_id:number; title:string; assignee:string|null; project_id:string|null; project_name:string|null; task_id:string|null; url:string|null; at:string|null; }
export interface SinceGroup { count:number; items:SinceItem[]; }
export interface SinceSummary { since:string; label:string; tracked:boolean; completed:SinceGroup; blocked:SinceGroup; created:SinceGroup; overdue:SinceGroup; idle:string[]; }
export type FollowUpState='blocked'|'overdue'|'subtasks_incomplete'|'stuck'|'not_pushed'|'not_started'|'in_progress'|'done'|'cancelled';
export interface FollowUpItem { requirement:string; owner:string|null; assignee:string|null; project:string|null; state:FollowUpState; detail:string; due:string|null; subtasks:{done:number;total:number}|null; url:string|null; card_id:number|null; }
export interface MeetingFollowUp { meeting:{id:number;title:string;meeting_date:string|null;days_ago:number|null}; items:FollowUpItem[]; counts:Record<FollowUpState|'total',number>; }
export interface CarryOver { from:MeetingFollowUp['meeting']|null; work_items:MeetingWorkItem[]; from_meeting:number; from_board:number; }
export type ActivityDraftSection = 'completed'|'progress'|'in_progress'|'due'|'blocked'|'new_work';
export interface TaskmanduActivityDraft { from:string; to:string; activity_count:number; sections:Record<ActivityDraftSection, MeetingWorkItem[]>; attendees:string[]; title:string; summary:{comments:number;task_status_changes:number;subtask_status_changes:number}; }
export interface OperationsTodaySummary {
  projects: { id: string; name: string; task_count: number; completed: number; open: number; blocked: number; overdue: number; progress: number }[];
  recent_items: {
    id: number;
    kind: 'request' | 'idea';
    status: PmIntakeStatus;
    priority: PmIntakePriority;
    title: string;
    project_name: string | null;
    business_name?: string | null;
    requested_due_at: string | null;
    updated_at: string | null;
  }[];
  qa: { open: number; urgent: number; ready_for_retest: number; failed: number };
  meetings: { draft_minutes: number };
  sync: {
    configured: boolean;
    last_synced_at: string | null;
    error: { message: string; at: string } | null;
    warning: { message: string; at: string } | null;
    project_tasks: number;
    standalone_tasks: number;
  };
  counts: {
    projects_with_tasks: number;
    open_requests: number;
    requests_for_decision: number;
    ideas_for_review: number;
    overdue_requests: number;
  };
}
export interface TodayData { flags:PmFlag[]; metrics:PmMetrics; workload:WorkloadRow[]; subtasks:SubtaskFlag[]; subtask_summary:{total:number;completed:number;remaining:number;progress:number}; staff:Employee[]; since:SinceSummary; lastSyncedAt:string|null; meeting_followup?:MeetingFollowUp|null; operations_summary:OperationsTodaySummary; }
export interface DigestPreview { text:string; channels:{slack:boolean;email:boolean}; }
export interface DraftTicket { title:string; description:string; level:'senior dev'|'intern'|string; estimate_hours:number; }
export interface PushSubtask { title:string; description?:string; assignee_employee_id:string; due_date:string|null; }
export interface PushTicket { title:string; description:string; level:string; estimate_hours:number|null; priority:TaskPriority; assignee_employee_id:string; due_date:string|null; project_id?:string|null; project_name?:string|null; project_confirmed?:boolean; subtasks?:PushSubtask[]; }
export interface PushResult { index:number; ok:boolean; error?:string; task_id?:string|null; card_id?:number; fields_fallback?:boolean; capacity_warning?:string|null; subtasks_created?:number; }
export interface ExistingTitle { title:string; project_name:string|null; status:string; }
export interface BriefContext { employees:Employee[]; titles:ExistingTitle[]; }
export interface Employee { employeeId:string; id?:string|null; name:string; designation:string|null; open?:number; hours?:number; week_hours?:number; capacity?:number; }
export interface ScopeItem { request:string; verdict:'in_scope'|'out_of_scope'|'unclear'; reason:string; estimate_hours:number|null; }
export interface GitFile { status:string; file:string; }
export interface GitStatus { branch:string; has_upstream:boolean; ahead:number; behind:number; dirty:GitFile[]; last_commit:{hash:string|null;author:string|null;when:string|null;subject:string|null}; branches:string[]; }
export type ProjectStatus='Planning'|'Active'|'Blocked'|'On Hold'|'Completed';
export type TaskStatus='Assigned'|'Pending'|'In Progress'|'Blocked'|'Completed'|'Cancelled';
export type TaskPriority='Low'|'Medium'|'High'|'Critical';
export type VariableType='Environment'|'Server Creds'|'Database'|'Other';
export type MemberRole='owner'|'admin'|'member'|'viewer';
export const PROJECT_STATUSES:ProjectStatus[]=['Planning','Active','Blocked','On Hold','Completed'];
export const TASK_STATUSES:TaskStatus[]=['Assigned','Pending','In Progress','Blocked','Completed','Cancelled'];
export const TASK_PRIORITIES:TaskPriority[]=['Low','Medium','High','Critical'];
export const VARIABLE_TYPES:VariableType[]=['Environment','Server Creds','Database','Other'];
export const MEMBER_ROLES:MemberRole[]=['owner','admin','member','viewer'];
export interface ProjectComment { _id:string; text:string; authorId?:string; authorName?:string; authorRole?:string; createdAt:string; }
export interface SubTask { _id:string; title:string; assignedToId:string[]; assignedByName:string; status:TaskStatus; completedAt:string|null; comments:ProjectComment[]; createdAt:string; }
export interface ProjectTask { _id:string; title:string; description:string; assignedToId:string[]; assignedByName:string; priority:TaskPriority; dueDate:string; estimatedHours:number; status:TaskStatus; tags:string[]; comments:ProjectComment[]; subTasks:SubTask[]; createdAt:string; }
export interface ProjectDocument { _id:string; name:string; size:string; uploadedBy:string; uploadedAt:string|null; description?:string; filePath?:string; mimeType?:string; url:string|null; }
export interface SharedVariable { _id:string; key:string; value:string; isSecret:boolean; type:VariableType; description:string; updatedBy:string; updatedAt:string|null; }
export interface ProjectMember { _id:string; userId:string; role:MemberRole; name?:string; email?:string; joinedAt:string; }
export interface Project { _id:string; name:string; description:string; status:ProjectStatus; manager:string; startDate:string|null; endDate:string|null; color:string; createdBy:string; documents:ProjectDocument[]; sharedVariables:SharedVariable[]; tasks:ProjectTask[]; members:ProjectMember[]; createdAt:string; updatedAt:string; }
export interface ProjectInput { name:string; description?:string; status?:ProjectStatus; manager?:string; startDate?:string|null; endDate?:string|null; color?:string; }
export interface NewTaskInput { title:string; description?:string; assignedToId?:string[]; assignedByName?:string; priority?:TaskPriority; dueDate:string; estimatedHours?:number; status?:TaskStatus; tags?:string[]; }
export interface NewSubTaskInput { title:string; assignedToId?:string[]; assignedByName?:string; status?:TaskStatus; completedAt?:string|null; }
export interface VariableInput { key:string; value?:string; isSecret?:boolean; type?:VariableType; description?:string; }
export interface PullRequest { number:number; title:string; author:string|null; branch:string; base:string; draft:boolean; mergeable_state:string|null; checks_state:'success'|'failure'|'pending'|'unknown'; review_comments:number; updated_at:string; url:string; }
/** A follow-up. Stored in the minutes' action_items column. `done` is ticked in the detail view; `from` names the meeting it was carried over from. */
export interface ActionItem { task:string; owner:string; due_date:string|null; done?:boolean; from?:string|null; }
export interface MeetingWorkItemAction { task:string; due_date:string|null; }
export interface MeetingWorkItem { owner:string; project:string; /** Set when the work item is saved as final: the Taskmandu project it points to. */ project_id?:string|null; requirement:string; discussion:string; action_items:MeetingWorkItemAction[]; due_date:string|null; /** Why a carried-over item is here. Shown in the editor only; never saved. */ note?:string; }
export type MinutesStatus='draft'|'final';
export interface MinutesTopic { title:string; notes:string; decision:string; }
export interface MeetingMinutesSummary { id:number; title:string; status:MinutesStatus; meeting_date:string; attendees:string[]; action_items:ActionItem[]; work_items?:MeetingWorkItem[]; decisions?:string[]; topics?:MinutesTopic[]|null; }
export interface MeetingMinutesFull extends Omit<MeetingMinutesSummary,'action_items'> { agenda_items:string[]; topics:MinutesTopic[]|null; discussion:string|null; decisions:string[]; action_items:ActionItem[]; work_items?:MeetingWorkItem[]; raw_notes:string|null; created_by:string|null; created_at:string; updated_at:string; }
export interface MinutesDraft { title:string; attendees:string[]; agenda_items:string[]; discussion:string; decisions:string[]; action_items:ActionItem[]; work_items?:MeetingWorkItem[]; }
export interface MinutesInput { title:string; status?:MinutesStatus; topics?:MinutesTopic[]; meeting_date:string; attendees?:string[]; agenda_items?:string[]; discussion?:string; decisions?:string[]; action_items?:ActionItem[]; work_items?:MeetingWorkItem[]; raw_notes?:string; }
export interface ReportItem { title:string; project:string|null; project_id?:string|null; assignee:string|null; from?:string|null; to?:string|null; due?:string|null; days?:number|null; comments?:number; kind?:'blocked'|'overdue'; }
export interface ReportPill { text:string; tone:'green'|'red'|'amber'|'slate'; }
export interface ExecutiveBusiness { project_id:string; business:string; total:number; completed:number; open:number; in_progress:number; blocked:number; overdue:number; unassigned:number; qa_pending:number; qa_failed:number; subtasks_total:number; subtasks_completed:number; progress:number; health:'On track'|'Watch'|'At risk'; }
export interface ExecutiveTeam { name:string; completed:number; open:number; in_progress:number; blocked:number; overdue:number; risk_tasks:number; health:'On track'|'Watch'|'At risk'; progress:number; health_pct:number; }
export interface ExecutiveSnapshot { as_of:string; totals:{projects:number;tasks:number;completed:number;open:number;blocked:number;overdue:number;unassigned:number;qa_pending:number;qa_failed:number}; businesses:ExecutiveBusiness[]; team:ExecutiveTeam[]; }
interface ReportCommon { date:string; label:string; prepared_by:string; executive?:ExecutiveSnapshot; summary_text:string; pills?:ReportPill[]; blocker_notes:string[]; my_actions:string[]; plan:string[]; notes:string[]; notes_ai:boolean|null; notes_warning:string|null; }
export interface DailyContent extends ReportCommon { kind:'daily'; summary:{completed:number;moved:number;newly_blocked:number;newly_overdue:number;new_tasks:number}; board_text:string; completed:ReportItem[]; new_tasks:ReportItem[]; moved:ReportItem[]; comments:ReportItem[]; newly_blocked:ReportItem[]; unblocked:ReportItem[]; newly_overdue:ReportItem[]; attention:ReportItem[]; team:{name:string;done:string[];moved:string[];blocked:string[];discussed:string[]}[]; }
export interface WeeklyContent extends ReportCommon { kind:'weekly'; summary:{completed:number;prev_completed:number;new_tasks:number;prev_new_tasks:number;blocked:number;overdue:number;in_progress:number}; business_summary?:{business:string;completed:number;qa_pending:number;qa_accepted:number;open:number;in_progress:number;blocked:number;overdue:number;subtasks_total?:number;subtasks_completed?:number}[]; completed_by_business?:{business:string;items:ReportItem[]}[]; completed_by_project:{project:string;items:ReportItem[]}[]; in_progress:ReportItem[]; blocked:ReportItem[]; overdue:ReportItem[]; team:{name:string;completed:number;open:number;in_progress:number;blocked:number;overdue:number}[]; }
export interface LegacyContent { kind?:undefined; label:string; summary_text:string; pills?:ReportPill[]; }
export type ReportContent=DailyContent|WeeklyContent|LegacyContent;
export interface Report { id:number; kind:'daily'|'weekly'|'qa'|'minutes'|'performance'; report_type?:'daily'|'weekly'|'qa'|'minutes'|'performance'; period_type?:'daily'|'weekly'|'date_range'|null; period_end?:string|null; report_date:string; auto:boolean; generated_by:string|null; generated_at:string|null; notes:string|null; body:string; content:any; }
export interface Contact { name:string; designation?:string|null; email:string; }
export interface SendEmailInput { to:string[]; subject:string; body:string; card_id?:number; }


export type PmIntakeKind = 'request' | 'idea';
export type PmIntakePriority = 'low' | 'medium' | 'high' | 'critical';
export type PmIntakeSource = 'boss' | 'client' | 'team' | 'self' | 'other';
export type PmIntakeStatus =
  | 'received'
  | 'needs_clarification'
  | 'in_review'
  | 'approved'
  | 'captured'
  | 'under_review'
  | 'accepted'
  | 'rejected'
  | 'deferred'
  | 'planned';

export interface PmBusinessProjectLink {
  id: number;
  project_id: string;
  project_name: string;
  is_primary: boolean;
}

export interface PmBusiness {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  status: 'active' | 'paused';
  project_links: PmBusinessProjectLink[];
}

export interface PmIntakeTaskLink {
  id: number;
  project_id: string;
  project_name: string | null;
  task_id: string;
  card_id: number | null;
  title: string;
  url: string | null;
  status: string | null;
  assignee: string | null;
  due_at: string | null;
}

export interface PmIntake {
  id: number;
  kind: PmIntakeKind;
  status: PmIntakeStatus;
  priority: PmIntakePriority;
  title: string;
  description: string | null;
  source_type: PmIntakeSource;
  source_name: string | null;
  business_id: number | null;
  business: { id: number; name: string; slug: string } | null;
  requested_due_at: string | null;
  clarification: string | null;
  decision_notes: string | null;
  linked_project_id: string | null;
  linked_project_name: string | null;
  linked_task_id: string | null;
  task_links: PmIntakeTaskLink[];
  created_at: string | null;
  updated_at: string | null;
}

export interface PmIntakeInput {
  kind: PmIntakeKind;
  business_id?: number | null;
  linked_project_id?: string | null;
  linked_project_name?: string | null;
  title: string;
  description?: string | null;
  source_type?: PmIntakeSource;
  source_name?: string | null;
  priority?: PmIntakePriority;
  requested_due_at?: string | null;
}

export type AssistantActionStatus = 'pending' | 'running' | 'done' | 'failed' | 'cancelled';
export interface AssistantAction { id: string; tool: string; summary: string; details: Record<string, unknown>; status: AssistantActionStatus; message?: string; }
export type AssistantEngine = 'gemini' | 'claude' | 'groq' | 'openrouter';
export interface AssistantReply { reply: string; actions: AssistantAction[]; tools: string[]; suggestions?: string[]; engine?: AssistantEngine; model?: string | null; }
export interface AssistantStatus { driver: string; provider: string; ai_ready: boolean; label: string; }
export interface AssistantActionResult { ok: boolean; message: string; status: 'done' | 'failed' | 'cancelled'; }


export type PmOperationPriority = 'auto' | 'urgent' | 'high' | 'medium' | 'low';
export type PmOperationGoalType = 'business_goal' | 'event' | 'launch' | 'marketing' | 'deadline' | 'decision' | 'opportunity' | 'other';
export interface PmOperationGoal {
  id:number; business_id:number|null; business:{id:number;name:string;slug:string}|null; title:string; description:string|null;
  goal_type:PmOperationGoalType; target_date:string|null; start_date:string|null; priority:PmOperationPriority;
  effective_priority:string; status:'active'|'completed'|'cancelled'; source_notes:string|null; created_at:string|null; updated_at:string|null;
}
export interface PmOperationGoalInput {
  title:string; business_id:number|null; description?:string|null; goal_type:PmOperationGoalType; target_date:string|null;
  start_date:string|null; priority:PmOperationPriority; status:'active'|'completed'|'cancelled'; source_notes?:string|null;
}
export interface PmOperationTask {
  title:string; description?:string|null; responsible?:string|null; due_date?:string|null; dependencies?:string|null;
  priority?:PmOperationPriority; notes?:string|null;
}
export interface PmOperationMilestone { milestone:string; date?:string|null; notes?:string|null; }
export interface PmOperationRevision { id:number; revision_number:number; event:string; change_reason:string|null; snapshot:Record<string,unknown>; created_at:string|null; }
export interface PmOperationPlan {
  id:number; business_id:number|null; business:{id:number;name:string;slug:string}|null; goal_id:number|null;
  goal:{id:number;title:string;target_date:string|null}|null; title:string; priority:PmOperationPriority; effective_priority:string;
  status:'draft'|'submitted_for_approval'|'changes_requested'|'approved'|'rejected'|'in_progress'|'completed'|'archived';
  objective:string|null; background:string|null; proposed_approach:string|null; proposed_tasks:PmOperationTask[];
  timeline:PmOperationMilestone[]; resource_requirements:string|null; expected_outcomes:string|null; risks:string|null;
  boss_comments:string|null; approval_notes:string|null; additional_notes:string|null; submitted_at:string|null;
  reviewed_at:string|null; archived_at:string|null; revision_count:number; revisions:PmOperationRevision[];
  created_at:string|null; updated_at:string|null;
}
export type PmOperationPlanInput = Omit<PmOperationPlan, 'id'|'business'|'goal'|'status'|'effective_priority'|'submitted_at'|'reviewed_at'|'archived_at'|'revision_count'|'revisions'|'created_at'|'updated_at'>;
