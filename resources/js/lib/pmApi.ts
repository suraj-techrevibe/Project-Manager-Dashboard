import axios from 'axios';
import type {
  DraftTicket,
  ScopeItem,
  GitStatus,
  PullRequest,
  Employee,
  Project,
  NewTaskInput,
  ProjectStatus,
} from '../types/pm';

// Assumes Laravel's default bootstrap.js already configured axios with
// withCredentials + X-CSRF-TOKEN (standard Breeze/Jetstream setup).
const api = axios.create({ baseURL: '/pm' });

export const pmApi = {
  ask: (question: string) => api.post<{ answer: string }>('/ask', { question }),

  nudge: (cardId: number) => api.post<{ message: string }>(`/cards/${cardId}/nudge`),

  snooze: (cardId: number) => api.post(`/cards/${cardId}/snooze`),

  verify: (cardId: number) => api.post(`/cards/${cardId}/verify`),

  draftBrief: (brief: string) =>
    api.post<{ tickets: DraftTicket[]; questions: string[] }>('/brief', { brief }),

  employees: () => api.get<{ employees: Employee[] }>('/employees'),

  pushTickets: (tickets: DraftTicket[], assigneeEmployeeId: string, dueDate?: string) =>
    api.post<{ created: number }>('/brief/push', {
      tickets,
      assignee_employee_id: assigneeEmployeeId,
      due_date: dueDate,
    }),

  clientUpdate: (tone: 'formal' | 'casual', clientName?: string) =>
    api.post<{ email: string }>('/client-update', { tone, client_name: clientName }),

  scopeCheck: (brief: string, message: string) =>
    api.post<{ items: ScopeItem[] }>('/scope', { brief, message }),

  scopeEmail: (items: ScopeItem[], clientName?: string, rate?: string) =>
    api.post<{ email: string }>('/scope/email', { items, client_name: clientName, rate }),

  gitStatus: () => api.get<{ git: GitStatus; pull_requests: PullRequest[] }>('/git/status'),

  gitFetch: () => api.post<{ git: GitStatus }>('/git/fetch'),

  gitPull: () => api.post<{ git: GitStatus }>('/git/pull'),

  gitPush: () => api.post<{ git: GitStatus }>('/git/push'),

  gitCheckout: (branch: string) => api.post<{ git: GitStatus }>('/git/checkout', { branch }),

  projects: (params?: { search?: string; status?: ProjectStatus }) =>
    api.get<{ projects: Project[] }>('/projects', { params }),

  project: (id: string) => api.get<{ project: Project }>(`/projects/${id}`),

  createProject: (data: {
    name: string;
    description?: string;
    status?: ProjectStatus;
    manager?: string;
    startDate?: string;
    endDate?: string;
    color?: string;
  }) => api.post<{ project: Project }>('/projects', data),

  updateProject: (id: string, data: Partial<{
    name: string;
    description: string;
    status: ProjectStatus;
    manager: string;
    startDate: string;
    endDate: string;
    color: string;
  }>) => api.patch<{ project: Project }>(`/projects/${id}`, data),

  deleteProject: (id: string) => api.delete<{ deleted: true }>(`/projects/${id}`),

  addProjectTask: (projectId: string, data: NewTaskInput) =>
    api.post<{ project: Project }>(`/projects/${projectId}/tasks`, data),

  updateProjectTask: (projectId: string, taskId: string, data: Partial<NewTaskInput>) =>
    api.patch<{ project: Project }>(`/projects/${projectId}/tasks/${taskId}`, data),

  deleteProjectTask: (projectId: string, taskId: string) =>
    api.delete<{ deleted: true }>(`/projects/${projectId}/tasks/${taskId}`),
};
