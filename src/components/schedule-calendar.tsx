"use client";

import { ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { MonthMemo } from "@/components/month-memo";
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
import { STICKY_COLORS, type Schedule, type StickyColor } from "@/lib/types";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

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
  | { mode: "create"; due_date: string; title: string; assignee: string; note: string; color: StickyColor }
  | { mode: "edit"; target: Schedule; title: string; assignee: string; note: string; color: StickyColor };

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

export function ScheduleCalendar({ projectId }: { projectId: string }) {
  const [month, setMonth] = useState(() => new Date());
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      setSchedules(await api.listSchedules(projectId));
    } catch (error) {
      toast.error(errorMessage(error, "일정을 불러오지 못했습니다. 일정 테이블 SQL을 실행했는지 확인하세요."));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const cells = useMemo(() => buildMonthCells(month), [month]);

  const byDate = useMemo(() => {
    const map = new Map<string, Schedule[]>();
    schedules.forEach((s) => {
      const list = map.get(s.due_date) ?? [];
      map.set(s.due_date, [...list, s]);
    });
    return map;
  }, [schedules]);

  const todoCount = schedules.filter((s) => !s.done).length;

  const monthKey = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}`;
  const monthItems = useMemo(
    () => schedules.filter((s) => s.due_date.startsWith(monthKey)),
    [schedules, monthKey],
  );

  async function submitEdit(event: React.FormEvent) {
    event.preventDefault();
    if (!edit || !edit.title.trim()) return;

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
        const updated = await api.updateSchedule(edit.target.id, {
          title: edit.title.trim(),
          assignee: edit.assignee.trim() || null,
          note: edit.note.trim() || null,
          color: edit.color,
        });
        setSchedules((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
      }
      setEdit(null);
    } catch (error) {
      toast.error(errorMessage(error, "저장하지 못했습니다."));
    }
  }

  async function toggleDone(schedule: Schedule) {
    const next = !schedule.done;
    setSchedules((prev) => prev.map((s) => (s.id === schedule.id ? { ...s, done: next } : s)));
    try {
      await api.updateSchedule(schedule.id, { done: next });
    } catch (error) {
      setSchedules((prev) => prev.map((s) => (s.id === schedule.id ? { ...s, done: !next } : s)));
      toast.error(errorMessage(error, "저장하지 못했습니다."));
    }
  }

  async function remove(schedule: Schedule) {
    try {
      await api.deleteSchedule(schedule.id);
      setSchedules((prev) => prev.filter((s) => s.id !== schedule.id));
      setEdit(null);
    } catch (error) {
      toast.error(errorMessage(error, "삭제하지 못했습니다."));
    }
  }

  const shiftMonth = (delta: number) =>
    setMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));

  const todayKey = toKey(new Date());

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold">00_업무일정</h2>
        <span className="text-xs text-muted-foreground">남은 일 {todoCount}건</span>
        <div className="flex-1" />
        <Button variant="outline" size="icon" className="size-8" onClick={() => shiftMonth(-1)}>
          <ChevronLeft className="size-4" />
        </Button>
        <span className="w-28 text-center text-sm font-medium">
          {month.getFullYear()}년 {month.getMonth() + 1}월
        </span>
        <Button variant="outline" size="icon" className="size-8" onClick={() => shiftMonth(1)}>
          <ChevronRight className="size-4" />
        </Button>
        <Button variant="outline" size="sm" onClick={() => setMonth(new Date())}>
          오늘
        </Button>
      </div>

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

          return (
            <div
              key={key}
              className={cn(
                "min-h-24 bg-background p-1 text-left align-top",
                !inMonth && "bg-muted/40 text-muted-foreground",
              )}
            >
              <button
                type="button"
                className={cn(
                  "mb-1 flex w-full items-center justify-between rounded px-1 text-[11px] hover:bg-accent",
                  key === todayKey && "font-bold text-primary",
                )}
                onClick={() =>
                  setEdit({
                    mode: "create",
                    due_date: key,
                    title: "",
                    assignee: "",
                    note: "",
                    color: "yellow",
                  })
                }
                title="클릭해서 일정 추가"
              >
                <span>{date.getDate()}</span>
                <span className="text-muted-foreground opacity-0 group-hover:opacity-100">+</span>
              </button>

              <div className="space-y-1">
                {items.map((item) => (
                  <div
                    key={item.id}
                    className={cn(
                      "flex items-start gap-1 rounded border px-1 py-0.5 text-left text-[11px] shadow-sm",
                      COLOR_CLASS[item.color],
                      item.done && "opacity-60",
                    )}
                  >
                    <Checkbox
                      className="mt-0.5 size-3"
                      checked={item.done}
                      onCheckedChange={() => toggleDone(item)}
                      aria-label="완료"
                    />
                    <button
                      type="button"
                      className={cn("min-w-0 flex-1 truncate", item.done && "line-through")}
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
                      title={item.assignee ? `${item.title} · ${item.assignee}` : item.title}
                    >
                      {item.title}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <MonthMemo projectId={projectId} month={monthKey} />

      {/* 이번 달 포스트잇 모아보기 */}
      <section className="rounded-lg border bg-background p-3">
        <h3 className="mb-2 text-sm font-medium">
          이번 달 할 일{" "}
          <span className="text-xs font-normal text-muted-foreground">
            {monthItems.filter((s) => !s.done).length}건 남음 / 전체 {monthItems.length}건
          </span>
        </h3>
        {monthItems.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">
            달력의 날짜를 클릭해 일정을 붙이세요.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {monthItems.map((item) => (
              <li
                key={item.id}
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
                  <span className={cn("block truncate font-medium", item.done && "line-through")}>
                    {item.title}
                  </span>
                  <span className="block text-[11px] opacity-70">
                    {item.due_date.slice(5).replace("-", "/")}
                    {item.assignee ? ` · ${item.assignee}` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {loading ? <p className="text-xs text-muted-foreground">불러오는 중...</p> : null}

      <Dialog open={edit !== null} onOpenChange={(open) => !open && setEdit(null)}>
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
                    setEdit((prev) => (prev ? { ...prev, title: e.target.value } : prev))
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
                    setEdit((prev) => (prev ? { ...prev, assignee: e.target.value } : prev))
                  }
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="s-note">메모</Label>
                <Textarea
                  id="s-note"
                  value={edit?.note ?? ""}
                  onChange={(e) =>
                    setEdit((prev) => (prev ? { ...prev, note: e.target.value } : prev))
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
                      onClick={() => setEdit((prev) => (prev ? { ...prev, color } : prev))}
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
