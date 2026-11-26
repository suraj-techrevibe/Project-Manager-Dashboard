export type InvStatus = 'not_started' | 'in_progress' | 'awaiting_review' | 'reviewed' | 'completed' | 'returned';
export type InvPriority = 'low' | 'medium' | 'high' | 'urgent';
export type InvAction = 'start' | 'submit' | 'review' | 'return' | 'close' | 'reopen';

export interface InvChecklistItem { id?: string; label: string; done?: boolean }
export interface InvEvidence { label?: string; url?: string }
export interface InvFollowup { uid?: string; title: string; description?: string; effort?: string; priority?: InvPriority; convert?: boolean; reference?: string }
export interface InvEvent { id: number; event: string; from: string | null; to: string | null; actor: string | null; detail: string | null; at: string }

export interface Investigation {
  id: number;
  project_id: string;
  project_name: string;
  developer_name: string;
  developer_employee_id: string | null;
  assigned_on: string;
  due_date: string | null;
  overdue: boolean;
  days_left: number | null;
  priority: InvPriority;
  status: InvStatus;
  status_label: string;
  last_investigated_on: string | null;
  submitted_at: string | null;
  reviewed_at: string | null;
  completed_at: string | null;
  actions: InvAction[];
  findings_editable: boolean;
  created_at: string;
}

export interface InvestigationFull extends Investigation {
  scope: string | null;
  instructions: string | null;
  deliverables: string | null;
  checklist: InvChecklistItem[];
  areas_reviewed: string | null;
  findings: string | null;
  issues: string | null;
  recommendations: string | null;
  evidence: InvEvidence[];
  notes: string | null;
  followups: InvFollowup[];
  effort_estimate: string | null;
  review_comments: string | null;
  reviewer_name: string | null;
  events: InvEvent[];
}

export interface InvSummary { active: number; not_started: number; in_progress: number; awaiting_review: number; completed_this_week: number; projects_needing: number | null }
export interface InvListResponse { investigations: Investigation[]; meta: { page: number; last_page: number; total: number; per_page: number }; summary: InvSummary; warnings: string[] }
export interface InvOptions { developers: { name: string; employee_id: string | null; designation: string | null }[]; projects: { id: string; name: string; business: string | null }[]; default_checklist: string[]; warnings: string[] }

export interface InvCoverageRow {
  project_id: string; project_name: string; business: string | null; unavailable: boolean;
  last_investigated_on: string | null; last_investigator: string | null; days_since: number | null; investigated_count: number;
  active: { id: number; developer_name: string; status: InvStatus; status_label: string }[];
  due_for_review: boolean;
  history: { id: number; developer_name: string; date: string; status: InvStatus }[];
}
export interface InvCoverage { rows: InvCoverageRow[]; needing: number | null; interval_days: number; warnings: string[] }
export interface InvByDeveloper { name: string; active: number; awaiting_review: number; projects: string[] }

export interface InvFilters { developer?: string; project_id?: string; status?: string; priority?: string; date_from?: string; date_to?: string; search?: string; page?: number }
export interface InvAssignInput {
  project_id: string; project_name?: string; developer_name: string; developer_employee_id?: string | null;
  assigned_on?: string; due_date?: string | null; priority?: InvPriority; scope?: string; instructions?: string; deliverables?: string; checklist?: InvChecklistItem[];
}
export type InvFindingsInput = Partial<Pick<InvestigationFull, 'areas_reviewed' | 'findings' | 'issues' | 'recommendations' | 'notes' | 'effort_estimate' | 'checklist' | 'evidence' | 'followups'>>;
