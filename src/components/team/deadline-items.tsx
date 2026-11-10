"use client";

import Link from "next/link";
import { ChevronRight, Flag } from "lucide-react";

import { cn } from "@/lib/utils";
import { DEADLINE_STYLE, projectTone, type ProjectDeadline } from "@/lib/project-deadlines";

/** Hover/tooltip text, also what the browser tests select on. */
export function deadlineTitle(deadline: ProjectDeadline): string {
  return `${DEADLINE_STYLE.label} · ${deadline.project_name} · ${deadline.title}`;
}

/** One line inside a month cell. */
export function DeadlineChip({ deadline }: { deadline: ProjectDeadline }) {
  return (
    <Link
      href={`/projects/${deadline.project_id}?view=schedule`}
      title={deadlineTitle(deadline)}
      data-deadline={deadline.done ? "done" : "open"}
      className={cn(
        "block w-full truncate rounded border-l-2 px-1.5 py-1 text-left text-[11px]",
        projectTone(deadline.project_id).chip,
        deadline.done && "opacity-60 line-through",
      )}
    >
      <span className="block truncate">
        <Flag className="mr-0.5 inline size-2.5" aria-hidden="true" />
        {deadline.title}
      </span>
      <span className="block truncate text-[10px] opacity-80">{deadline.project_name}</span>
    </Link>
  );
}

/** One row in the selected-day list. */
export function DeadlineRow({ deadline }: { deadline: ProjectDeadline }) {
  return (
    <Link
      href={`/projects/${deadline.project_id}?view=schedule`}
      title={deadlineTitle(deadline)}
      data-deadline={deadline.done ? "done" : "open"}
      className="flex w-full items-start gap-3 rounded-xl border border-amber-100 bg-amber-50/40 p-3 text-left transition-colors hover:bg-amber-50"
    >
      <span className={cn("mt-0.5 shrink-0 rounded-md border px-2 py-1 text-[11px]", projectTone(deadline.project_id).chip)}>
        {DEADLINE_STYLE.label}
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn("break-words text-sm font-medium text-slate-800", deadline.done && "text-slate-400 line-through")}>
          {deadline.title}
        </p>
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
          <span className="truncate">
            {deadline.project_name}
            {deadline.project_code && ` · ${deadline.project_code}`}
          </span>
          {deadline.assignee && <span>담당 {deadline.assignee}</span>}
          {deadline.done && <span>완료</span>}
        </div>
      </div>
      <ChevronRight className="mt-1 size-4 shrink-0 text-slate-300" />
    </Link>
  );
}
