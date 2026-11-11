"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

import { dateKey } from "@/lib/department-events";
import { listProjectDeadlines } from "@/lib/project-deadlines";
import type { Project } from "@/lib/types";

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

/** How far ahead the focus lookup searches for a project's next deadline. */
const FOCUS_SEARCH_DAYS = 3650;

/**
 * Resolve a focus request into { project, date } once: unknown ids are dropped, and the
 * next open deadline is looked up for that project alone,
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
