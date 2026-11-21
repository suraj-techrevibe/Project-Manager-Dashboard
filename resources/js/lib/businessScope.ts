import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Project, TodayData } from '@/types/pm';

const STORAGE_KEY = 'pm:scope-project';
const EVENT = 'pm:business-change';

/** 'all' or a business id as a string. Shared by every component that calls the hook. */
function read(): string {
  try {
    return window.localStorage.getItem(STORAGE_KEY) || 'all';
  } catch {
    return 'all';
  }
}

export interface ScopeOption {
  /** Taskmandu project id. */
  id: string;
  name: string;
}

export interface BusinessScope {
  options: ScopeOption[];
  /** 'all' or the selected Taskmandu project id. */
  selectedId: string;
  selected: ScopeOption | null;
  setSelectedId: (id: string) => void;
  /** Project ids in scope; null means no filtering. */
  projectIds: Set<string> | null;
}

/**
 * Each Taskmandu project is a business here, so the switcher lists projects.
 * Options come from the live project list, plus any project seen on synced tasks.
 */
export function useBusinessScope(options: ScopeOption[]): BusinessScope {
  const [selectedId, setSelected] = useState<string>(() => (typeof window === 'undefined' ? 'all' : read()));

  useEffect(() => {
    const sync = () => setSelected(read());
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, []);

  const setSelectedId = useCallback((id: string) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* Selection still applies for this page view. */
    }
    setSelected(id);
    window.dispatchEvent(new Event(EVENT));
  }, []);

  const selected = useMemo(() => options.find((o) => o.id === selectedId) ?? null, [options, selectedId]);
  // A saved project that is no longer in the list is ignored rather than hiding everything.
  const projectIds = useMemo(() => (selected ? new Set([selected.id]) : null), [selected]);

  return { options, selectedId: selected ? selectedId : 'all', selected, setSelectedId, projectIds };
}

const METRIC_TYPES = ['overdue', 'stuck', 'blocked', 'unverified', 'unassigned', 'due_today', 'due_soon', 'subtasks_incomplete'] as const;

/**
 * Narrows the task-level parts of the Today payload to the selected project (business).
 * Tasks that are not on any project board (standalone) belong to no project, so they drop out
 * while a business is selected. Workload, requests and meeting follow-ups are not task-level and
 * are left as they are.
 */
export function scopeToday(today: TodayData | null, projectIds: Set<string> | null): TodayData | null {
  if (!today || !projectIds) return today;
  const inScope = (id: string | null | undefined) => Boolean(id && projectIds.has(id));
  const flags = today.flags.filter((f) => inScope(f.project_id));
  const metrics = { ...today.metrics } as Record<string, number>;
  for (const type of METRIC_TYPES) metrics[type] = flags.filter((f) => f.type === type).length;
  const withTasks = today as TodayData & { tasks?: { project_id: string | null }[] };
  return {
    ...today,
    flags,
    metrics: metrics as unknown as TodayData['metrics'],
    subtasks: today.subtasks.filter((s) => inScope(s.project_id)),
    ...(withTasks.tasks ? { tasks: withTasks.tasks.filter((t) => inScope(t.project_id)) } : {}),
  } as TodayData;
}

export function scopeProjects(projects: Project[], projectIds: Set<string> | null): Project[] {
  return projectIds ? projects.filter((p) => projectIds.has(p._id)) : projects;
}
