import axios from 'axios';
import type {
  DraftTicket,
  BriefContext,
  PushTicket,
  PushResult,
  Report,
  ReportContent,
  ScopeItem,
  GitStatus,
  PullRequest,
  Employee,
  Contact,
  SendEmailInput,
  DigestPreview,
  TodayData,
  Project,
  ProjectInput,
  ProjectStatus,
  NewTaskInput,
  NewSubTaskInput,
  VariableInput,
  ProjectMember,
  MemberRole,
  MeetingMinutesSummary,
  CarryOver,
  TaskmanduActivityDraft,
  MeetingMinutesFull,
  MinutesDraft,
  MinutesInput,
  PmIntake,
  PmIntakeInput,
  PmIntakeKind,\n  PmBusiness,
  AssistantReply,
  AssistantStatus,
  AssistantActionResult,
  WorkloadResponse,
  DictionaryData,
  DictionaryTerm,
  DictionaryChange,
  DictionaryPreview,
  ClassifyResult,
  CategoryReview,
  TaskCategory,
} from '../types/pm';
import { normalizeProject } from './normalizeProject';

// Assumes Laravel's default bootstrap.js already configured axios with
// withCredentials + X-CSRF-TOKEN (standard Breeze/Jetstream setup).
const api = axios.create({ baseURL: '/pm/api' });

// Normalise every project payload once, here, so components never see a
// missing array (see normalizeProject.ts).
api.interceptors.response.use((res) => {
  const d = res.data;
  if (d && typeof d === 'object') {
    if (d.project) d.project = normalizeProject(d.project);
    if (Array.isArray(d.projects)) d.projects = d.projects.map(normalizeProject);
  }
  return res;
});

type P = { project: Project };

