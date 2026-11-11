"use client";

import { FileText, Trash2 } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
} from "react";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { isOverdue } from "@/lib/schedule-view";
import type { Schedule, StickyColor } from "@/lib/types";
import { cn } from "@/lib/utils";
import { shouldHandleKey } from "@/lib/week-view";

// ------------------------------------------------------------ view memory

export type ScheduleView = "month" | "week";

const VIEW_KEY = "dh-teams:schedule-view";
const VIEW_EVENT = "dh-teams:schedule-view";
// Fallback so the toggle still works when browser storage is blocked.
let memoryView: ScheduleView = "month";

function loadView(): ScheduleView {
  try {
    const stored = window.localStorage.getItem(VIEW_KEY);
    if (stored === null) return memoryView;
    return stored === "week" ? "week" : "month";
  } catch {
    return memoryView;
  }
}

function subscribeView(listener: () => void) {
  window.addEventListener(VIEW_EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(VIEW_EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}

/** Remembered month/week choice; the server render always starts at month. */
export function useScheduleView(): [ScheduleView, (view: ScheduleView) => void] {
  const view = useSyncExternalStore(subscribeView, loadView, () => "month" as const);
  const change = useCallback((next: ScheduleView) => {
    memoryView = next;
    try {
      window.localStorage.setItem(VIEW_KEY, next);
    } catch {
      // View choice stays in memory.
    }
    window.dispatchEvent(new Event(VIEW_EVENT));
  }, []);
  return [view, change];
}

// ------------------------------------------------------------ week board

const WEEKDAYS_MON = ["월", "화", "수", "목", "금", "토", "일"];
const PHONE_QUERY = "(max-width: 639px)";

const EDGE_CLASS: Record<StickyColor, string> = {
  yellow: "border-l-yellow-400",
  pink: "border-l-pink-400",
  blue: "border-l-sky-400",
  green: "border-l-emerald-400",
};

interface ScheduleWeekProps {
  days: readonly string[];
  byDate: ReadonlyMap<string, readonly Schedule[]>;
  todayKey: string;
  showDone: boolean;
  onToggleShowDone: () => void;
  /** Resolves true when the row was created. */
  onAdd: (day: string, title: string) => Promise<boolean>;
  onToggle: (item: Schedule) => void;
  /** Resolves true when the edit can close (saved, or the row is gone). */
  onRename: (item: Schedule, title: string) => Promise<boolean>;
  onOpenDetail: (item: Schedule) => void;
  onRemove: (item: Schedule) => void;
}

type RowEdit = { id: string; draft: string };

export function ScheduleWeek({
  days,
  byDate,
  todayKey,
  showDone,
  onToggleShowDone,
  onAdd,
  onToggle,
  onRename,
  onOpenDetail,
  onRemove,
}: ScheduleWeekProps) {
  // Typed text lives apart from the rows, so a background refresh never wipes it.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<RowEdit | null>(null);
  const editRef = useRef<RowEdit | null>(null);
  const saving = useRef(false);
  const todayRef = useRef<HTMLElement | null>(null);

  // Phone: jump to today's day in the stacked list.
  useEffect(() => {
    if (window.matchMedia(PHONE_QUERY).matches) {
      todayRef.current?.scrollIntoView({ block: "start" });
    }
  }, [days]);

  const rowsOf = (day: string) => byDate.get(day) ?? [];
  const doneCount = days.reduce(
    (sum, day) => sum + rowsOf(day).filter((item) => item.done).length,
    0,
  );
  const findRow = (id: string) => {
    for (const day of days) {
      const row = rowsOf(day).find((item) => item.id === id);
      if (row) return row;
    }
    return null;
  };

  const setEdit = (next: RowEdit | null) => {
    editRef.current = next;
    setEditing(next);
  };

  async function commitEdit(source: "enter" | "blur") {
    const current = editRef.current;
    if (!current || saving.current) return;
    const item = findRow(current.id);
    const title = current.draft.trim();
    if (!item) {
      setEdit(null);
      return;
    }
    if (!title) {
      setEdit(null);
      if (source === "enter") onRemove(item);
      return;
    }
    if (title === item.title) {
      setEdit(null);
      return;
    }
    saving.current = true;
    try {
      const done = await onRename(item, title);
      if (done && editRef.current?.id === current.id) setEdit(null);
    } finally {
      saving.current = false;
    }
  }

  function onEditKey(event: KeyboardEvent<HTMLInputElement>) {
    if (!shouldHandleKey(event.nativeEvent)) return;
    if (event.key === "Escape") {
      event.preventDefault();
      setEdit(null);
    } else if (event.key === "Enter") {
      event.preventDefault();
      void commitEdit("enter");
    } else if (event.key === "Backspace" && event.currentTarget.value === "") {
      event.preventDefault();
      const item = editRef.current && findRow(editRef.current.id);
      setEdit(null);
      if (item) onRemove(item);
    }
  }

  async function onAddKey(day: string, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter" || !shouldHandleKey(event.nativeEvent)) return;
    event.preventDefault();
    const title = (drafts[day] ?? "").trim();
    if (!title) return;
    setDrafts((prev) => ({ ...prev, [day]: "" }));
    const ok = await onAdd(day, title);
    // Put the text back on failure unless the user already typed something new.
    if (!ok) setDrafts((prev) => (prev[day] ? prev : { ...prev, [day]: title }));
  }

  const renderRow = (item: Schedule) => {
    const overdue = isOverdue(item, todayKey);
    const isEditing = editing?.id === item.id;
    return (
      <div
        key={item.id}
        data-week-row={item.id}
        data-overdue={overdue ? "true" : undefined}
        className={cn(
          "flex min-h-10 items-center gap-1.5 rounded border border-l-4 bg-background px-1.5 py-1 text-xs sm:min-h-0",
          EDGE_CLASS[item.color],
          item.done && "opacity-60",
        )}
      >
        <Checkbox
          className="size-3.5 shrink-0"
          checked={item.done}
          onCheckedChange={() => onToggle(item)}
          aria-label="완료"
        />
        {isEditing ? (
          <>
            <Input
              autoFocus
              aria-label="할 일 고치기"
              maxLength={200}
              className="h-7 min-w-0 flex-1 px-1 text-xs"
              value={editing.draft}
              onChange={(e) => setEdit({ id: item.id, draft: e.target.value })}
              onKeyDown={onEditKey}
              onBlur={() => void commitEdit("blur")}
            />
            {/* mousedown keeps focus in the input so blur does not save first. */}
            <button
              type="button"
              className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent"
              aria-label="상세"
              title="담당·메모·색"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setEdit(null);
                onOpenDetail(item);
              }}
            >
              <FileText className="size-3.5" />
            </button>
            <button
              type="button"
              className="shrink-0 rounded p-0.5 text-destructive hover:bg-accent"
              aria-label="삭제"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setEdit(null);
                onRemove(item);
              }}
            >
              <Trash2 className="size-3.5" />
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className={cn(
                "min-w-0 flex-1 break-words text-left",
                item.done && "line-through",
                overdue && "text-rose-700",
              )}
              onClick={() => setEdit({ id: item.id, draft: item.title })}
            >
              {item.title}
            </button>
            {item.assignee ? (
              <span className="shrink-0 text-[11px] opacity-70">{item.assignee}</span>
            ) : null}
          </>
        )}
      </div>
    );
  };

  return (
    <div data-testid="week-board" className="space-y-2">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-7 sm:gap-px sm:rounded-lg sm:border sm:bg-border">
        {days.map((day, i) => {
          const isToday = day === todayKey;
          const rows = rowsOf(day).filter((item) => showDone || !item.done);
          return (
            <section
              key={day}
              ref={isToday ? todayRef : undefined}
              data-week-day={day}
              data-today={isToday ? "true" : undefined}
              aria-label={`${day} 할 일`}
              className={cn(
                "flex min-w-0 flex-col gap-1 rounded-lg border bg-background p-1.5 sm:max-h-[28rem] sm:overflow-y-auto sm:rounded-none sm:border-0",
                isToday && "bg-primary/10 ring-2 ring-inset ring-primary/70",
              )}
            >
              <h4
                className={cn(
                  "px-1 text-xs font-medium",
                  i === 5 && "text-blue-600",
                  i === 6 && "text-red-600",
                  isToday && "font-bold text-primary",
                )}
              >
                {WEEKDAYS_MON[i]} {Number(day.slice(8))}
                {isToday ? " (오늘)" : ""}
              </h4>
              {rows.map(renderRow)}
              <Input
                aria-label={`${day} 할 일 추가`}
                placeholder="+ 추가"
                maxLength={200}
                className="h-10 px-1.5 text-xs sm:h-7"
                value={drafts[day] ?? ""}
                onChange={(e) => {
                  const value = e.target.value;
                  setDrafts((prev) => ({ ...prev, [day]: value }));
                }}
                onKeyDown={(e) => void onAddKey(day, e)}
              />
            </section>
          );
        })}
      </div>
      {doneCount > 0 ? (
        <button
          type="button"
          className="rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent"
          onClick={onToggleShowDone}
        >
          {showDone ? `완료 ${doneCount}건 숨기기` : `완료 ${doneCount}건 보기`}
        </button>
      ) : null}
    </div>
  );
}
