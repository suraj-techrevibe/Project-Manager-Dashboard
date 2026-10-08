export type Severity = 'danger' | 'warning' | 'neutral';
export interface PmFlag { card_id:number; title:string; assignee:string|null; type:'overdue'|'stuck'|'blocked'|'unassigned'|'unverified'|'due_today'|'due_soon'|'subtasks_incomplete'; severity:Severity; detail:string; url:string|null; project_id:string|null; project_name:string|null; task_id:string|null; status:string; priority:string|null; due_at:string|null; estimated_hours:number|null; tags:string[]; subtasks_count:number; subtasks_completed_count:number; subtasks_remaining_count:number; subtasks_progress:number|null; comments_count:number; assigned_by:string|null; last_activity_at:string|null; last_nudged_at:string|null; description:string|null; }
export interface TaskFocus { projectId:string; taskId:string; subId?:string; }
export interface SubtaskFlag { id:number; issues:('unassigned'|'blocked')[]; title:string; status:string; assignee:string|null; assigned_by:string|null; comments_count:number; project_id:string; project_name:string; task_id:string; subtask_id:string; parent_title:string; parent_assignee:string|null; parent_due_at:string|null; parent_overdue:boolean; age_days:number|null; }
export interface PmMetrics { overdue:number; stuck:number; blocked:number; unverified:number; unassigned:number; due_today:number; due_soon:number; subtasks_incomplete:number; }
export interface WorkloadRow { name:string; designation?:string|null; open:number; overdue:number; blocked:number; due_today?:number; hours?:number; week_hours?:number; subtasks?:number; no_estimate?:number; capacity?:number; }
export interface SinceItem { card_id:number; title:string; assignee:string|null; project_id:string|null; project_name:string|null; task_id:string|null; url:string|null; at:string|null; }
export interface SinceGroup { count:number; items:SinceItem[]; }
export interface SinceSummary { since:string; label:string; tracked:boolean; completed:SinceGroup; blocked:SinceGroup; created:SinceGroup; overdue:SinceGroup; idle:string[]; }
export type FollowUpState='blocked'|'overdue'|'stuck'|'not_pushed'|'not_started'|'in_progress'|'done'|'cancelled';
export interface FollowUpItem { requirement:string; owner:string|null; assignee:string|null; project:string|null; state:FollowUpState; detail:string; due:string|null; subtasks:{done:number;total:number}|null; url:string|null; card_id:number|null; }
export interface MeetingFollowUp { meeting:{id:number;title:string;meeting_date:string|null;days_ago:number|null}; items:FollowUpItem[]; counts:Record<FollowUpState|'total',number>; }
export interface CarryOver { from:MeetingFollowUp['meeting']|null; work_items:MeetingWorkItem[]; from_meeting:number; from_board:number; }
export interface TodayData { flags:PmFlag[]; metrics:PmMetrics; workload:WorkloadRow[]; subtasks:SubtaskFlag[]; subtask_summary:{total:number;completed:number;remaining:number;progress:number}; staff:Employee[]; since:SinceSummary; lastSyncedAt:string|null; meeting_followup?:MeetingFollowUp|null; }
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
export interface ActionItem { task:string; owner:string; due_date:string|null; }
export interface MeetingWorkItemAction { task:string; due_date:string|null; }
export interface MeetingWorkItem { owner:string; project:string; /** Set when the work item is saved as final: the Taskmandu project it points to. */ project_id?:string|null; requirement:string; discussion:string; action_items:MeetingWorkItemAction[]; due_date:string|null; /** Why a carried-over item is here. Shown in the editor only; never saved. */ note?:string; }
export type MinutesStatus='draft'|'final';
export interface MinutesTopic { title:string; notes:string; decision:string; }
export interface MeetingMinutesSummary { id:number; title:string; status:MinutesStatus; meeting_date:string; attendees:string[]; action_items:ActionItem[]; work_items?:MeetingWorkItem[]; }
export interface MeetingMinutesFull extends Omit<MeetingMinutesSummary,'action_items'> { agenda_items:string[]; topics:MinutesTopic[]|null; discussion:string|null; decisions:string[]; action_items:ActionItem[]; work_items?:MeetingWorkItem[]; raw_notes:string|null; created_by:string|null; created_at:string; updated_at:string; }
export interface MinutesDraft { title:string; attendees:string[]; agenda_items:string[]; discussion:string; decisions:string[]; action_items:ActionItem[]; work_items?:MeetingWorkItem[]; }
export interface MinutesInput { title:string; status?:MinutesStatus; topics?:MinutesTopic[]; meeting_date:string; attendees?:string[]; agenda_items?:string[]; discussion?:string; decisions?:string[]; action_items?:ActionItem[]; work_items?:MeetingWorkItem[]; raw_notes?:string; }
export interface ReportItem { title:string; project:string|null; assignee:string|null; from?:string|null; to?:string|null; due?:string|null; days?:number|null; comments?:number; kind?:'blocked'|'overdue'; }
export interface ReportPill { text:string; tone:'green'|'red'|'amber'|'slate'; }
interface ReportCommon { date:string; label:string; prepared_by:string; summary_text:string; pills?:ReportPill[]; blocker_notes:string[]; my_actions:string[]; plan:string[]; notes:string[]; notes_ai:boolean|null; notes_warning:string|null; }
export interface DailyContent extends ReportCommon { kind:'daily'; board_text:string; completed:ReportItem[]; new_tasks:ReportItem[]; moved:ReportItem[]; comments:ReportItem[]; newly_blocked:ReportItem[]; unblocked:ReportItem[]; newly_overdue:ReportItem[]; attention:ReportItem[]; team:{name:string;done:string[];moved:string[];blocked:string[];discussed:string[]}[]; }
export interface WeeklyContent extends ReportCommon { kind:'weekly'; completed_by_project:{project:string;items:ReportItem[]}[]; in_progress:ReportItem[]; blocked:ReportItem[]; overdue:ReportItem[]; team:{name:string;completed:number;open:number;in_progress:number;blocked:number;overdue:number}[]; }
export interface LegacyContent { kind?:undefined; label:string; summary_text:string; pills?:ReportPill[]; }
export type ReportContent=DailyContent|WeeklyContent|LegacyContent;
export interface Report { id:number; kind:'daily'|'weekly'; report_date:string; auto:boolean; generated_by:string|null; generated_at:string|null; notes:string|null; body:string; content:ReportContent; }
export interface Contact { name:string; designation?:string|null; email:string; }
export interface SendEmailInput { to:string[]; subject:string; body:string; card_id?:number; }
