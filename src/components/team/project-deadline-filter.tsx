"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

import { cn } from "@/lib/utils";
import { dateKey } from "@/lib/department-events";
import {
  dDayLabel,
  badgeDeadlineByProject,
  listProjectDeadlines,
  projectTone,
  type ProjectDeadline,
  type ProjectTone,
} from "@/lib/project-deadlines";
import type { Project } from "@/lib/types";

/** How far ahead the project list looks for the next deadline. */
const UPCOMING_DAYS = 60;
/** How far back the project list looks for open overdue deadlines (shown as D+n). */
const OVERDUE_DAYS = 30;

/**
 * `/?project=<id>` (from a project's calendar) asks the team calendar to open on that project.
 * Render inside <Suspense>; the parent clears the param once it has taken the id.
 */
export function ProjectFocusListener({ onFocus }: { onFocus: (projectId: string) => void }) {
  const projectId = useSearchParams().get("project");
  useEffect(() => {
    if (projectId) onFocus(projectId);
  }, [projectId, onFocus]);
  return null;
}

function addDays(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return dateKey(new Date(y, m - 1, d + days));
}

/** Nearest open deadline per project for the project list; reloads when `reloadKey` changes, waits while null. */
export function useUpcomingDeadlines(reloadKey: unknown) {
  const [state, setState] = useState<{
    next: Map<string, { deadline: ProjectDeadline; days: number }>;
    error: string | null;
  }>({ next: new Map(), error: null });
  useEffect(() => {
    if (reloadKey === null) return;
    let alive = true;
    const today = dateKey(new Date());
    listProjectDeadlines(addDays(today, -OVERDUE_DAYS), addDays(today, UPCOMING_DAYS), { openOnly: true })
      .then((rows) => {
        if (alive) setState({ next: badgeDeadlineByProject(rows, today), error: null });
      })
      .catch((err: unknown) => {
        if (alive) setState({ next: new Map(), error: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      alive = false;
    };
  }, [reloadKey]);
  return state;
}

/** How far ahead the focus lookup searches for a project's next deadline. */
const FOCUS_SEARCH_DAYS = 3650;

/**
 * Resolve a focus request into { project, date } once: unknown ids are dropped, and the
 * next open deadline is looked up for that project alone (not capped by the list's 60 days),
 * so the calendar receives both values in one render.
 */
export function useFocusTarget(projectId: string | null, projects: Project[], loading: boolean) {
  const [target, setTarget] = useState<{ project: string | null; date: string | null }>({
    project: null,
    date: null,
  });
  const known = !loading && projectId !== null && projects.some((p) => p.id === projectId);
  useEffect(() => {
    if (!known || projectId === null) return;
    let alive = true;
    const today = dateKey(new Date());
    listProjectDeadlines(today, addDays(today, FOCUS_SEARCH_DAYS), { openOnly: true, projectId, limit: 1 })
      .then((rows) => {
        if (alive) setTarget({ project: projectId, date: rows[0]?.due_date ?? null });
      })
      .catch((err: unknown) => {
        // Still filter to the project; only the month jump is lost.
        console.error("focus deadline lookup failed", err);
        if (alive) setTarget({ project: projectId, date: null });
      });
    return () => {
      alive = false;
    };
  }, [known, projectId]);
  return known && target.project === projectId ? target : { project: null, date: null };
}

/** "D-3 · 중간보고서" under a project in the list. */
export function UpcomingBadge({
  item,
  tone: givenTone,
}: {
  item?: { deadline: ProjectDeadline; days: number };
  /** The project's colour from the team's colour map, so the list matches the calendar. */
  tone?: ProjectTone;
}) {
  if (!item) return null;
  const tone = givenTone ?? projectTone(item.deadline.project_id);
  const overdue = item.days < 0;
  return (
    <p
      className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] text-slate-600"
      data-testid="project-upcoming"
      data-overdue={overdue ? "true" : undefined}
      title={`${overdue ? "지난 일정" : "다가오는 일정"} · ${item.deadline.title} · ${item.deadline.due_date}`}
    >
      <span
        className={cn(
          "shrink-0 rounded border-l-2 px-1.5 py-0.5 font-semibold tabular-nums",
          overdue ? "border-rose-500 bg-rose-50 text-rose-700" : tone.chip,
        )}
      >
        {dDayLabel(item.days)}
      </span>
      <span className="truncate">{item.deadline.title}</span>
    </p>
  );
}
