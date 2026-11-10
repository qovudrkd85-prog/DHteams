import { createClient } from "@/lib/supabase/client";
import type { Schedule, StickyColor } from "@/lib/types";

/**
 * A project schedule as the team calendar shows it: a deadline that links back to its project.
 * Read-only here. Editing stays inside the project page, so there is one place to change a due date.
 */
export interface ProjectDeadline {
  id: string;
  project_id: string;
  project_name: string;
  project_code: string | null;
  title: string;
  due_date: string;
  assignee: string | null;
  done: boolean;
  color: StickyColor;
}

export const DEADLINE_STYLE = {
  label: "과업 마감",
  className: "bg-amber-50 text-amber-900 border-amber-300",
  dot: "bg-amber-500",
} as const;

type ScheduleRow = Schedule & {
  projects: { name: string; code: string | null; deleted_at: string | null } | null;
};

function toDeadline(row: ScheduleRow): ProjectDeadline {
  return {
    id: row.id,
    project_id: row.project_id,
    project_name: row.projects?.name ?? "이름 없는 과업",
    project_code: row.projects?.code ?? null,
    title: row.title,
    due_date: row.due_date,
    assignee: row.assignee,
    done: row.done,
    color: row.color,
  };
}

/**
 * Deadlines of every live project between two dates (inclusive), earliest first.
 * Trashed projects are excluded on the server (inner join + filter) so they never eat the row cap;
 * the client check below is only a guard for an embed the server did not filter.
 */
export async function listProjectDeadlines(
  first: string,
  last: string,
  options: { openOnly?: boolean; projectId?: string; limit?: number } = {},
): Promise<ProjectDeadline[]> {
  let query = createClient()
    .from("schedules")
    .select("*, projects!inner(name, code, deleted_at)")
    .gte("due_date", first)
    .lte("due_date", last)
    .is("deleted_at", null)
    .is("projects.deleted_at", null);
  // Done rows would only eat the row cap when the caller wants what is still to do.
  if (options.openOnly) query = query.eq("done", false);
  if (options.projectId) query = query.eq("project_id", options.projectId);
  const ordered = query
    .order("due_date", { ascending: true })
    .order("created_at", { ascending: true });
  const { data, error } = await (options.limit ? ordered.limit(options.limit) : ordered);
  if (error) throw new Error(error.message);
  return ((data ?? []) as ScheduleRow[])
    .filter((row) => row.projects !== null && !row.projects.deleted_at)
    .map(toDeadline);
}

/**
 * The calendar's creator filter applied to deadlines. Schedules carry a free-text assignee, so
 * "mine" and a chosen member match by name, and "unassigned" means no assignee.
 */
export function deadlineMatchesCreator(
  deadline: ProjectDeadline,
  creatorFilter: string,
  myName: string | undefined,
  selectedName: string | undefined,
): boolean {
  if (creatorFilter === "all") return true;
  if (creatorFilter === "mine") return myName !== undefined && deadline.assignee === myName;
  if (creatorFilter === "unassigned") return !deadline.assignee;
  return selectedName !== undefined && deadline.assignee === selectedName;
}

/** Per-project colours, so deadlines of different projects can be told apart at a glance. */
export const PROJECT_TONES = [
  { chip: "bg-amber-50 text-amber-900 border-amber-400", dot: "bg-amber-500" },
  { chip: "bg-sky-50 text-sky-900 border-sky-400", dot: "bg-sky-500" },
  { chip: "bg-violet-50 text-violet-900 border-violet-400", dot: "bg-violet-500" },
  { chip: "bg-emerald-50 text-emerald-900 border-emerald-400", dot: "bg-emerald-500" },
  { chip: "bg-rose-50 text-rose-900 border-rose-400", dot: "bg-rose-500" },
  { chip: "bg-orange-50 text-orange-900 border-orange-400", dot: "bg-orange-500" },
  { chip: "bg-cyan-50 text-cyan-900 border-cyan-400", dot: "bg-cyan-500" },
  { chip: "bg-lime-50 text-lime-900 border-lime-500", dot: "bg-lime-600" },
] as const;

/** Stable colour for a project id (same project, same colour, in every month and on every page). */
export function projectTone(projectId: string): (typeof PROJECT_TONES)[number] {
  let hash = 0;
  for (let i = 0; i < projectId.length; i += 1) hash = (hash * 31 + projectId.charCodeAt(i)) >>> 0;
  return PROJECT_TONES[hash % PROJECT_TONES.length];
}

/** Whole days from `today` to `due` (both YYYY-MM-DD); negative when overdue. */
export function daysUntil(due: string, today: string): number {
  const toUtc = (key: string) => {
    const [y, m, d] = key.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(due) - toUtc(today)) / 86_400_000);
}

export function dDayLabel(days: number): string {
  return days === 0 ? "D-day" : days > 0 ? `D-${days}` : `D+${-days}`;
}

/** The nearest open deadline of each project on or after `today` (input must be sorted by due date). */
export function nextDeadlineByProject(
  deadlines: readonly ProjectDeadline[],
  today: string,
): Map<string, { deadline: ProjectDeadline; days: number }> {
  const next = new Map<string, { deadline: ProjectDeadline; days: number }>();
  for (const deadline of deadlines) {
    if (deadline.done || deadline.due_date < today || next.has(deadline.project_id)) continue;
    next.set(deadline.project_id, { deadline, days: daysUntil(deadline.due_date, today) });
  }
  return next;
}
