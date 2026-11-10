"use client";

import { useState, useSyncExternalStore } from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  dDayLabel,
  daysUntil,
  groupDeadlinesByProject,
  toneFor,
  type ProjectDeadline,
  type ProjectTone,
} from "@/lib/project-deadlines";

const WIDE_QUERY = "(min-width: 640px)";

function subscribeWide(onChange: () => void): () => void {
  const media = window.matchMedia(WIDE_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

/** PC width opens the list by default, phones keep it folded (server render: folded). */
function useWide(): boolean {
  return useSyncExternalStore(subscribeWide, () => window.matchMedia(WIDE_QUERY).matches, () => false);
}

interface MonthDeadlineListProps {
  /** The visible deadlines of the shown month (already limited to this team and the active filters). */
  deadlines: readonly ProjectDeadline[];
  toneMap: ReadonlyMap<string, ProjectTone>;
  today: string;
  onSelectDay: (day: string) => void;
}

/** This month's project schedules, one group per project, so the team sees every project's dates at once. */
export function MonthDeadlineList({ deadlines, toneMap, today, onSelectDay }: MonthDeadlineListProps) {
  const wide = useWide();
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const open = userOpen ?? wide;
  const groups = groupDeadlinesByProject(deadlines);
  return (
    <section className="border-t border-slate-200 px-5 py-4 sm:px-6" data-testid="month-deadline-list" aria-label="이달 과업 일정">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setUserOpen(!open)}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="text-sm font-semibold text-slate-900">
          이달 과업 일정
          <span className="ml-1.5 font-normal text-slate-500">
            {groups.length}개 과업 · {deadlines.length}건
          </span>
        </span>
        <ChevronDown className={cn("size-4 shrink-0 text-slate-400 transition-transform", open && "rotate-180")} aria-hidden="true" />
      </button>
      {open && (
        groups.length === 0 ? (
          <p className="mt-3 text-xs text-slate-500">이달에 보이는 과업 일정이 없어요.</p>
        ) : (
          <ul className="mt-3 grid gap-3 lg:grid-cols-2">
            {groups.map((group) => {
              const tone = toneFor(toneMap, group.project_id);
              return (
                <li key={group.project_id} data-group={group.project_id} className="min-w-0 rounded-xl border border-slate-100 p-3">
                  <p className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-slate-700">
                    <span className={cn("size-2 shrink-0 rotate-45", tone.dot)} aria-hidden="true" />
                    <span className="truncate">{group.project_name}</span>
                    <span className="shrink-0 font-normal text-slate-400">{group.deadlines.length}건</span>
                  </p>
                  <ul className="mt-2 grid gap-1">
                    {group.deadlines.map((deadline) => {
                      const days = daysUntil(deadline.due_date, today);
                      const overdue = !deadline.done && days < 0;
                      return (
                        <li key={deadline.id}>
                          <button
                            type="button"
                            data-deadline-row={deadline.id}
                            data-done={deadline.done ? "true" : undefined}
                            data-overdue={overdue ? "true" : undefined}
                            onClick={() => onSelectDay(deadline.due_date)}
                            className="flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1 text-left text-xs hover:bg-slate-50"
                          >
                            <span className="w-10 shrink-0 tabular-nums text-slate-500">
                              {Number(deadline.due_date.slice(5, 7))}/{Number(deadline.due_date.slice(8))}
                            </span>
                            <span className={cn("min-w-0 flex-1 truncate text-slate-700", deadline.done && "text-slate-400 line-through")}>
                              {deadline.title}
                            </span>
                            {!deadline.done && (
                              <span
                                className={cn(
                                  "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
                                  overdue ? "bg-rose-50 text-rose-700" : "bg-slate-100 text-slate-600",
                                )}
                              >
                                {dDayLabel(days)}
                              </span>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              );
            })}
          </ul>
        )
      )}
    </section>
  );
}
