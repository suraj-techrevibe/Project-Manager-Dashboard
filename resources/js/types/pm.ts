export type Severity = 'danger' | 'warning' | 'neutral';

export interface PmFlag {
  card_id: number;
  title: string;
  assignee: string | null;
  type: 'overdue' | 'stuck' | 'blocked' | 'unassigned' | 'unverified';
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
  description: string | null;
}

/** Deep link from the Today tab into a project's Tasks tab. */
export interface TaskFocus {
  projectId: string;
  taskId: string;
}

export interface PmMetrics {
  overdue: number;
  stuck: number;
  blocked: number;
  unverified: number;
}

export interface DraftTicket {
  title: string;
  description: string;
  level: 'senior dev' | 'intern' | string;
  estimate_hours: number;
}

export interface Employee {
  employeeId: string;
  name: string;
  designation: string | null;
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
