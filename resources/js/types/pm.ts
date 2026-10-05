export type Severity = 'danger' | 'warning' | 'neutral';

export interface PmFlag {
  card_id: number;
  title: string;
  assignee: string | null;
  type: 'overdue' | 'stuck' | 'blocked' | 'unassigned' | 'unverified' | 'due_today' | 'due_soon';
  severity: Severity;
  detail: string;
  url: string | null;
  project_id: string | null;
  project_name: string | null;
  task_id: string | null;
  status: string;
  priority: string | null;
  due_at: string | null;
  estimated_hours: number | null;
  tags: string[];
  subtasks_count: number;
  comments_count: number;
  assigned_by: string | null;
  last_activity_at: string | null;
  /** When this task was last nudged (AI draft or template copy). */
  last_nudged_at: string | null;
  description: string | null;
}

/** Deep link from the Today tab into a project's Tasks tab. */
export interface TaskFocus {
  projectId: string;
  taskId: string;
  /** Also expand/scroll to this sub-task inside the task. */
  subId?: string;
}

/** A sub-task that needs a decision (nobody assigned, or blocked) — see SubtaskInbox. */
export interface SubtaskFlag {
  id: number;
  issues: ('unassigned' | 'blocked')[];
  title: string;
  status: string;
  assignee: string | null;
  assigned_by: string | null;
  comments_count: number;
  project_id: string;
  project_name: string;
  task_id: string;
  subtask_id: string;
  parent_title: string;
  parent_assignee: string | null;
  parent_due_at: string | null;
  parent_overdue: boolean;
  age_days: number | null;
}

export interface PmMetrics {
  overdue: number;
  stuck: number;
  blocked: number;
  unverified: number;
  unassigned: number;
  due_today: number;
  due_soon: number;
}

/** Per person, computed server-side from the synced cards. Includes people with nothing open. */
export interface WorkloadRow {
  name: string;
  designation?: string | null;
  open: number;
  overdue: number;
  blocked: number;
  due_today?: number;
  /** All open estimated hours (a card's hours are split between its assignees). */
  hours?: number;
  /** Open hours due by the end of this week, overdue included. */
  week_hours?: number;
  /** Open sub-tasks assigned to them (counted in `open`, but with no hours). */
  subtasks?: number;
  /** Open tasks with no estimate — their hours are unknown, so load is understated. */
  no_estimate?: number;
  /** Weekly capacity in hours (PM_WEEKLY_CAPACITY_HOURS). */
  capacity?: number;
}

export interface SinceItem {
  card_id: number;
  title: string;
  assignee: string | null;
  project_id: string | null;
  project_name: string | null;
  task_id: string | null;
  url: string | null;
  at: string | null;
}

export interface SinceGroup {
  count: number;
  items: SinceItem[];
}

/** What changed since the last working day — the morning stand-up strip. */
export interface SinceSummary {
  since: string;
  /** "yesterday", or a weekday name like "Friday" on a Monday. */
  label: string;
  /** False until pm_activities has anything in it (first sync only sets a baseline). */
  tracked: boolean;
  completed: SinceGroup;
  blocked: SinceGroup;
  created: SinceGroup;
  overdue: SinceGroup;
  idle: string[];
}

export interface TodayData {
  flags: PmFlag[];
  metrics: PmMetrics;
  workload: WorkloadRow[];
  subtasks: SubtaskFlag[];
  staff: Employee[];
  since: SinceSummary;
  lastSyncedAt: string | null;
}

export interface DigestPreview {
  text: string;
  channels: { slack: boolean; email: boolean };
}

export interface DraftTicket {
  title: string;
  description: string;
  level: 'senior dev' | 'intern' | string;
  estimate_hours: number;
}

/** One ticket as sent to /pm/brief/push — each carries its own assignee and due date. */
export interface PushTicket {
  project_id: string;
  title: string;
  description: string;
  level: string;
  estimate_hours: number | null;
  priority: TaskPriority;
  assignee_employee_id: string;
  due_date: string | null;
}

export interface PushResult {
  index: number;
  ok: boolean;
  error?: string;
  task_id?: string | null;
  card_id?: number;
  /** true when Taskmandu rejected priority/hours/tags on create and they went into the description instead */
  fields_fallback?: boolean;
}

export interface ExistingTitle {
  title: string;
  project_name: string | null;
  status: string;
}

