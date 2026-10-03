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
      status: t.status ?? 'Assigned',
      tags: arr<string>(t.tags),
      comments: arr<any>(t.comments),
      subTasks: arr<any>(t.subTasks).map((s) => ({
        ...s,
        assignedToId: ids(s.assignedToId),
        assignedByName: s.assignedByName ?? '',
        status: s.status ?? 'Assigned',
        completedAt: s.completedAt ?? null,
        comments: arr<any>(s.comments),
      })),
    })),
    members: arr<any>(raw.members).map((m) => ({ ...m, role: m.role ?? 'member', joinedAt: m.joinedAt ?? '' })),
  } as Project;
}
