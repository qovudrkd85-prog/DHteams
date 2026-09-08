"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  MapPin,
  Plus,
  RefreshCw,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  dateKey,
  monthCells,
  occursOn,
  EVENT_CATEGORIES,
  listDepartmentEvents,
  saveDepartmentEvent,
  setDepartmentEventDeleted,
  type DepartmentEvent,
  type DepartmentEventInput,
  type EventCategory,
} from "@/lib/department-events";

const categories = Object.entries(EVENT_CATEGORIES) as [
  EventCategory,
  (typeof EVENT_CATEGORIES)[EventCategory],
][];
const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
const primary = "bg-teal-700 text-white hover:bg-teal-800";
const message = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "일정을 처리하지 못했습니다. 다시 시도해 주세요.";
type Editor = { original?: DepartmentEvent; input: DepartmentEventInput };

export function DepartmentCalendar() {
  const [month, setMonth] = useState(() => new Date());
  const [selected, setSelected] = useState(() => dateKey(new Date()));
  const [events, setEvents] = useState<DepartmentEvent[]>([]);
  const [filter, setFilter] = useState<EventCategory | "all">("all");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestVersion = useRef(0);
  const cells = useMemo(() => monthCells(month), [month]);
  const first = dateKey(cells[0]);
  const last = dateKey(cells[41]);
  const monthKey = dateKey(month).slice(0, 7);
  const [loadedRange, setLoadedRange] = useState("");
  const range = `${first}/${last}`;
  const invalidate = useCallback(() => {
    ++requestVersion.current;
  }, []);

  const reload = useCallback(async () => {
    const version = ++requestVersion.current;
    try {
      const rows = await listDepartmentEvents(first, last);
      if (version !== requestVersion.current) return;
      setEvents(rows);
      setLoadedRange(`${first}/${last}`);
      setError(null);
    } catch (err) {
      if (version === requestVersion.current) setError(message(err));
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [first, last]);

  useEffect(() => {
    void reload();
    const refresh = () => {
      if (document.visibilityState === "visible") void reload();
    };
    const timer = window.setInterval(refresh, 30000);
    window.addEventListener("focus", refresh);
    return () => {
      invalidate();
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [reload, invalidate]);

  const currentEvents = loadedRange === range ? events : [];
  const visible = currentEvents.filter(
    (e) => filter === "all" || e.category === filter,
  );
  const dayEvents = visible.filter((e) => occursOn(e, selected));
  const monthCount = currentEvents.filter(
    (e) =>
      e.starts_on.slice(0, 7) <= monthKey && e.ends_on.slice(0, 7) >= monthKey,
  ).length;
  const today = dateKey(new Date());
  const isLoading = loading || (!error && loadedRange !== range);

  function create(day = selected) {
    setConfirmDelete(false);
    setEditor({
      input: {
        title: "",
        category: filter === "all" ? "meeting" : filter,
        starts_on: day,
        ends_on: day,
        starts_at: null,
        location: "",
        organizer: "",
        note: "",
      },
    });
  }
  function edit(event: DepartmentEvent) {
    setConfirmDelete(false);
    const {
      title,
      category,
      starts_on,
      ends_on,
      starts_at,
      location,
      organizer,
      note,
    } = event;
    setEditor({
      original: event,
      input: {
        title,
        category,
        starts_on,
        ends_on,
        starts_at: starts_at?.slice(0, 5) ?? null,
        location,
        organizer,
        note,
      },
    });
  }
  function patch(patch: Partial<DepartmentEventInput>) {
    setEditor((prev) =>
      prev ? { ...prev, input: { ...prev.input, ...patch } } : prev,
    );
  }
  function shiftMonth(delta: number) {
    const next = new Date(month.getFullYear(), month.getMonth() + delta, 1);
    setMonth(next);
    setSelected(dateKey(next));
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!editor || busy || !editor.input.title.trim()) return;
    if (editor.input.ends_on < editor.input.starts_on) {
      toast.error("종료일은 시작일보다 빠를 수 없습니다.");
      return;
    }
    setBusy(true);
    ++requestVersion.current;
    try {
      const { input, original } = editor;
      const saved = await saveDepartmentEvent(
        {
          ...input,
          title: input.title.trim(),
          location: input.location?.trim() || null,
          organizer: input.organizer?.trim() || null,
          note: input.note?.trim() || null,
        },
        original,
      );
      setEvents((prev) => [...prev.filter((e) => e.id !== saved.id), saved]);
      setSelected(saved.starts_on);
      if (saved.starts_on.slice(0, 7) !== monthKey)
        setMonth(new Date(`${saved.starts_on}T12:00:00`));
      setEditor(null);
      toast.success(
        original ? "일정을 수정했습니다." : "부서 일정을 등록했습니다.",
      );
      void reload();
    } catch (err) {
      toast.error(message(err));
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!editor?.original || busy) return;
    setBusy(true);
    ++requestVersion.current;
    try {
      const deleted = await setDepartmentEventDeleted(editor.original, true);
      setEvents((prev) => prev.filter((e) => e.id !== deleted.id));
      setEditor(null);
      toast.success("일정을 삭제했습니다.", {
        duration: 10000,
        action: {
          label: "되돌리기",
          onClick: async () => {
            try {
              await setDepartmentEventDeleted(deleted, false);
              await reload();
              toast.success("일정을 복원했습니다.");
            } catch (err) {
              toast.error(message(err));
            }
          },
        },
      });
      void reload();
    } catch (err) {
      toast.error(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
      aria-label="부서 공유 달력"
    >
      <div className="flex flex-wrap items-center justify-between gap-4 p-5 sm:p-6">
        <div className="flex items-center gap-3">
          <span className="rounded-xl bg-teal-50 p-2.5 text-teal-700">
            <CalendarDays className="size-5" />
          </span>
          <div>
            <h2 className="font-semibold text-slate-900">부서 공유 달력</h2>
            <p className="mt-1 text-xs text-slate-500">
              회의부터 회식까지, 함께 보는 우리 일정
            </p>
          </div>
        </div>
        <Button
          className={primary}
          onClick={() => create()}
          disabled={!!error || isLoading}
        >
          <Plus className="size-4" /> 일정 등록
        </Button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-y border-slate-100 px-5 py-4 sm:px-6">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="이전 달"
            onClick={() => shiftMonth(-1)}
          >
            <ChevronLeft />
          </Button>
          <h3 className="min-w-32 text-center text-xl font-semibold tracking-tight text-slate-900">
            {month.getFullYear()}.{" "}
            {String(month.getMonth() + 1).padStart(2, "0")}
          </h3>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="다음 달"
            onClick={() => shiftMonth(1)}
          >
            <ChevronRight />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setMonth(new Date());
              setSelected(today);
            }}
          >
            오늘
          </Button>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span>
            {isLoading
              ? "불러오는 중…"
              : error
                ? "연결 확인 필요"
                : `이달의 일정 ${monthCount}건`}
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="일정 새로고침"
            onClick={() => void reload()}
          >
            <RefreshCw className="size-3.5" />
          </Button>
        </div>
      </div>
      <div
        className="flex flex-wrap gap-2 px-5 py-3 sm:px-6"
        aria-label="일정 유형 필터"
      >
        <button
          type="button"
          aria-pressed={filter === "all"}
          onClick={() => setFilter("all")}
          className={cn(
            "rounded-full border px-3 py-1 text-xs",
            filter === "all"
              ? "border-slate-800 bg-slate-800 text-white"
              : "border-slate-200 text-slate-600",
          )}
        >
          전체
        </button>
        {categories.map(([key, category]) => (
          <button
            type="button"
            key={key}
            aria-pressed={filter === key}
            onClick={() => setFilter(key)}
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs",
              filter === key
                ? category.className
                : "border-transparent text-slate-500 hover:bg-slate-50",
            )}
          >
            <span className={cn("size-1.5 rounded-full", category.dot)} />
            {category.label}
          </button>
        ))}
      </div>
      {error && (
        <div
          role="alert"
          className="mx-5 mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
        >
          {error}
          <p className="mt-1 text-xs">
            과업 목록은 계속 이용할 수 있습니다. 연결 후 새로고침해 주세요.
          </p>
        </div>
      )}
      <div
        className="grid grid-cols-7 border-t border-slate-100"
        aria-busy={isLoading}
      >
        {weekdays.map((day, i) => (
          <div
            key={day}
            className={cn(
              "bg-slate-50/80 py-2 text-center text-xs font-medium",
              i === 0
                ? "text-rose-500"
                : i === 6
                  ? "text-blue-500"
                  : "text-slate-500",
            )}
          >
            {day}
          </div>
        ))}
        {cells.map((date, i) => {
          const day = dateKey(date);
          const items = visible.filter((e) => occursOn(e, day));
          const inMonth = date.getMonth() === month.getMonth();
          return (
            <div
              key={day}
              className={cn(
                "min-w-0 border-t border-slate-100 p-1 sm:min-h-28 sm:p-2",
                i % 7 !== 6 && "border-r",
                !inMonth && "bg-slate-50/70",
                selected === day &&
                  "bg-teal-50/60 ring-1 ring-inset ring-teal-500",
              )}
            >
              <button
                type="button"
                aria-label={`${day} 일정 보기`}
                aria-pressed={selected === day}
                onClick={() => setSelected(day)}
                className="flex w-full items-center justify-between rounded py-1 text-xs focus-visible:outline-2 focus-visible:outline-teal-600"
              >
                <span
                  className={cn(
                    "flex size-7 items-center justify-center rounded-full",
                    day === today
                      ? "bg-teal-700 font-semibold text-white"
                      : !inMonth
                        ? "text-slate-400"
                        : date.getDay() === 0
                          ? "text-rose-500"
                          : date.getDay() === 6
                            ? "text-blue-500"
                            : "text-slate-700",
                  )}
                >
                  {date.getDate()}
                </span>
                {items.length > 0 && (
                  <span className="pr-1 text-[10px] text-slate-400 sm:hidden">
                    {items.length}
                  </span>
                )}
              </button>
              <div className="hidden space-y-1 sm:block">
                {items.slice(0, 3).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => edit(item)}
                    title={`${EVENT_CATEGORIES[item.category].label} · ${item.title}`}
                    className={cn(
                      "block w-full truncate rounded border-l-2 px-1.5 py-1 text-left text-[11px]",
                      EVENT_CATEGORIES[item.category].className,
                    )}
                  >
                    {item.starts_at && (
                      <span className="mr-1 opacity-70">
                        {item.starts_at.slice(0, 5)}
                      </span>
                    )}
                    {item.title}
                  </button>
                ))}
                {items.length > 3 && (
                  <button
                    type="button"
                    onClick={() => setSelected(day)}
                    className="px-1 text-[11px] text-teal-700"
                  >
                    +{items.length - 3}건 더 보기
                  </button>
                )}
              </div>
              <div className="flex min-h-3 flex-wrap gap-1 px-1 pb-1 sm:hidden">
                {items.slice(0, 5).map((item) => (
                  <span
                    key={item.id}
                    className={cn(
                      "size-1.5 rounded-full",
                      EVENT_CATEGORIES[item.category].dot,
                    )}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="border-t border-slate-200 p-5 sm:p-6">
        <div className="mb-4 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-900">
            {Number(selected.slice(5, 7))}월 {Number(selected.slice(8))}일{" "}
            <span className="ml-1 font-normal text-slate-500">
              {dayEvents.length}개의 일정
            </span>
          </h3>
          <Button
            variant="ghost"
            size="sm"
            className="text-teal-700"
            disabled={!!error || isLoading}
            onClick={() => create()}
          >
            <Plus className="size-3.5" /> 이 날짜에 추가
          </Button>
        </div>
        {isLoading ? (
          <p className="py-4 text-center text-sm text-slate-500">
            일정을 불러오고 있습니다.
          </p>
        ) : error ? (
          <p className="py-4 text-center text-sm text-slate-500">
            연결되면 이 날짜의 일정을 표시합니다.
          </p>
        ) : dayEvents.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 py-7 text-center">
            <CalendarDays className="mx-auto mb-2 size-6 text-slate-300" />
            <p className="text-sm text-slate-500">
              {filter === "all"
                ? "아직 등록된 일정이 없어요."
                : "선택한 유형의 일정이 없어요."}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              부서원과 함께할 첫 일정을 남겨 보세요.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {dayEvents.map((item) => (
              <button
                type="button"
                key={item.id}
                onClick={() => edit(item)}
                className="flex w-full items-start gap-3 rounded-xl border border-slate-100 p-3 text-left transition-colors hover:bg-slate-50"
              >
                <span
                  className={cn(
                    "mt-0.5 shrink-0 rounded-md px-2 py-1 text-[11px]",
                    EVENT_CATEGORIES[item.category].className,
                  )}
                >
                  {EVENT_CATEGORIES[item.category].label}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="break-words text-sm font-medium text-slate-800">
                    {item.title}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                    <span className="flex items-center gap-1">
                      <Clock3 className="size-3" />
                      {item.starts_at?.slice(0, 5) ?? "종일"}
                      {item.ends_on !== item.starts_on &&
                        ` · ${item.starts_on.slice(5)} ~ ${item.ends_on.slice(5)}`}
                    </span>
                    {item.location && (
                      <span className="flex items-center gap-1">
                        <MapPin className="size-3" />
                        {item.location}
                      </span>
                    )}
                    {item.organizer && (
                      <span className="flex items-center gap-1">
                        <Users className="size-3" />
                        {item.organizer}
                      </span>
                    )}
                  </div>
                </div>
                <ChevronRight className="mt-1 size-4 shrink-0 text-slate-300" />
              </button>
            ))}
          </div>
        )}
        <p className="mt-4 text-right text-[11px] text-slate-400">
          함께 쓰는 일정 · 30초마다 자동 갱신
        </p>
      </div>
      <Dialog
        open={editor !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setEditor(null);
        }}
      >
        <DialogContent
          className="max-h-[90dvh] overflow-y-auto sm:max-w-lg"
          showCloseButton={!busy}
        >
          <form onSubmit={submit}>
            <DialogHeader>
              <DialogTitle>
                {editor?.original ? "부서 일정 수정" : "새 부서 일정"}
              </DialogTitle>
              <DialogDescription>
                등록한 일정은 부서원 모두가 함께 보고 수정할 수 있습니다.
              </DialogDescription>
            </DialogHeader>
            <fieldset disabled={busy} className="space-y-4 py-5">
              <div className="space-y-2">
                <Label htmlFor="event-title">일정명</Label>
                <Input
                  id="event-title"
                  autoFocus
                  required
                  maxLength={200}
                  placeholder="예) 금요일 부서 회식"
                  value={editor?.input.title ?? ""}
                  onChange={(e) => patch({ title: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="event-category">유형</Label>
                <select
                  id="event-category"
                  className="h-9 w-full rounded-lg border bg-background px-3 text-sm"
                  value={editor?.input.category ?? "meeting"}
                  onChange={(e) =>
                    patch({ category: e.target.value as EventCategory })
                  }
                >
                  {categories.map(([key, c]) => (
                    <option value={key} key={key}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="event-start">시작일</Label>
                  <Input
                    id="event-start"
                    type="date"
                    required
                    value={editor?.input.starts_on ?? ""}
                    onChange={(e) =>
                      patch({
                        starts_on: e.target.value,
                        ends_on:
                          (editor?.input.ends_on ?? "") < e.target.value
                            ? e.target.value
                            : editor!.input.ends_on,
                      })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="event-end">종료일</Label>
                  <Input
                    id="event-end"
                    type="date"
                    required
                    min={editor?.input.starts_on}
                    value={editor?.input.ends_on ?? ""}
                    onChange={(e) => patch({ ends_on: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="event-time">시작 시간 (비우면 종일)</Label>
                  <Input
                    id="event-time"
                    type="time"
                    value={editor?.input.starts_at ?? ""}
                    onChange={(e) =>
                      patch({ starts_at: e.target.value || null })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="event-organizer">담당자·참석자</Label>
                  <Input
                    id="event-organizer"
                    maxLength={100}
                    placeholder="예) 부서 전체"
                    value={editor?.input.organizer ?? ""}
                    onChange={(e) => patch({ organizer: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="event-location">장소</Label>
                <Input
                  id="event-location"
                  maxLength={200}
                  placeholder="예) 2층 회의실"
                  value={editor?.input.location ?? ""}
                  onChange={(e) => patch({ location: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="event-note">메모</Label>
                <Textarea
                  id="event-note"
                  maxLength={2000}
                  placeholder="준비물이나 함께 알아야 할 내용을 적어 주세요."
                  value={editor?.input.note ?? ""}
                  onChange={(e) => patch({ note: e.target.value })}
                />
              </div>
            </fieldset>
            {confirmDelete && (
              <div
                role="alert"
                className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-800"
              >
                이 일정을 삭제할까요? 삭제 후 알림에서 되돌릴 수 있습니다.
                <div className="mt-2 flex gap-2">
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    disabled={busy}
                    onClick={() => void remove()}
                  >
                    삭제 확인
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => setConfirmDelete(false)}
                  >
                    취소
                  </Button>
                </div>
              </div>
            )}
            <DialogFooter className="sm:justify-between">
              {editor?.original ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="text-red-600"
                  disabled={busy}
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 className="size-4" /> 삭제
                </Button>
              ) : (
                <span />
              )}
              <Button
                type="submit"
                className={primary}
                disabled={busy || !editor?.input.title.trim()}
              >
                {busy ? "처리 중…" : "저장"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
