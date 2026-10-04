import axios from 'axios';
import type {
  DraftTicket,
  BriefContext,
  PushTicket,
  PushResult,
  Report,
  ScopeItem,
  GitStatus,
  PullRequest,
  Employee,
  TodayData,
  Project,
  ProjectInput,
  ProjectStatus,
  NewTaskInput,
  NewSubTaskInput,
  VariableInput,
  ProjectMember,
  MemberRole,
} from '../types/pm';
import { normalizeProject } from './normalizeProject';

// Assumes Laravel's default bootstrap.js already configured axios with
// withCredentials + X-CSRF-TOKEN (standard Breeze/Jetstream setup).
const api = axios.create({ baseURL: '/pm' });

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
  ask: (question: string) => api.post<{ answer: string }>('/ask', { question }),

  nudge: (cardId: number) => api.post<{ message: string }>(`/cards/${cardId}/nudge`),

  /** Record that a (template) nudge was actually sent, so Today can show "nudged 2d ago". */
  nudged: (cardId: number) => api.post<{ at: string }>(`/cards/${cardId}/nudged`),

  /** Current Today data without a page reload. */
  today: () => api.get<TodayData>('/today'),

  /** Pull from Taskmandu now (can take a while), then return fresh Today data. */
  sync: () => api.post<TodayData & { synced: number }>('/sync', undefined, { timeout: 180_000 }),

  snooze: (cardId: number) => api.post(`/cards/${cardId}/snooze`),

  verify: (cardId: number) => api.post(`/cards/${cardId}/verify`),

  draftBrief: (brief: string) =>
    api.post<{ tickets: DraftTicket[]; questions: string[]; truncated?: number }>('/brief', { brief }),

  employees: () => api.get<{ employees: Employee[] }>('/employees'),

  briefContext: () => api.get<BriefContext>('/brief/context'),

  /** Per-ticket assignee/due date; pass projectId to push onto that project's board. */
  pushTickets: (tickets: PushTicket[], projectId?: string) =>
    api.post<{ results: PushResult[]; created: number; failed: number }>('/brief/push', {
      tickets,
      project_id: projectId || null,
    }),

  reports: () => api.get<{ reports: Report[] }>('/reports'),

  /** date = YYYY-MM-DD (defaults to today server-side); notes = custom text to split into the template. */
  generateReport: (date: string, notes: string, sync: boolean, kind: 'daily' | 'weekly' = 'daily') =>
    api.post<{ report: Report; warning: string | null }>('/reports', { date, notes: notes || null, sync, kind }),

  deleteReport: (id: number) => api.delete(`/reports/${id}`),

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
};
