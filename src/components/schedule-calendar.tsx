"use client";

import Link from "next/link";
import { CalendarDays, ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { MonthMemo } from "@/components/month-memo";
import { ScheduleWeek, useScheduleView } from "@/components/schedule-week";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import * as api from "@/lib/queries";
import {
  capCell,
  isOverdue,
  sameSchedules,
  shouldRefreshSchedules,
  splitMonthItems,
} from "@/lib/schedule-view";
import { STICKY_COLORS, type Schedule, type ScheduleKind, type StickyColor } from "@/lib/types";
import { cn } from "@/lib/utils";
import { isTodo, orderDay } from "@/lib/week-blocks";
import { groupWeek, shiftWeek, weekDays, weekLabel, weekStart } from "@/lib/week-view";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const DAY_CELL_LIMIT = 3;
const MONTH_TODO_LIMIT = 12;
const REFRESH_MS = 30000;
const CONFLICT_MESSAGE =
  "다른 팀원이 이 일정을 먼저 수정했습니다. 최신 내용을 확인한 뒤 다시 저장해 주세요.";

const COLOR_CLASS: Record<StickyColor, string> = {
  yellow: "bg-yellow-100 border-yellow-300 text-yellow-950",
  pink: "bg-pink-100 border-pink-300 text-pink-950",
  blue: "bg-sky-100 border-sky-300 text-sky-950",
  green: "bg-emerald-100 border-emerald-300 text-emerald-950",
};

const COLOR_LABEL: Record<StickyColor, string> = {
  yellow: "노랑",
  pink: "분홍",
  blue: "파랑",
  green: "초록",
};

const toKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;

/** 달력에 그릴 6주(42칸) 날짜 목록 */
function buildMonthCells(base: Date): Date[] {
  const first = new Date(base.getFullYear(), base.getMonth(), 1);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());

  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

type EditState =
  | {
      mode: "create";
      due_date: string;
      title: string;
      assignee: string;
      note: string;
      color: StickyColor;
    }
  | {
      mode: "edit";
      target: Schedule;
      title: string;
      assignee: string;
      note: string;
      color: StickyColor;
    };

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

export function ScheduleCalendar({
  projectId,
  refreshKey = 0,
}: {
  projectId: string;
  refreshKey?: number;
}) {
  const [month, setMonth] = useState(() => new Date());
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const [showAllTodo, setShowAllTodo] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [view, setView] = useScheduleView();
  const [weekStartKey, setWeekStartKey] = useState(() => weekStart(toKey(new Date())));

  // Request number: a late response from an older load is dropped.
  const version = useRef(0);
  // Writes in flight; background refresh waits so it cannot undo an optimistic change.
  const mutating = useRef(0);
  const editing = useRef(false);
  useEffect(() => {
    editing.current = edit !== null;
  }, [edit]);

  const reload = useCallback(
    (background = false) => {
      const mine = ++version.current;
      return api
        .listSchedules(projectId)
        .then((rows) => {
          if (mine !== version.current) return;
          setSchedules((prev) => (sameSchedules(prev, rows) ? prev : rows));
        })
        .catch((error) => {
          if (background || mine !== version.current) return;
          toast.error(
            errorMessage(
              error,
              "일정을 불러오지 못했습니다. 일정 테이블 SQL을 실행했는지 확인하세요.",
            ),
          );
        })
        .finally(() => {
          if (mine === version.current) setLoading(false);
        });
    },
    [projectId],
  );

  useEffect(() => {
    void reload();
  }, [reload, refreshKey]);

  // Teammates' schedules arrive without a page reload: every 30s and on focus.
  useEffect(() => {
    const versionRef = version;
    const onVisible = () => {
      const ok = shouldRefreshSchedules({
        visible: document.visibilityState === "visible",
        editing: editing.current,
        mutating: mutating.current,
      });
      if (ok) void reload(true);
    };
    const timer = window.setInterval(onVisible, REFRESH_MS);
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      versionRef.current++;
      window.clearInterval(timer);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [reload]);

  // D10 block lines need schedules.kind (schema-schedule-blocks.sql). Rows tell us; an empty
  // project asks the DB once. A write rejected for the column turns blocks off for the session.
  const [kindProbe, setKindProbe] = useState<boolean | null>(null);
  const [kindMissing, setKindMissing] = useState(false);
  const blocksReady =
    !kindMissing &&
    (schedules.length > 0 ? schedules.some((s) => s.kind !== undefined) : kindProbe === true);
  useEffect(() => {
    if (loading || schedules.length > 0 || kindProbe !== null) return;
    let alive = true;
    api
      .hasScheduleKind()
      .then((ok) => {
        if (alive) setKindProbe(ok);
      })
      .catch(() => {
        if (alive) setKindProbe(false);
      });
    return () => {
      alive = false;
    };
  }, [loading, schedules.length, kindProbe]);

  const cells = useMemo(() => buildMonthCells(month), [month]);

  // The month grid, count and list show to-dos only; week-board blocks (text, headings) stay on the board.
  const todoItems = useMemo(() => schedules.filter(isTodo), [schedules]);

  const byDate = useMemo(() => {
    const map = new Map<string, Schedule[]>();
    todoItems.forEach((s) => {
      const list = map.get(s.due_date) ?? [];
      map.set(s.due_date, [...list, s]);
    });
    return map;
  }, [todoItems]);

  const todoCount = todoItems.filter((s) => !s.done).length;

  const monthKey = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}`;
  const monthItems = useMemo(
    () => todoItems.filter((s) => s.due_date.startsWith(monthKey)),
    [todoItems, monthKey],
  );

  // After a conflict: reload, then point the open dialog at the latest row (my input stays).
  // Resolves false when a teammate deleted the row.
  async function recoverFromConflict(id: string): Promise<boolean> {
    try {
      const mine = ++version.current;
      const rows = await api.listSchedules(projectId);
      if (mine === version.current) {
        setSchedules((prev) => (sameSchedules(prev, rows) ? prev : rows));
        setLoading(false);
      }
      const latest = rows.find((s) => s.id === id);
      if (!latest) {
        setEdit(null);
        toast.error("삭제된 일정입니다");
        return false;
      }
      setEdit((prev) =>
        prev?.mode === "edit" && prev.target.id === id ? { ...prev, target: latest } : prev,
      );
      toast.error(CONFLICT_MESSAGE);
      return true;
    } catch {
      toast.error(CONFLICT_MESSAGE);
      return true;
    }
  }

  // Week board quick add: title and date only; detail fields stay empty. Block kind and
  // sort_order go in only when the column exists; a rejection for it retries as a plain to-do.
  async function addQuick(
    day: string,
    title: string,
    block?: { kind: ScheduleKind; sort_order: number },
  ): Promise<Schedule | null> {
    mutating.current++;
    try {
      const base = { title, due_date: day, assignee: null, note: null, color: "yellow" as const };
      const withBlock = blocksReady && block ? { ...base, ...block } : null;
      let created: Schedule;
      try {
        created = await api.createSchedule(projectId, withBlock ?? base);
      } catch (error) {
        if (!withBlock || !(error instanceof api.ScheduleColumnMissingError)) throw error;
        setKindMissing(true);
        created = await api.createSchedule(projectId, base);
      }
      setSchedules((prev) => [...prev.filter((s) => s.id !== created.id), created]);
      return created;
    } catch (error) {
      toast.error(errorMessage(error, "추가하지 못했습니다."));
      return null;
    } finally {
      mutating.current--;
    }
  }

  // Week board inline rename with the D6 edit lock. Resolves true when the edit can close.
  // A kind change to a non-to-do also clears done (blocks have no checkbox).
  async function rename(item: Schedule, title: string, kind?: ScheduleKind): Promise<boolean> {
    mutating.current++;
    try {
      const withKind =
        blocksReady && kind ? { title, kind, ...(kind === "todo" ? {} : { done: false }) } : null;
      let updated: Schedule;
      try {
        updated = await api.updateSchedule(item.id, withKind ?? { title }, item.updated_at);
      } catch (error) {
        if (!withKind || !(error instanceof api.ScheduleColumnMissingError)) throw error;
        setKindMissing(true);
        updated = await api.updateSchedule(item.id, { title }, item.updated_at);
      }
      setSchedules((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
      return true;
    } catch (error) {
      if (error instanceof api.ScheduleConflictError) {
        return !(await recoverFromConflict(item.id));
      }
      toast.error(errorMessage(error, "저장하지 못했습니다."));
      return false;
    } finally {
      mutating.current--;
    }
  }

  // Week board delete: soft delete with an undo toast.
  async function removeWithUndo(item: Schedule) {
    mutating.current++;
    try {
      await api.deleteSchedule(item.id);
      setSchedules((prev) => prev.filter((s) => s.id !== item.id));
      toast.success("일정을 삭제했습니다.", {
        duration: 10000,
        action: {
          label: "되돌리기",
          onClick: async () => {
            try {
              await api.restoreSchedule(item.id);
              await reload();
              toast.success("일정을 복원했습니다.");
            } catch (error) {
              toast.error(errorMessage(error, "복원하지 못했습니다."));
            }
          },
        },
      });
    } catch (error) {
      toast.error(errorMessage(error, "삭제하지 못했습니다."));
    } finally {
      mutating.current--;
    }
  }

  const openEdit = (item: Schedule) =>
    setEdit({
      mode: "edit",
      target: item,
      title: item.title,
      assignee: item.assignee ?? "",
      note: item.note ?? "",
      color: item.color,
    });

  async function submitEdit(event: React.FormEvent) {
    event.preventDefault();
    if (!edit || !edit.title.trim()) return;

    mutating.current++;
    try {
      if (edit.mode === "create") {
        const created = await api.createSchedule(projectId, {
          title: edit.title.trim(),
          due_date: edit.due_date,
          assignee: edit.assignee.trim() || null,
          note: edit.note.trim() || null,
          color: edit.color,
        });
        setSchedules((prev) => [...prev, created]);
      } else {
        const updated = await api.updateSchedule(
          edit.target.id,
          {
            title: edit.title.trim(),
            assignee: edit.assignee.trim() || null,
            note: edit.note.trim() || null,
            color: edit.color,
          },
          edit.target.updated_at,
        );
        setSchedules((prev) =>
          prev.map((s) => (s.id === updated.id ? updated : s)),
        );
      }
      setEdit(null);
    } catch (error) {
      if (edit.mode === "edit" && error instanceof api.ScheduleConflictError) {
        await recoverFromConflict(edit.target.id);
      } else {
        toast.error(errorMessage(error, "저장하지 못했습니다."));
      }
    } finally {
      mutating.current--;
    }
  }

  async function toggleDone(schedule: Schedule) {
    const next = !schedule.done;
    mutating.current++;
    setSchedules((prev) =>
      prev.map((s) => (s.id === schedule.id ? { ...s, done: next } : s)),
    );
    try {
      // Unconditional, but keep the returned row so its updated_at stays fresh.
      const saved = await api.updateSchedule(schedule.id, { done: next });
      setSchedules((prev) => prev.map((s) => (s.id === saved.id ? saved : s)));
    } catch (error) {
      setSchedules((prev) =>
        prev.map((s) => (s.id === schedule.id ? { ...s, done: !next } : s)),
      );
      toast.error(errorMessage(error, "저장하지 못했습니다."));
    } finally {
      mutating.current--;
    }
  }

  async function remove(schedule: Schedule) {
    mutating.current++;
    try {
      await api.deleteSchedule(schedule.id);
      setSchedules((prev) => prev.filter((s) => s.id !== schedule.id));
      setEdit(null);
    } catch (error) {
      toast.error(errorMessage(error, "삭제하지 못했습니다."));
    } finally {
      mutating.current--;
    }
  }

  // Fold state belongs to one month; a new month starts folded.
  const resetFolds = () => {
    setExpandedDay(null);
    setShowAllTodo(false);
    setShowDone(false);
  };

  const shiftMonth = (delta: number) => {
    resetFolds();
    setMonth(
      (prev) => new Date(prev.getFullYear(), prev.getMonth() + delta, 1),
    );
  };

  const isWeek = view === "week";
  // ‹ › and the "today" button move by week on the week board.
  const shiftPeriod = (delta: number) => {
    if (!isWeek) return shiftMonth(delta);
    resetFolds();
    setWeekStartKey((prev) => shiftWeek(prev, delta));
  };
  const goToday = () => {
    resetFolds();
    if (isWeek) setWeekStartKey(weekStart(toKey(new Date())));
    else setMonth(new Date());
  };
  const days = useMemo(() => weekDays(weekStartKey), [weekStartKey]);
  // The week board shows every row of a day (blocks too), in sort_order.
  const weekByDate = useMemo(
    () =>
      new Map(
        Array.from(groupWeek(schedules, weekStartKey), ([day, rows]) => [day, orderDay(rows)]),
      ),
    [schedules, weekStartKey],
  );
  // In week mode the month notes follow the month of the week's Monday.
  const memoMonth = isWeek ? weekStartKey.slice(0, 7) : monthKey;

  const openCreate = (dueDate: string) =>
    setEdit({
      mode: "create",
      due_date: dueDate,
      title: "",
      assignee: "",
      note: "",
      color: "yellow",
    });

  const todayKey = toKey(new Date());
  const monthSplit = splitMonthItems(monthItems, todayKey);
  const monthOpen = capCell(
    monthSplit.open,
    showAllTodo ? Infinity : MONTH_TODO_LIMIT,
  );

  const renderTodo = (item: Schedule) => {
    const overdue = isOverdue(item, todayKey);
    return (
      <li
        key={item.id}
        data-overdue={overdue ? "true" : undefined}
        className={cn(
          "flex w-52 items-start gap-2 rounded-md border px-2 py-1.5 text-xs shadow-sm",
          COLOR_CLASS[item.color],
          item.done && "opacity-60",
        )}
      >
        <Checkbox
          className="mt-0.5 size-3.5"
          checked={item.done}
          onCheckedChange={() => toggleDone(item)}
          aria-label="완료"
        />
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          onClick={() =>
            setEdit({
              mode: "edit",
              target: item,
              title: item.title,
              assignee: item.assignee ?? "",
              note: item.note ?? "",
              color: item.color,
            })
          }
        >
          <span
            className={cn(
              "block truncate font-medium",
              item.done && "line-through",
            )}
          >
            {item.title}
          </span>
          <span className="block text-[11px] opacity-70">
            <span className={cn(overdue && "font-medium text-rose-700")}>
              {item.due_date.slice(5).replace("-", "/")}
              {overdue ? " 지남" : ""}
            </span>
            {item.assignee ? ` · ${item.assignee}` : ""}
          </span>
        </button>
      </li>
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">00_업무일정</h2>
        <span className="text-xs text-muted-foreground">
          남은 일 {todoCount}건
        </span>
        <Link
          href={`/?project=${encodeURIComponent(projectId)}`}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-teal-700 hover:bg-teal-50"
          data-testid="schedule-team-calendar-link"
        >
          <CalendarDays className="size-3.5" aria-hidden="true" />
          팀 달력에서 보기
        </Link>
        <div className="flex-1" />
        <div className="flex rounded-lg bg-slate-100 p-0.5" role="group" aria-label="달력 보기">
          {([["month", "월"], ["week", "주"]] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={view === key}
              onClick={() => {
                resetFolds();
                setView(key);
              }}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs text-slate-500",
                view === key && "bg-white text-teal-800 shadow-sm",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <Button
          variant="outline"
          size="icon"
          className="size-8"
          aria-label={isWeek ? "이전 주" : "이전 달"}
          onClick={() => shiftPeriod(-1)}
        >
          <ChevronLeft className="size-4" />
        </Button>
        <span className="min-w-28 text-center text-sm font-medium">
          {isWeek
            ? weekLabel(weekStartKey)
            : `${month.getFullYear()}년 ${month.getMonth() + 1}월`}
        </span>
        <Button
          variant="outline"
          size="icon"
          className="size-8"
          aria-label={isWeek ? "다음 주" : "다음 달"}
          onClick={() => shiftPeriod(1)}
        >
          <ChevronRight className="size-4" />
        </Button>
        <Button variant="outline" size="sm" onClick={goToday}>
          {isWeek ? "이번 주" : "오늘"}
        </Button>
      </div>

      {isWeek ? (
        <ScheduleWeek
          days={days}
          byDate={weekByDate}
          todayKey={todayKey}
          showDone={showDone}
          blocksReady={blocksReady}
          onToggleShowDone={() => setShowDone((prev) => !prev)}
          onAdd={addQuick}
          onToggle={toggleDone}
          onRename={rename}
          onOpenDetail={openEdit}
          onRemove={(item) => void removeWithUndo(item)}
        />
      ) : (
      <div className="grid grid-cols-7 gap-px rounded-lg border bg-border text-center text-xs font-medium">
        {WEEKDAYS.map((w, i) => (
          <div
            key={w}
            className={cn(
              "bg-background py-1.5",
              i === 0 && "text-red-600",
              i === 6 && "text-blue-600",
            )}
          >
            {w}
          </div>
        ))}

        {cells.map((date) => {
          const key = toKey(date);
          const inMonth = date.getMonth() === month.getMonth();
          const items = byDate.get(key) ?? [];
          const expanded = expandedDay === key;
          const cell = capCell(items, expanded ? Infinity : DAY_CELL_LIMIT);

          return (
            <div
              key={key}
              data-day={key}
              className={cn(
                "group min-h-24 cursor-pointer bg-background p-1 text-left align-top transition-colors hover:bg-accent/40",
                !inMonth && "bg-muted/40 text-muted-foreground",
                key === todayKey &&
                  "relative z-10 bg-primary/10 ring-2 ring-inset ring-primary/70 hover:bg-primary/15",
              )}
              onClick={() => openCreate(key)}
              title="빈 공간을 클릭해서 일정 추가"
            >
              <button
                type="button"
                className={cn(
                  "mb-1 flex w-full items-center justify-between rounded px-1 text-[11px] hover:bg-accent",
                  key === todayKey && "font-bold text-primary",
                )}
                onClick={(event) => {
                  event.stopPropagation();
                  openCreate(key);
                }}
                aria-label={`${key} 일정 추가`}
                title="클릭해서 일정 추가"
              >
                <span>{date.getDate()}</span>
                <span className="text-muted-foreground opacity-0 group-hover:opacity-100">
                  +
                </span>
              </button>

              <div className="space-y-1">
                {cell.shown.map((item) => (
                  <div
                    key={item.id}
                    className={cn(
                      "flex items-start gap-1 rounded border px-1 py-0.5 text-left text-[11px] shadow-sm",
                      COLOR_CLASS[item.color],
                      item.done && "opacity-60",
                    )}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <Checkbox
                      className="mt-0.5 size-3"
                      checked={item.done}
                      onCheckedChange={() => toggleDone(item)}
                      aria-label="완료"
                    />
                    <button
                      type="button"
                      className={cn(
                        "min-w-0 flex-1 truncate",
                        item.done && "line-through",
                      )}
                      onClick={() =>
                        setEdit({
                          mode: "edit",
                          target: item,
                          title: item.title,
                          assignee: item.assignee ?? "",
                          note: item.note ?? "",
                          color: item.color,
                        })
                      }
                      title={
                        item.assignee
                          ? `${item.title} · ${item.assignee}`
                          : item.title
                      }
                    >
                      {item.title}
                    </button>
                  </div>
                ))}
                {cell.hidden > 0 || expanded ? (
                  <button
                    type="button"
                    className="w-full rounded px-1 text-left text-[11px] text-muted-foreground hover:bg-accent"
                    onClick={(event) => {
                      // A cell click opens the add dialog; keep it closed.
                      event.stopPropagation();
                      setExpandedDay(expanded ? null : key);
                    }}
                  >
                    {expanded ? "접기" : `+${cell.hidden}건 더 보기`}
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      )}
      <p className="-mt-2 text-right text-[11px] text-slate-400">
        함께 쓰는 일정 · 30초마다 자동 갱신
      </p>

      <MonthMemo projectId={projectId} month={memoMonth} />

      {/* 이번 달 포스트잇 모아보기 (week mode shows the same rows on the board) */}
      {isWeek ? null : (
      <section
        className="rounded-lg border bg-background p-3"
        data-testid="month-todo"
      >
        <h3 className="mb-2 text-sm font-medium">
          이번 달 할 일{" "}
          <span className="text-xs font-normal text-muted-foreground">
            {monthSplit.open.length}건 남음 / 전체{" "}
            {monthItems.length}건
          </span>
        </h3>
        {monthItems.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">
            달력의 날짜를 클릭해 일정을 붙이세요.
          </p>
        ) : (
          <div className="space-y-2">
            {monthOpen.shown.length > 0 ? (
              <ul className="flex flex-wrap gap-2">
                {monthOpen.shown.map(renderTodo)}
              </ul>
            ) : null}
            <div className="flex flex-wrap gap-2 text-xs">
              {monthOpen.hidden > 0 || showAllTodo ? (
                <button
                  type="button"
                  className="rounded px-1.5 py-0.5 text-muted-foreground hover:bg-accent"
                  onClick={() => setShowAllTodo((prev) => !prev)}
                >
                  {showAllTodo ? "접기" : `+${monthOpen.hidden}건 더 보기`}
                </button>
              ) : null}
              {monthSplit.done.length > 0 ? (
                <button
                  type="button"
                  className="rounded px-1.5 py-0.5 text-muted-foreground hover:bg-accent"
                  onClick={() => setShowDone((prev) => !prev)}
                >
                  {showDone
                    ? `완료 ${monthSplit.done.length}건 숨기기`
                    : `완료 ${monthSplit.done.length}건 보기`}
                </button>
              ) : null}
            </div>
            {showDone && monthSplit.done.length > 0 ? (
              <ul className="flex flex-wrap gap-2">
                {monthSplit.done.map(renderTodo)}
              </ul>
            ) : null}
          </div>
        )}
      </section>
      )}

      {loading ? (
        <p className="text-xs text-muted-foreground">불러오는 중...</p>
      ) : null}

      <Dialog
        open={edit !== null}
        onOpenChange={(open) => !open && setEdit(null)}
      >
        <DialogContent>
          <form onSubmit={submitEdit}>
            <DialogHeader>
              <DialogTitle>
                {edit?.mode === "edit"
                  ? `일정 수정 (${edit.target.due_date})`
                  : `일정 추가 (${edit?.due_date ?? ""})`}
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="s-title">할 일</Label>
                <Input
                  id="s-title"
                  autoFocus
                  required
                  placeholder="예) 중간보고서 발주처 제출"
                  value={edit?.title ?? ""}
                  onChange={(e) =>
                    setEdit((prev) =>
                      prev ? { ...prev, title: e.target.value } : prev,
                    )
                  }
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="s-assignee">담당</Label>
                <Input
                  id="s-assignee"
                  placeholder="예) 김주무관"
                  value={edit?.assignee ?? ""}
                  onChange={(e) =>
                    setEdit((prev) =>
                      prev ? { ...prev, assignee: e.target.value } : prev,
                    )
                  }
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="s-note">메모</Label>
                <Textarea
                  id="s-note"
                  value={edit?.note ?? ""}
                  onChange={(e) =>
                    setEdit((prev) =>
                      prev ? { ...prev, note: e.target.value } : prev,
                    )
                  }
                />
              </div>

              <div className="space-y-2">
                <Label>색</Label>
                <div className="flex gap-2">
                  {STICKY_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      className={cn(
                        "rounded border px-2 py-1 text-xs",
                        COLOR_CLASS[color],
                        edit?.color === color && "ring-2 ring-primary",
                      )}
                      onClick={() =>
                        setEdit((prev) => (prev ? { ...prev, color } : prev))
                      }
                    >
                      {COLOR_LABEL[color]}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <DialogFooter className="sm:justify-between">
              {edit?.mode === "edit" ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => remove(edit.target)}
                  className="text-destructive"
                >
                  <Trash2 className="size-4" /> 삭제
                </Button>
              ) : (
                <span />
              )}
              <Button type="submit" disabled={!edit?.title.trim()}>
                저장
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