export const pmApi = {
  assistantChat: (messages: { role: 'user' | 'assistant'; content: string }[]) =>
    api.post<AssistantReply>('/assistant/chat', { messages }, { timeout: 150_000 }),
  assistantStatus: () => api.get<AssistantStatus>('/assistant/status'),
  assistantConfirm: (id: string) => api.post<AssistantActionResult>(`/assistant/actions/${id}/confirm`),
  assistantCancel: (id: string) => api.post<AssistantActionResult>(`/assistant/actions/${id}/cancel`),
  ask: (question: string) => api.post<{ answer: string }>('/ask', { question }),
  nudge: (cardId: number) => api.post<{ message: string }>(`/cards/${cardId}/nudge`),

  /** Record that a (template) nudge was actually sent, so Today can show "nudged 2d ago". */
  nudged: (cardId: number) => api.post<{ at: string }>(`/cards/${cardId}/nudged`),

  /** Current Today data without a page reload. */
  today: () => api.get<TodayData>('/today'),

  /** Team workload narrowed to a business (Taskmandu project) and/or a task category. */
  workload: (filters: { project_id?: string; category?: string } = {}) => api.get<WorkloadResponse>('/workload', { params: filters }),

  /** Private keyword dictionary that sorts tasks into categories. */
  dictionary: () => api.get<DictionaryData>('/dictionary'),
  addDictionaryTerm: (label: string, term: string) => api.post<{ term: DictionaryTerm }>('/dictionary/terms', { label, term }),
  updateDictionaryTerm: (id: number, patch: { term?: string; enabled?: boolean }) => api.patch<{ term: DictionaryTerm }>(`/dictionary/terms/${id}`, patch),
  deleteDictionaryTerm: (id: number) => api.delete<{ ok: boolean }>(`/dictionary/terms/${id}`),
  previewDictionary: (changes: DictionaryChange[]) => api.post<DictionaryPreview>('/dictionary/preview', { changes }),
  testClassification: (title: string, description?: string) => api.post<ClassifyResult>('/dictionary/test', { title, description }),
  categoryReview: () => api.get<CategoryReview>('/dictionary/review'),
  setTaskCategory: (cardId: number, category: TaskCategory) => api.put<{ card_id: number; category: TaskCategory; override: TaskCategory | null }>(`/dictionary/cards/${cardId}/category`, { category }),
  resetTaskCategory: (cardId: number) => api.delete<{ card_id: number; category: TaskCategory; override: null }>(`/dictionary/cards/${cardId}/category`),

  /** Pull from Taskmandu now (can take a while), then return fresh Today data. */
  sync: () => api.post<TodayData & { synced: number }>('/sync', undefined, { timeout: 180_000 }),

  /** The morning digest as text, plus which delivery channels are configured. */
  digest: () => api.get<DigestPreview>('/digest'),

  /** Send the morning digest now to the configured Slack / email channels. */
  sendDigest: () => api.post<{ sent: string[]; errors: Record<string, string> }>('/digest/send', undefined, { timeout: 60_000 }),

  snooze: (cardId: number) => api.post(`/cards/${cardId}/snooze`),

  verify: (cardId: number) => api.post(`/cards/${cardId}/verify`),

  /** Assign a sub-task from Today (updates Taskmandu, then the local copy). */
  assignSubtask: (id: number, employeeId: string) => api.post<{ id: number; assignee: string }>(`/subtasks/${id}/assign`, { employee_id: employeeId }),

  snoozeSubtask: (id: number) => api.post<{ id: number }>(`/subtasks/${id}/snooze`),

  draftBrief: (brief: string) =>
    api.post<{ tickets: DraftTicket[]; questions: string[]; truncated?: number }>('/brief', { brief }),

  employees: () => api.get<{ employees: Employee[] }>('/employees'),

  briefContext: () => api.get<BriefContext>('/brief/context'),

  recentPushes: () =>
    api.get<{ pushes: Array<{ id: number; title: string; task_id: string; project_id: string | null; project_name: string | null; occurred_at: string }> }>('/brief/pushes'),

  undoPush: (activityId: number) => api.post(`/brief/pushes/${activityId}/undo`),

  projectHealth: () => api.get<{ health: any[] }>('/automation/health'),

  // Requests and ideas are local records; Taskmandu projects are their business identity.

  intakes: (kind?: PmIntakeKind) =>
    api.get<{ intakes: PmIntake[] }>('/intakes', { params: kind ? { kind } : undefined }),

  createIntake: (data: PmIntakeInput) =>
    api.post<{ intake: PmIntake }>('/intakes', data),

  updateIntake: (id: number, data: Partial<PmIntakeInput> & { status?: PmIntake['status']; clarification?: string | null; decision_notes?: string | null }) =>
    api.patch<{ intake: PmIntake }>(`/intakes/${id}`, data),

  deleteIntake: (id: number) => api.delete<{ deleted: true }>(`/intakes/${id}`),

  /** Push Tasks into Taskmandu and optionally link them back to their source request. */
  pushTickets: (tickets: PushTicket[], projectId?: string, intakeId?: number) =>
    api.post<{ results: PushResult[]; created: number; newly_created: number; updated: number; failed: number; intake_status?: PmIntake['status'] | null; intake_task_links?: PmIntake['task_links'] | null }>('/brief/push', {
      tickets,
      project_id: projectId || null,
      intake_id: intakeId || null,
    }),

  reportOverview: () => api.get<any>('/reports/overview'),

  reportPeriod: (from: string, to: string) => api.get<any>('/reports/period', { params: { from, to } }),

  reports: () => api.get<{ reports: Report[] }>('/reports'),

  /** date = YYYY-MM-DD (defaults to today server-side); notes = custom text to split into the template. */
  generateReportPack: (payload: { period_type: 'daily' | 'weekly' | 'date_range'; date?: string; from?: string; to?: string; sync?: boolean }) =>
    api.post<{ reports: Report[]; warning: string | null }>('/reports/pack', payload),

  generateReport: (date: string, notes: string, sync: boolean, kind: 'daily' | 'weekly' = 'daily') =>
    api.post<{ report: Report; warning: string | null }>('/reports', { date, notes: notes || null, sync, kind }),

  deleteReport: (id: number) => api.delete(`/reports/${id}`),

  updateReport: (id: number, content: ReportContent, notes?: string | null, body?: string) => api.patch<{ report: Report }>(`/reports/${id}`, { content, notes, body }),

  scopeCheck: (brief: string, message: string) =>
    api.post<{ items: ScopeItem[] }>('/scope', { brief, message }),

  scopeEmail: (items: ScopeItem[], clientName?: string, rate?: string) =>
    api.post<{ email: string }>('/scope/email', { items, client_name: clientName, rate }),

  gitStatus: () => api.get<{ git: GitStatus; pull_requests: PullRequest[] }>('/git/status'),

  gitFetch: () => api.post<{ git: GitStatus }>('/git/fetch'),

  gitPull: () => api.post<{ git: GitStatus }>('/git/pull'),

  gitPush: () => api.post<{ git: GitStatus }>('/git/push'),

  gitCheckout: (branch: string) => api.post<{ git: GitStatus }>('/git/checkout', { branch }),

  // ---- Projects (live passthrough to Taskmandu) -------------------------
  // Every mutating call returns the whole updated project: {project}.

  projects: (params?: { search?: string; status?: ProjectStatus }) =>
    api.get<{ projects: Project[] }>('/projects', { params }),

  project: (id: string) => api.get<P>(`/projects/${id}`),

  createProject: (data: ProjectInput) => api.post<P>('/projects', data),

  updateProject: (id: string, data: Partial<ProjectInput>) => api.patch<P>(`/projects/${id}`, data),

  deleteProject: (id: string) => api.delete<{ deleted: true }>(`/projects/${id}`),

  // Documents (multipart upload, max 5 MB)
  addDocument: (projectId: string, data: { file: File; name?: string; description?: string }) => {
    const form = new FormData();
    form.append('file', data.file);
    if (data.name) form.append('name', data.name);
    if (data.description) form.append('description', data.description);
    return api.post<P>(`/projects/${projectId}/documents`, form);
  },

  updateDocument: (projectId: string, docId: string, data: { name?: string; description?: string }) =>
    api.patch<P>(`/projects/${projectId}/documents/${docId}`, data),

  deleteDocument: (projectId: string, docId: string) =>
    api.delete<P>(`/projects/${projectId}/documents/${docId}`),

  // Shared variables ("secrets")
  addVariable: (projectId: string, data: VariableInput) =>
    api.post<P>(`/projects/${projectId}/variables`, data),

  updateVariable: (projectId: string, varId: string, data: Partial<VariableInput>) =>
    api.patch<P>(`/projects/${projectId}/variables/${varId}`, data),

  deleteVariable: (projectId: string, varId: string) =>
    api.delete<P>(`/projects/${projectId}/variables/${varId}`),

  // Tasks + comments
  addProjectTask: (projectId: string, data: NewTaskInput) =>
    api.post<P>(`/projects/${projectId}/tasks`, data),

  updateProjectTask: (projectId: string, taskId: string, data: Partial<NewTaskInput>) =>
    api.patch<P>(`/projects/${projectId}/tasks/${taskId}`, data),

  deleteProjectTask: (projectId: string, taskId: string) =>
    api.delete<P>(`/projects/${projectId}/tasks/${taskId}`),

  addTaskComment: (projectId: string, taskId: string, text: string) =>
    api.post<P>(`/projects/${projectId}/tasks/${taskId}/comments`, { text }),

  // Sub-tasks + comments
  addSubTask: (projectId: string, taskId: string, data: NewSubTaskInput) =>
    api.post<P>(`/projects/${projectId}/tasks/${taskId}/subtasks`, data),

  updateSubTask: (projectId: string, taskId: string, subTaskId: string, data: Partial<NewSubTaskInput>) =>
    api.patch<P>(`/projects/${projectId}/tasks/${taskId}/subtasks/${subTaskId}`, data),

  deleteSubTask: (projectId: string, taskId: string, subTaskId: string) =>
    api.delete<P>(`/projects/${projectId}/tasks/${taskId}/subtasks/${subTaskId}`),

  addSubTaskComment: (projectId: string, taskId: string, subTaskId: string, text: string) =>
    api.post<P>(`/projects/${projectId}/tasks/${taskId}/subtasks/${subTaskId}/comments`, { text }),

  // Members
  projectMembers: (projectId: string) =>
    api.get<{ members: ProjectMember[] }>(`/projects/${projectId}/members`),

  addProjectMember: (projectId: string, data: { userId: string; role?: MemberRole; name?: string }) =>
    api.post<P>(`/projects/${projectId}/members`, data),

  removeProjectMember: (projectId: string, memberId: string) =>
    api.delete<P>(`/projects/${projectId}/members/${memberId}`),

  // ---- Email (Brevo SMTP) ----------------------------------------------
  contacts: () => api.get<{ contacts: Contact[] }>('/contacts'),

  saveContacts: (contacts: { name: string; email: string }[]) => api.put<{ saved: number }>('/contacts', { contacts }),

  sendEmail: (data: SendEmailInput) => api.post<{ sent: number; at: string }>('/email', data),

  // ---- Meeting minutes (plain local CRUD, no Taskmandu) -----------------

  minutesList: () => api.get<{ minutes: MeetingMinutesSummary[] }>('/minutes'),

  minutesShow: (id: number) => api.get<{ minute: MeetingMinutesFull }>(`/minutes/${id}`),

  /** Reshapes pasted rough notes into the standard fields — nothing is saved. */
  minutesDraft: (notes: string) => api.post<{ draft: MinutesDraft }>('/minutes/draft', { notes }),

  minutesCreate: (data: MinutesInput) => api.post<{ minute: MeetingMinutesFull }>('/minutes', data),

  minutesUpdate: (id: number, data: Partial<MinutesInput>) =>
    api.patch<{ minute: MeetingMinutesFull }>(`/minutes/${id}`, data),

  minutesPush: (id: number) =>
    api.post<{ minute: MeetingMinutesFull }>(`/minutes/${id}/push`),

  minutesDelete: (id: number) => api.delete<{ deleted: true }>(`/minutes/${id}`),
  minutesActivityDraft: (from: string, to: string) => api.post<TaskmanduActivityDraft>('/minutes/activity-draft', { from, to }),

  /** Unfinished Work Items from the last meeting plus overdue / blocked / stuck board tasks. */
  minutesCarryOver: () => api.get<CarryOver>('/minutes/carry-over'),
};