export interface BriefDraftSummary {
  id: number;
  title: string;
  project_id: string | null;
  status: 'draft' | 'partial' | 'pushed';
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface BriefTicket {
  uid: string;
  projectId: string;
  projectTitle: string;
  title: string;
  description: string;
  level: string;
  estimate_hours: number | '';
  priority: TaskPriority;
  assigneeId: string;
  dueDate: string;
  state: 'draft' | 'pushed' | 'failed';
  error?: string;
}

export interface BriefDraft extends BriefDraftSummary {
  brief: string | null;
  tickets: BriefTicket[];
}

export interface BriefDraftInput {
  title: string;
  brief: string;
  project_id: string | null;
  tickets: BriefTicket[];
}

export interface BriefContext {
  employees: Employee[];
  titles: ExistingTitle[];
}

export interface Employee {
  /** What Taskmandu assigns tasks by. */
  employeeId: string;
  /** Mongo _id — some tasks store assignees under this instead of employeeId. */
  id?: string | null;
  name: string;
  designation: string | null;
  /** Open (not done) tasks, from the synced board. */
  open?: number;
  /** Open estimated hours, and the part due by the end of this week. */
  hours?: number;
  week_hours?: number;
  capacity?: number;
}

export interface ScopeItem {
  request: string;
  verdict: 'in_scope' | 'out_of_scope' | 'unclear';
  reason: string;
  estimate_hours: number | null;
}

export interface GitFile {
  status: string;
  file: string;
}

export interface GitStatus {
  branch: string;
  has_upstream: boolean;
  ahead: number;
  behind: number;
  dirty: GitFile[];
  last_commit: { hash: string | null; author: string | null; when: string | null; subject: string | null };
  branches: string[];
}

export type ProjectStatus = 'Planning' | 'Active' | 'Blocked' | 'On Hold' | 'Completed';
export type TaskStatus = 'Assigned' | 'Pending' | 'In Progress' | 'Blocked' | 'Completed' | 'Cancelled';
export type TaskPriority = 'Low' | 'Medium' | 'High' | 'Critical';
export type VariableType = 'Environment' | 'Server Creds' | 'Database' | 'Other';
export type MemberRole = 'owner' | 'admin' | 'member' | 'viewer';

export const PROJECT_STATUSES: ProjectStatus[] = ['Planning', 'Active', 'Blocked', 'On Hold', 'Completed'];
export const TASK_STATUSES: TaskStatus[] = ['Assigned', 'Pending', 'In Progress', 'Blocked', 'Completed', 'Cancelled'];
export const TASK_PRIORITIES: TaskPriority[] = ['Low', 'Medium', 'High', 'Critical'];
export const VARIABLE_TYPES: VariableType[] = ['Environment', 'Server Creds', 'Database', 'Other'];
export const MEMBER_ROLES: MemberRole[] = ['owner', 'admin', 'member', 'viewer'];

export interface ProjectComment {
  _id: string;
  text: string;
  authorId?: string;
  authorName?: string;
  authorRole?: string;
  createdAt: string;
}

export interface SubTask {
  _id: string;
  title: string;
  assignedToId: string[];
  assignedByName: string;
  status: TaskStatus;
  completedAt: string | null;
  comments: ProjectComment[];
  createdAt: string;
}

export interface ProjectTask {
  _id: string;
  title: string;
  description: string;
  assignedToId: string[];
  assignedByName: string;
  priority: TaskPriority;
  dueDate: string;
  estimatedHours: number;
  status: TaskStatus;
  tags: string[];
  comments: ProjectComment[];
  subTasks: SubTask[];
  createdAt: string;
}

export interface ProjectDocument {
  _id: string;
  name: string;
  size: string;
  uploadedBy: string;
  uploadedAt: string | null;
  description?: string;
  filePath?: string;
  mimeType?: string;
  /** Computed by the Laravel backend; null for legacy references with no uploaded file. */
  url: string | null;
}

export interface SharedVariable {
  _id: string;
  key: string;
  value: string;
  isSecret: boolean;
  type: VariableType;
  description: string;
  updatedBy: string;
  updatedAt: string | null;
}

export interface ProjectMember {
  _id: string;
  userId: string;
  role: MemberRole;
  name?: string;
  email?: string;
  joinedAt: string;
}

export interface Project {
  _id: string;
  name: string;
  description: string;
  status: ProjectStatus;
  manager: string;
  startDate: string | null;
  endDate: string | null;
  color: string;
  createdBy: string;
  documents: ProjectDocument[];
  sharedVariables: SharedVariable[];
  tasks: ProjectTask[];
  members: ProjectMember[];
  createdAt: string;
  updatedAt: string;
}

export interface ProjectInput {
  name: string;
  description?: string;
  status?: ProjectStatus;
  manager?: string;
  startDate?: string | null;
  endDate?: string | null;
  color?: string;
}

export interface NewTaskInput {
  title: string;
  description?: string;
  assignedToId?: string[];
  assignedByName?: string;
  priority?: TaskPriority;
  dueDate: string;
  estimatedHours?: number;
  status?: TaskStatus;
  tags?: string[];
}

export interface NewSubTaskInput {
  title: string;
  assignedToId?: string[];
  assignedByName?: string;
  status?: TaskStatus;
}

export interface VariableInput {
  key: string;
  value?: string;
  isSecret?: boolean;
  type?: VariableType;
  description?: string;
}

export interface PullRequest {
  number: number;
  title: string;
  author: string | null;
  branch: string;
  base: string;
  draft: boolean;
  mergeable_state: string | null;
  checks_state: 'success' | 'failure' | 'pending' | 'unknown';
  review_comments: number;
  updated_at: string;
  url: string;
}

export interface ActionItem {
  task: string;
  owner: string;
  due_date: string | null;
}

export type MinutesStatus = 'draft' | 'final';

export interface MinutesTopic {
  title: string;
  notes: string;
  decision: string;
}

export interface MeetingMinutesSummary {
  id: number;
  title: string;
  status: MinutesStatus;
  meeting_date: string;
  attendees: string[];
  action_items: ActionItem[];
}

export interface MeetingMinutesFull extends Omit<MeetingMinutesSummary, 'action_items'> {
  agenda_items: string[];
  /** Structured topics the wizard writes; null on entries made before the wizard existed. */
  topics: MinutesTopic[] | null;
  discussion: string | null;
  decisions: string[];
  action_items: ActionItem[];
  raw_notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface MinutesDraft {
  title: string;
  attendees: string[];
  agenda_items: string[];
  discussion: string;
  decisions: string[];
  action_items: ActionItem[];
}

export interface MinutesInput {
  title: string;
  status?: MinutesStatus;
  topics?: MinutesTopic[];
  meeting_date: string;
  attendees?: string[];
  agenda_items?: string[];
  discussion?: string;
  decisions?: string[];
  action_items?: ActionItem[];
  raw_notes?: string;
}

export interface ReportItem {
  title: string;
  project: string | null;
  assignee: string | null;
  from?: string | null;
  to?: string | null;
  due?: string | null;
  days?: number | null;
  comments?: number;
  kind?: 'blocked' | 'overdue';
}

export interface ReportPill {
  text: string;
  tone: 'green' | 'red' | 'amber' | 'slate';
}

interface ReportCommon {
  date: string;
  label: string;
  prepared_by: string;
  summary_text: string;
  pills?: ReportPill[];
  blocker_notes: string[];
  my_actions: string[];
  plan: string[];
  notes: string[];
  /** true = split by AI, false = split by simple rules, null = no custom text */
  notes_ai: boolean | null;
  notes_warning: string | null;
}

export interface DailyContent extends ReportCommon {
  kind: 'daily';
  board_text: string;
  completed: ReportItem[];
  new_tasks: ReportItem[];
  moved: ReportItem[];
  comments: ReportItem[];
  newly_blocked: ReportItem[];
  unblocked: ReportItem[];
  newly_overdue: ReportItem[];
  attention: ReportItem[];
  team: { name: string; done: string[]; moved: string[]; blocked: string[]; discussed: string[] }[];
}

export interface WeeklyContent extends ReportCommon {
  kind: 'weekly';
  completed_by_project: { project: string; items: ReportItem[] }[];
  in_progress: ReportItem[];
  blocked: ReportItem[];
  overdue: ReportItem[];
  team: { name: string; completed: number; open: number; in_progress: number; blocked: number; overdue: number }[];
}

/** Reports saved before daily/weekly existed: only the plain-text body is usable. */
export interface LegacyContent {
  kind?: undefined;
  label: string;
  summary_text: string;
  pills?: ReportPill[];
}

export type ReportContent = DailyContent | WeeklyContent | LegacyContent;

export interface Report {
  id: number;
  kind: 'daily' | 'weekly';
  report_date: string;
  auto: boolean;
  generated_by: string | null;
  generated_at: string | null;
  notes: string | null;
  body: string;
  content: ReportContent;
}

export interface Contact {
  name: string;
  designation?: string | null;
  /** '' until you type one. */
  email: string;
}

export interface SendEmailInput {
  to: string[];
  subject: string;
  body: string;
  /** When set, the send is also logged as a nudge on that task. */
  card_id?: number;
}
