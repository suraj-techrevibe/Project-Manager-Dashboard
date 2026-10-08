import type { Project } from '../types/pm';

/**
 * Taskmandu reads projects with Mongoose .lean(), so documents created
 * before a field existed (sub-tasks, comments, tags…) come back without it,
 * and older tasks may carry a single-string assignedToId. Taskmandu's own
 * frontend normalises this in mapProject(); we do the same once, at the API
 * boundary, so every component can rely on arrays being arrays.
 */
const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const ids = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : v ? [String(v)] : []);

const taskStatus = (value: unknown, completedAt?: unknown): string => {
  const raw = String(value ?? '').trim();
  const canonical = ['Assigned', 'Pending', 'In Progress', 'Blocked', 'Completed', 'Cancelled']
    .find((status) => status.toLowerCase() === raw.toLowerCase());
  // A completion timestamp is a safe fallback for older/malformed payloads
  // that omit status, but never overrides an explicit non-completed status.
  return canonical ?? (raw === '' && completedAt ? 'Completed' : raw || 'Assigned');
};

export function normalizeProject(raw: any): Project {
  return {
    ...raw,
    description: raw.description ?? '',
    status: raw.status ?? 'Planning',
    manager: raw.manager ?? '',
    startDate: raw.startDate || null,
    endDate: raw.endDate || null,
    color: raw.color ?? '',
    createdBy: raw.createdBy ?? '',
    documents: arr<any>(raw.documents).map((d) => ({ ...d, size: d.size ?? '', uploadedBy: d.uploadedBy ?? '', uploadedAt: d.uploadedAt ?? null, url: d.url ?? null })),
    sharedVariables: arr<any>(raw.sharedVariables).map((v) => ({
      ...v,
      value: v.value ?? '',
      isSecret: !!v.isSecret,
      type: v.type ?? 'Environment',
      description: v.description ?? '',
      updatedBy: v.updatedBy ?? '',
      updatedAt: v.updatedAt ?? null,
    })),
    tasks: arr<any>(raw.tasks).map((t) => ({
      ...t,
      description: t.description ?? '',
      assignedToId: ids(t.assignedToId),
      assignedByName: t.assignedByName ?? '',
      priority: t.priority ?? 'Medium',
      estimatedHours: t.estimatedHours ?? 0,
      status: taskStatus(t.status),
      tags: arr<string>(t.tags),
      comments: arr<any>(t.comments),
      subTasks: arr<any>(t.subTasks).map((s) => ({
        ...s,
        assignedToId: ids(s.assignedToId),
        assignedByName: s.assignedByName ?? '',
        status: taskStatus(s.status, s.completedAt),
        // Taskmandu may not expose completedAt on older sub-tasks. When a sub-task\n        // is already Completed, updatedAt is the best available completion timestamp.\n        completedAt: s.completedAt ?? (taskStatus(s.status, s.completedAt) === 'Completed' ? (s.updatedAt ?? null) : null),
        comments: arr<any>(s.comments),
      })),
    })),
    members: arr<any>(raw.members).map((m) => ({ ...m, role: m.role ?? 'member', joinedAt: m.joinedAt ?? '' })),
  } as Project;
}
