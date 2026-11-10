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
export async function listProjectDeadlines(first: string, last: string): Promise<ProjectDeadline[]> {
  const { data, error } = await createClient()
    .from("schedules")
    .select("*, projects!inner(name, code, deleted_at)")
    .gte("due_date", first)
    .lte("due_date", last)
    .is("deleted_at", null)
    .is("projects.deleted_at", null)
    .order("due_date", { ascending: true })
    .order("created_at", { ascending: true });
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
