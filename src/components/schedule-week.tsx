"use client";

import { FileText, Trash2 } from "lucide-react";
import {
  Fragment,
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
import type { Schedule, ScheduleKind, StickyColor } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  isTodo,
  nextOrder,
  numberLabels,
  orderBetween,
  parseShortcut,
  stickyKind,
} from "@/lib/week-blocks";
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

// Same names as the D11 block menu.
const KIND_LABEL: Record<ScheduleKind, string> = {
  todo: "할 일 목록",
  text: "텍스트",
  h1: "제목1",
  h2: "제목2",
  h3: "제목3",
  bullet: "글머리 기호 목록",
  number: "번호 매기기 목록",
};

const BLOCK_TEXT_CLASS: Record<Exclude<ScheduleKind, "todo">, string> = {
  h1: "text-base font-bold",
  h2: "text-sm font-bold",
  h3: "text-xs font-semibold",
  text: "text-xs",
  bullet: "text-xs",
  number: "text-xs",
};

const kindOf = (item: Schedule): ScheduleKind => item.kind ?? "todo";
const placeholderOf = (kind: ScheduleKind) => (kind === "todo" ? "+ 추가" : KIND_LABEL[kind]);

type Draft = { kind: ScheduleKind; text: string };
const EMPTY_DRAFT: Draft = { kind: "todo", text: "" };

interface ScheduleWeekProps {
  days: readonly string[];
  byDate: ReadonlyMap<string, readonly Schedule[]>;
  todayKey: string;
  showDone: boolean;
  /** schedules.kind exists: block kinds, shortcuts and in-between lines are on. */
  blocksReady: boolean;
  onToggleShowDone: () => void;
  /** Resolves the created row, or null when nothing was saved. */
  onAdd: (
    day: string,
    title: string,
    block?: { kind: ScheduleKind; sort_order: number },
  ) => Promise<Schedule | null>;
  onToggle: (item: Schedule) => void;
  /** Resolves true when the edit can close (saved, or the row is gone). */
  onRename: (item: Schedule, title: string, kind?: ScheduleKind) => Promise<boolean>;
  onOpenDetail: (item: Schedule) => void;
  onRemove: (item: Schedule) => void;
}

type RowEdit = { id: string; draft: string; kind: ScheduleKind };
type InsertDraft = Draft & { day: string; after: string };

