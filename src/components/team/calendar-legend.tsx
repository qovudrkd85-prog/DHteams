"use client";

import { cn } from "@/lib/utils";
import { toneFor, type ProjectDeadline, type ProjectTone } from "@/lib/project-deadlines";
import type { Project } from "@/lib/types";

interface CalendarLegendProps {
  /** The current team's projects; every one gets a chip, even with nothing due this month. */
  projects: readonly Pick<Project, "id" | "name">[];
  /** This month's deadlines of those projects (already limited to the team). */
  monthDeadlines: readonly ProjectDeadline[];
  toneMap: ReadonlyMap<string, ProjectTone>;
  /** The chosen project, or null when no project chip is on. */
  value: string | null;
  onSelect: (projectId: string | null) => void;
}

/** What the marks mean, plus one chip per team project (colour, name, deadlines this month). */
export function CalendarLegend({ projects, monthDeadlines, toneMap, value, onSelect }: CalendarLegendProps) {
  const counts = new Map<string, number>();
  for (const deadline of monthDeadlines) counts.set(deadline.project_id, (counts.get(deadline.project_id) ?? 0) + 1);
  return (
    <div className="flex w-full basis-full flex-col gap-2" data-testid="calendar-legend">
      <p className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500" aria-label="표시 구분">
        <span className="flex items-center gap-1">
          <span className="size-2 rounded-full bg-slate-500" aria-hidden="true" /> 팀 일정
        </span>
        <span className="flex items-center gap-1">
          <span className="size-2 rotate-45 bg-amber-500" aria-hidden="true" /> 과업 마감
        </span>
        <span className="flex items-center gap-1">
          <span className="size-2 rounded-full border border-slate-500" aria-hidden="true" /> 내 개인 일정
        </span>
      </p>
      {projects.length > 0 && (
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" role="group" aria-label="과업별 보기">
          {projects.map((project) => {
            const count = counts.get(project.id) ?? 0;
            const on = value === project.id;
            return (
              <button
                key={project.id}
                type="button"
                aria-pressed={on}
                data-project-chip={project.id}
                data-empty={count === 0 ? "true" : undefined}
                title={`${project.name} · 이달 일정 ${count}건`}
                onClick={() => onSelect(on ? null : project.id)}
                className={cn(
                  "flex max-w-56 shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs",
                  on
                    ? cn("border-l-4", toneFor(toneMap, project.id).chip)
                    : count === 0
                      ? "border-slate-200 text-slate-400"
                      : "border-slate-200 text-slate-700 hover:bg-slate-50",
                )}
              >
                <span
                  className={cn("size-2 shrink-0 rounded-full", count === 0 && !on ? "bg-slate-300" : toneFor(toneMap, project.id).dot)}
                  aria-hidden="true"
                />
                <span className="truncate">{project.name}</span>
                <span className="shrink-0 tabular-nums opacity-70">{count}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