export function ScheduleWeek({
  days,
  byDate,
  todayKey,
  showDone,
  blocksReady,
  onToggleShowDone,
  onAdd,
  onToggle,
  onRename,
  onOpenDetail,
  onRemove,
}: ScheduleWeekProps) {
  // Typed text lives apart from the rows, so a background refresh never wipes it.
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [editing, setEditing] = useState<RowEdit | null>(null);
  const editRef = useRef<RowEdit | null>(null);
  const saving = useRef(false);
  // The empty line opened right below a row after Enter in its edit input (D10).
  const [insert, setInsertState] = useState<InsertDraft | null>(null);
  const insertRef = useRef<InsertDraft | null>(null);
  const inserting = useRef(false);
  const todayRef = useRef<HTMLElement | null>(null);

  // Phone: jump to today's day in the stacked list.
  useEffect(() => {
    if (window.matchMedia(PHONE_QUERY).matches) {
      todayRef.current?.scrollIntoView({ block: "start" });
    }
  }, [days]);

  const rowsOf = (day: string) => byDate.get(day) ?? [];
  const doneCount = days.reduce(
    (sum, day) => sum + rowsOf(day).filter((item) => isTodo(item) && item.done).length,
    0,
  );
  const findRow = (id: string) => {
    for (const day of days) {
      const row = rowsOf(day).find((item) => item.id === id);
      if (row) return row;
    }
    return null;
  };

  /** Typed value -> draft; a leading Markdown mark switches the kind (only with the kind column). */
  const readInput = (value: string, kind: ScheduleKind): Draft =>
    (blocksReady ? parseShortcut(value) : null) ?? { kind, text: value };

  const setEdit = (next: RowEdit | null) => {
    editRef.current = next;
    setEditing(next);
  };
  const setInsert = (next: InsertDraft | null) => {
    insertRef.current = next;
    setInsertState(next);
  };
  const setDraft = (day: string, next: Draft) => setDrafts((prev) => ({ ...prev, [day]: next }));

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
    const kind = blocksReady ? current.kind : kindOf(item);
    const kindChanged = kind !== kindOf(item);
    if (title !== item.title || kindChanged) {
      saving.current = true;
      try {
        const done = await onRename(item, title, kindChanged ? kind : undefined);
        if (!done || editRef.current?.id !== current.id) return;
      } finally {
        saving.current = false;
      }
    }
    setEdit(null);
    // D10: Enter opens an empty line right below, in the same day.
    if (source === "enter" && blocksReady) {
      setInsert({ day: item.due_date, after: item.id, kind: stickyKind(kind), text: "" });
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
      const current = editRef.current;
      const item = current && findRow(current.id);
      // A just-typed shortcut on an empty line is undone first; otherwise the line goes.
      if (current && item && current.kind !== kindOf(item)) {
        setEdit({ ...current, kind: kindOf(item) });
        return;
      }
      setEdit(null);
      if (item) onRemove(item);
    }
  }

  async function onAddKey(day: string, event: KeyboardEvent<HTMLInputElement>) {
    if (!shouldHandleKey(event.nativeEvent)) return;
    const draft = drafts[day] ?? EMPTY_DRAFT;
    if (event.key === "Backspace") {
      if (draft.text === "" && draft.kind !== "todo") {
        event.preventDefault();
        setDraft(day, EMPTY_DRAFT);
      }
      return;
    }
    if (event.key !== "Enter") return;
    event.preventDefault();
    const title = draft.text.trim();
    if (!title) {
      if (draft.kind !== "todo") setDraft(day, EMPTY_DRAFT);
      return;
    }
    const kind = blocksReady ? draft.kind : "todo";
    setDraft(day, { kind: stickyKind(kind), text: "" });
    const created = await onAdd(
      day,
      title,
      blocksReady ? { kind, sort_order: nextOrder(rowsOf(day)) } : undefined,
    );
    // Put the text back on failure unless the user already typed something new.
    if (!created) setDrafts((prev) => (prev[day]?.text ? prev : { ...prev, [day]: { kind, text: title } }));
  }

  async function onInsertKey(event: KeyboardEvent<HTMLInputElement>) {
    if (!shouldHandleKey(event.nativeEvent)) return;
    const current = insertRef.current;
    if (!current || inserting.current) return;
    if (event.key === "Escape") {
      event.preventDefault();
      setInsert(null);
      return;
    }
    if ((event.key === "Enter" || event.key === "Backspace") && current.text.trim() === "") {
      if (event.key === "Backspace" && current.text !== "") return;
      event.preventDefault();
      setInsert(current.kind === "todo" ? null : { ...current, kind: "todo" });
      return;
    }
    if (event.key !== "Enter") return;
    event.preventDefault();
    const rows = rowsOf(current.day);
    const index = rows.findIndex((item) => item.id === current.after);
    if (index < 0) {
      setInsert(null);
      return;
    }
    const below = rows[index + 1];
    const sortOrder = orderBetween(rows[index].sort_order ?? 0, below ? (below.sort_order ?? 0) : null);
    const title = current.text.trim();
    setInsert({ ...current, kind: stickyKind(current.kind), text: "" });
    inserting.current = true;
    try {
      const created = await onAdd(current.day, title, { kind: current.kind, sort_order: sortOrder });
      const now = insertRef.current;
      if (!now || now.after !== current.after) return;
      // Keep typing below the new line; on failure the text comes back.
      setInsert(created ? { ...now, after: created.id } : { ...now, kind: current.kind, text: now.text || title });
    } finally {
      inserting.current = false;
    }
  }

  // Close an empty in-between line once focus leaves it (it remounts below each new line).
  function onInsertBlur() {
    window.setTimeout(() => {
      const current = insertRef.current;
      const active = document.activeElement;
      if (!current || inserting.current || current.text !== "") return;
      if (active instanceof HTMLElement && active.dataset.insertDraft !== undefined) return;
      setInsert(null);
    }, 0);
  }

  const renderInsert = (day: string) => {
    const current = insert;
    if (!current) return null;
    return (
      <Input
        key={`insert-${current.after}`}
        autoFocus
        data-insert-draft=""
        data-draft-kind={current.kind}
        aria-label={`${day} 줄 사이 추가`}
        placeholder={placeholderOf(current.kind)}
        maxLength={200}
        className="h-10 px-1.5 text-xs sm:h-7"
        value={current.text}
        onChange={(e) => {
          const now = insertRef.current;
          if (now) setInsert({ ...now, ...readInput(e.target.value, now.kind) });
        }}
        onKeyDown={(e) => void onInsertKey(e)}
        onBlur={onInsertBlur}
      />
    );
  };

  const renderEditInput = (item: Schedule, edit: RowEdit) => (
    <>
      <Input
        autoFocus
        aria-label="할 일 고치기"
        data-draft-kind={edit.kind}
        placeholder={placeholderOf(edit.kind)}
        maxLength={200}
        className="h-7 min-w-0 flex-1 px-1 text-xs"
        value={edit.draft}
        onChange={(e) => {
          const next = readInput(e.target.value, edit.kind);
          setEdit({ id: item.id, draft: next.text, kind: next.kind });
        }}
        onKeyDown={onEditKey}
        onBlur={() => void commitEdit("blur")}
      />
      {/* mousedown keeps focus in the input so blur does not save first. Detail is for to-dos only. */}
      {isTodo(item) ? (
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
      ) : null}
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
  );

  const startEdit = (item: Schedule) => setEdit({ id: item.id, draft: item.title, kind: kindOf(item) });

  const renderRow = (item: Schedule, numberLabel: number | null) => {
    const kind = kindOf(item);
    const edit = editing?.id === item.id ? editing : null;
    if (kind !== "todo") {
      return (
        <div
          key={item.id}
          data-week-row={item.id}
          data-kind={kind}
          className="flex min-h-10 items-center gap-1.5 rounded px-1.5 py-1 sm:min-h-0"
        >
          {kind === "bullet" ? (
            <span aria-hidden="true" className="shrink-0 text-xs">
              •
            </span>
          ) : null}
          {kind === "number" ? <span className="shrink-0 text-xs tabular-nums">{numberLabel}.</span> : null}
          {edit ? (
            renderEditInput(item, edit)
          ) : (
            <button
              type="button"
              className={cn("min-w-0 flex-1 break-words text-left", BLOCK_TEXT_CLASS[kind])}
              onClick={() => startEdit(item)}
            >
              {item.title}
            </button>
          )}
        </div>
      );
    }
    const overdue = isOverdue(item, todayKey);
    return (
      <div
        key={item.id}
        data-week-row={item.id}
        data-kind="todo"
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
        {edit ? (
          renderEditInput(item, edit)
        ) : (
          <>
            <button
              type="button"
              className={cn(
                "min-w-0 flex-1 break-words text-left",
                item.done && "line-through",
                overdue && "text-rose-700",
              )}
              onClick={() => startEdit(item)}
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
          const labels = numberLabels(rows);
          const draft = drafts[day] ?? EMPTY_DRAFT;
          const draftKind = blocksReady ? draft.kind : "todo";
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
              {rows.map((item, index) => (
                <Fragment key={item.id}>
                  {renderRow(item, labels[index])}
                  {blocksReady && insert?.day === day && insert.after === item.id
                    ? renderInsert(day)
                    : null}
                </Fragment>
              ))}
              <Input
                aria-label={`${day} 할 일 추가`}
                data-draft-kind={draftKind}
                placeholder={placeholderOf(draftKind)}
                maxLength={200}
                className="h-10 px-1.5 text-xs sm:h-7"
                value={draft.text}
                onChange={(e) => {
                  const value = e.target.value;
                  setDrafts((prev) => ({
                    ...prev,
                    [day]: readInput(value, (prev[day] ?? EMPTY_DRAFT).kind),
                  }));
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
