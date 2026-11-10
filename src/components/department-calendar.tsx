"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  Lock,
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
import type { TeamMember } from "@/lib/team/workspace";
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
  type EventVisibility,
  type EventCategory,
} from "@/lib/department-events";
import {
  DEADLINE_STYLE,
  deadlineMatchesCreator,
  listProjectDeadlines,
  projectToneMap,
  toneFor,
  type ProjectDeadline,
} from "@/lib/project-deadlines";
import { DeadlineChip, DeadlineRow } from "@/components/team/deadline-items";
import { CalendarLegend } from "@/components/team/calendar-legend";
import type { Project } from "@/lib/types";

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

function CreatorBadge({
  name,
  color,
  compact = false,
}: {
  name?: string | null;
  color?: string | null;
  compact?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex min-w-0 max-w-full items-center gap-1.5",
        compact ? "text-[10px] opacity-80" : "text-xs text-slate-600",
      )}
      title={`등록자: ${name || "미지정"}`}
    >
      <span
        aria-hidden="true"
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: color || "#94a3b8" }}
      />
      <span className="truncate">
        {name ? `${compact ? "" : "등록자 "}${name}` : "등록자 미지정"}
      </span>
    </span>
  );
}

export function DepartmentCalendar({
  members = [],
  currentMember = null,
  onRegister,
  fixedScope,
  active = true,
  projects = [],
  focusProject = null,
  focusDate = null,
}: {
  members?: TeamMember[];
  currentMember?: TeamMember | null;
  onRegister?: () => void;
  /** Lock the calendar to one scope (garage shows only my private events). */
  fixedScope?: "private";
  /** False while kept mounted but hidden (keeps month/filters); polling pauses and it reloads on return. */
  active?: boolean;
  /** Live projects for the deadline project picker. */
  projects?: readonly Pick<Project, "id" | "name">[];
  /** Open on this project's deadlines (link from a project's own calendar). */
  focusProject?: string | null;
  /** That project's next open deadline (YYYY-MM-DD); the calendar jumps to its month once. */
  focusDate?: string | null;
}) {
  const [month, setMonth] = useState(() => new Date());
  const [selected, setSelected] = useState(() => dateKey(new Date()));
  const [events, setEvents] = useState<DepartmentEvent[]>([]);
  // Project deadlines are shown read-only next to team events; null = the last load failed.
  const [deadlines, setDeadlines] = useState<ProjectDeadline[] | null>([]);
  const [deadlineError, setDeadlineError] = useState<string | null>(null);
  const [filter, setFilter] = useState<EventCategory | "all" | "deadline">("all");
  const [projectFilter, setProjectFilter] = useState("all");
  const [seenFocus, setSeenFocus] = useState<string | null>(null);
  const [seenFocusDate, setSeenFocusDate] = useState<string | null>(null);
  const [creatorFilter, setCreatorFilter] = useState("all");
  const [scopeFilter, setScopeFilter] = useState<"all" | EventVisibility>(fixedScope ?? "team");
  if (focusProject && focusProject !== seenFocus && !fixedScope) {
    // Show only that project's deadlines; other filters would hide them.
    setSeenFocus(focusProject);
    setSeenFocusDate(null);
    setFilter("deadline");
    setProjectFilter(focusProject);
    setCreatorFilter("all");
    setScopeFilter("team");
  }
  if (focusProject && focusDate && focusDate !== seenFocusDate && !fixedScope) {
    setSeenFocusDate(focusDate);
    const [fy, fm] = focusDate.split("-").map(Number);
    setMonth(new Date(fy, fm - 1, 1));
    setSelected(focusDate);
  }
  // The team room starts on team events; "통합" adds my private ones.
  const defaultScope = fixedScope ?? "team";
  const [editor, setEditor] = useState<Editor | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestVersion = useRef(0);
  const editorOpener = useRef<HTMLElement | null>(null);
  const createButton = useRef<HTMLButtonElement | null>(null);
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
      // A deadline failure must not hide the team events, so it is caught on its own.
      let dueError: string | null = null;
      const [rows, due] = await Promise.all([
        listDepartmentEvents(first, last),
        fixedScope
          ? Promise.resolve([])
          : listProjectDeadlines(first, last).catch((err: unknown) => {
              dueError = message(err);
              return null;
            }),
      ]);
      if (version !== requestVersion.current) return;
      setEvents(rows);
      setDeadlines(due);
      setDeadlineError(dueError);
      setLoadedRange(`${first}/${last}`);
      setError(null);
    } catch (err) {
      if (version === requestVersion.current) setError(message(err));
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [first, last, fixedScope]);
  const reloadCurrentMonth = useRef(reload);
  const activeRef = useRef(active);
  const wasActive = useRef(active);

  useEffect(() => {
    activeRef.current = active;
    // Back from another tab: events may have changed there (e.g. private events in the garage).
    if (active && !wasActive.current) void reloadCurrentMonth.current();
    wasActive.current = active;
  }, [active]);

  useEffect(() => {
    reloadCurrentMonth.current = reload;
    void reload();
    const refresh = () => {
      if (document.visibilityState === "visible" && activeRef.current) void reload();
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
  const activeCreatorFilter =
    creatorFilter === "mine" && !currentMember ? "all" : creatorFilter;
  const creators = new Map(members.map((member) => [member.id, member.name]));
  // Keep historical creators filterable even if they are not in the current roster.
  for (const event of currentEvents) {
    if (event.created_by && !creators.has(event.created_by)) {
      creators.set(event.created_by, event.creator_name || "이전 팀원");
    }
  }
  // Only the projects the page passed (this team's) count; RLS alone is not the boundary.
  const toneMap = useMemo(() => projectToneMap(projects.map((p) => p.id)), [projects]);
  const teamDeadlines = useMemo(() => {
    const ids = new Set(projects.map((p) => p.id));
    return (deadlines ?? []).filter((d) => ids.has(d.project_id));
  }, [deadlines, projects]);
  const visible = currentEvents.filter(
    (e) =>
      (filter === "all" || e.category === filter) &&
      (scopeFilter === "all" || (e.visibility ?? "team") === scopeFilter) &&
      (activeCreatorFilter === "all" ||
        (activeCreatorFilter === "mine"
          ? e.created_by === currentMember?.id
          : activeCreatorFilter === "unassigned"
            ? !e.created_by
            : e.created_by === activeCreatorFilter)),
  );
  const visibleDeadlines =
    loadedRange === range && (filter === "all" || filter === "deadline") && scopeFilter !== "private"
      ? teamDeadlines.filter((d) =>
          (filter !== "deadline" || projectFilter === "all" || d.project_id === projectFilter) &&
          deadlineMatchesCreator(d, activeCreatorFilter, currentMember?.name, creators.get(activeCreatorFilter)),
        )
      : [];
  const dayEvents = visible.filter((e) => occursOn(e, selected));
  const dayDeadlines = visibleDeadlines.filter((d) => d.due_date === selected);
  const monthCount = currentEvents.filter(
    (e) =>
      filter !== "deadline" &&
      (scopeFilter === "all" || (e.visibility ?? "team") === scopeFilter) &&
      e.starts_on.slice(0, 7) <= monthKey && e.ends_on.slice(0, 7) >= monthKey,
  ).length + teamDeadlines.filter(
    (d) =>
      d.due_date.slice(0, 7) === monthKey &&
      (filter !== "deadline" || projectFilter === "all" || d.project_id === projectFilter),
  ).length;
  const today = dateKey(new Date());
  const isLoading = loading || (!error && loadedRange !== range);

  function create(day = selected) {
    if (!currentMember) {
      toast.info(
        "내 팀원을 등록하거나 선택하면 내 이름으로 일정을 남길 수 있어요.",
      );
      onRegister?.();
      return;
    }
    editorOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setConfirmDelete(false);
    setEditor({
      input: {
        title: "",
        visibility: scopeFilter === "private" ? "private" : "team",
        category: filter === "all" || filter === "deadline" ? "work" : filter,
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
    editorOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setConfirmDelete(false);
    const {
      title,
      visibility,
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
        visibility: visibility ?? "team",
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
    if (!editor.original && !currentMember) {
      toast.error("내 팀원을 등록하거나 선택한 뒤 일정을 저장해 주세요.");
      return;
    }
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
          // A fixed-scope calendar never saves outside its scope.
          visibility: fixedScope ?? input.visibility,
          title: input.title.trim(),
          location: input.location?.trim() || null,
          organizer: input.organizer?.trim() || null,
          note: input.note?.trim() || null,
        },
        original,
        currentMember,
      );
      setEvents((prev) => [...prev.filter((e) => e.id !== saved.id), saved]);
      setSelected(saved.starts_on);
      if (saved.starts_on.slice(0, 7) !== monthKey)
        setMonth(new Date(`${saved.starts_on}T12:00:00`));
      setEditor(null);
      toast.success(
        original ? "일정을 수정했습니다." : saved.visibility === "private" ? "내 개인 일정을 등록했습니다." : "팀 일정을 등록했습니다.",
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
              // The undo toast can stay open after the user changes months.
              await reloadCurrentMonth.current();
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
      aria-label={fixedScope ? "내 개인 일정 달력" : "부서 공유 달력"}
    >
      <div className="flex flex-wrap items-center justify-between gap-4 p-5 sm:p-6">
        <div className="flex items-center gap-3">
          <span className="rounded-xl bg-teal-50 p-2.5 text-teal-700">
            <CalendarDays className="size-5" />
          </span>
          <div>
            <h2 className="font-semibold text-slate-900">{fixedScope ? "내 개인 일정" : "부서 공유 달력"}</h2>
            <p className="mt-1 text-xs text-slate-500">
              {fixedScope ? "나에게만 보이는 일정이에요" : "업무부터 회식까지, 누가 등록했는지 한눈에"}
            </p>
          </div>
        </div>
        <Button
          ref={createButton}
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
        {!fixedScope && (
          <button
            type="button"
            aria-pressed={filter === "deadline"}
            onClick={() => setFilter("deadline")}
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs",
              filter === "deadline"
                ? DEADLINE_STYLE.className
                : "border-transparent text-slate-500 hover:bg-slate-50",
            )}
          >
            <span className={cn("size-1.5 rounded-full", DEADLINE_STYLE.dot)} />
            {DEADLINE_STYLE.label}
          </button>
        )}
        {!fixedScope && (
          <CalendarLegend
            projects={projects}
            monthDeadlines={loadedRange === range ? teamDeadlines.filter((d) => d.due_date.slice(0, 7) === monthKey) : []}
            toneMap={toneMap}
            value={filter === "deadline" && projectFilter !== "all" ? projectFilter : null}
            onSelect={(id) => {
              setFilter(id ? "deadline" : "all");
              setProjectFilter(id ?? "all");
            }}
          />
        )}
      </div>
      {deadlines === null && !error && (
        <p role="status" className="px-5 pb-2 text-xs text-amber-700 sm:px-6">
          과업 마감을 불러오지 못했습니다{deadlineError ? ` (${deadlineError})` : ""}. 팀 일정만 표시합니다.
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-3 sm:px-6">
        <div className="flex flex-wrap items-center gap-2">
          {!fixedScope && <div className="flex rounded-lg bg-slate-100 p-0.5" role="group" aria-label="일정 보기 범위">
            {([["team", "팀"], ["all", "통합(+내 개인)"]] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={scopeFilter === key}
                onClick={() => setScopeFilter(key)}
                className={cn("rounded-md px-2.5 py-1 text-xs text-slate-500", scopeFilter === key && "bg-white text-teal-800 shadow-sm")}
              >
                {label}
              </button>
            ))}
          </div>}
          <Label htmlFor="event-creator-filter" className="text-xs text-slate-500">
            등록자
          </Label>
          <select
            id="event-creator-filter"
            className="h-8 max-w-48 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-700"
            value={activeCreatorFilter}
            onChange={(event) => setCreatorFilter(event.target.value)}
          >
            <option value="all">전체 등록자</option>
            <option value="mine" disabled={!currentMember}>
              내 일정{currentMember ? ` · ${currentMember.name}` : ""}
            </option>
            {Array.from(creators).map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
            <option value="unassigned">등록자 미지정</option>
          </select>
          {(filter !== "all" || activeCreatorFilter !== "all" || scopeFilter !== defaultScope) && (
            <button
              type="button"
              className="text-xs text-teal-700 hover:underline"
              onClick={() => {
                setFilter("all");
                setProjectFilter("all");
                setCreatorFilter("all");
                setScopeFilter(defaultScope);
              }}
            >
              필터 초기화
            </button>
          )}
        </div>
        {currentMember ? (
          <span className="flex items-center gap-2 text-xs text-slate-400">
            내 프로필
            <CreatorBadge
              name={currentMember.name}
              color={currentMember.color}
              compact
            />
          </span>
        ) : (
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span>내 설정을 완료하고 내 이름으로 일정을 남겨 보세요.</span>
            {onRegister && (
              <button
                type="button"
                className="font-medium text-teal-700 hover:underline"
                onClick={onRegister}
              >
                내 설정 열기
              </button>
            )}
          </div>
        )}
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
          // Deadlines come first in a cell; three lines are shared between both kinds.
          const due = visibleDeadlines.filter((d) => d.due_date === day);
          const total = items.length + due.length;
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
                {total > 0 && (
                  <span className="pr-1 text-[10px] text-slate-400 sm:hidden">
                    {total}
                  </span>
                )}
              </button>
              <div className="hidden space-y-1 sm:block">
                {due.slice(0, 3).map((deadline) => (
                  <DeadlineChip key={deadline.id} deadline={deadline} tone={toneFor(toneMap, deadline.project_id)} />
                ))}
                {items.slice(0, Math.max(0, 3 - due.length)).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => edit(item)}
                    title={`${EVENT_CATEGORIES[item.category].label} · ${item.title} · 등록자: ${item.creator_name || "미지정"}`}
                    className={cn(
                      "block w-full truncate rounded border-l-2 px-1.5 py-1 text-left text-[11px]",
                      EVENT_CATEGORIES[item.category].className,
                      item.visibility === "private" && "border border-dashed",
                    )}
                    data-visibility={item.visibility ?? "team"}
                  >
                    <span className="block truncate">
                      {item.visibility === "private" && (
                        <Lock className="mr-0.5 inline size-2.5" aria-label="나만 보기" />
                      )}
                      {item.starts_at && (
                        <span className="mr-1 opacity-70">
                          {item.starts_at.slice(0, 5)}
                        </span>
                      )}
                      {item.title}
                    </span>
                    <CreatorBadge
                      name={item.creator_name}
                      color={item.creator_color}
                      compact
                    />
                  </button>
                ))}
                {total > 3 && (
                  <button
                    type="button"
                    onClick={() => setSelected(day)}
                    className="px-1 text-[11px] text-teal-700"
                  >
                    +{total - 3}건 더 보기
                  </button>
                )}
              </div>
              <div className="flex min-h-3 flex-wrap gap-1 px-1 pb-1 sm:hidden">
                {due.slice(0, 5).map((deadline) => (
                  <span
                    key={deadline.id}
                    title={`${DEADLINE_STYLE.label} · ${deadline.project_name} · ${deadline.title}`}
                    className={cn("size-1.5 rounded-full", toneFor(toneMap, deadline.project_id).dot)}
                  />
                ))}
                {items.slice(0, Math.max(0, 5 - due.length)).map((item) => (
                  <span
                    key={item.id}
                    title={`${item.title} · 등록자: ${item.creator_name || "미지정"}`}
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
              {dayEvents.length + dayDeadlines.length}개의 일정
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
        ) : dayEvents.length + dayDeadlines.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 py-7 text-center">
            <CalendarDays className="mx-auto mb-2 size-6 text-slate-300" />
            <p className="text-sm text-slate-500">
              {filter === "deadline"
                ? "이 날짜에 마감인 과업 일정이 없어요."
                : filter === "all" && activeCreatorFilter === "all"
                  ? "아직 등록된 일정이 없어요."
                  : "선택한 유형·등록자의 일정이 없어요."}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              {filter === "deadline"
                ? "과업 일정은 각 과업 안에서 등록합니다."
                : "부서원과 함께할 첫 일정을 남겨 보세요."}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {dayDeadlines.map((deadline) => (
              <DeadlineRow key={deadline.id} deadline={deadline} tone={toneFor(toneMap, deadline.project_id)} />
            ))}
            {dayEvents.map((item) => (
              <button
                type="button"
                key={item.id}
                onClick={() => edit(item)}
                className={cn(
                  "flex w-full items-start gap-3 rounded-xl border border-slate-100 p-3 text-left transition-colors hover:bg-slate-50",
                  item.visibility === "private" && "border-dashed border-slate-300 bg-slate-50/60",
                )}
                data-visibility={item.visibility ?? "team"}
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
                    {item.visibility === "private" && (
                      <span className="mr-1.5 inline-flex items-center gap-0.5 rounded bg-slate-200 px-1.5 py-0.5 align-middle text-[10px] font-normal text-slate-600">
                        <Lock className="size-2.5" />나만 보기
                      </span>
                    )}
                    {item.title}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                    <CreatorBadge
                      name={item.creator_name}
                      color={item.creator_color}
                    />
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
        // Hidden tab closes the portal too; the draft stays in `editor` for the return trip.
        open={active && editor !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setEditor(null);
        }}
      >
        <DialogContent
          className="max-h-[90dvh] overflow-y-auto sm:max-w-lg"
          showCloseButton={!busy}
          finalFocus={() => !active ? false : editorOpener.current?.isConnected && editorOpener.current.checkVisibility() ? editorOpener.current : createButton.current}
        >
          <form onSubmit={submit}>
            <DialogHeader>
              <DialogTitle>
                {editor?.original ? "부서 일정 수정" : "새 부서 일정"}
              </DialogTitle>
              <DialogDescription>
                팀원 모두 함께 보고 수정할 수 있어요. 처음 등록한 사람은 그대로
                표시됩니다.
              </DialogDescription>
            </DialogHeader>
            <fieldset disabled={busy} className="space-y-4 py-5">
              <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
                <CreatorBadge
                  name={
                    editor?.original
                      ? editor.original.creator_name
                      : currentMember?.name
                  }
                  color={
                    editor?.original
                      ? editor.original.creator_color
                      : currentMember?.color
                  }
                />
                <p className="mt-1 text-[11px] text-slate-500">
                  {editor?.original
                    ? "등록자는 담당자·참석자와 별도로 기록됩니다."
                    : "현재 선택한 내 프로필로 등록합니다."}
                </p>
              </div>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">공개 범위</legend>
                <div className="flex rounded-lg bg-slate-100 p-1">
                  {([["team", "팀 일정"], ["private", "나만 보기"]] as const).filter(([key]) => !fixedScope || key === fixedScope).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      aria-pressed={(editor?.input.visibility ?? "team") === key}
                      disabled={Boolean(editor?.original && editor.original.created_by !== currentMember?.id)}
                      onClick={() => patch({ visibility: key })}
                      className={cn("flex flex-1 items-center justify-center gap-1 rounded-md py-1.5 text-sm text-slate-500", (editor?.input.visibility ?? "team") === key && "bg-white text-teal-800 shadow-sm")}
                    >
                      {key === "private" ? <Lock className="size-3.5" /> : <Users className="size-3.5" />}
                      {label}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-slate-500">
                  {(editor?.input.visibility ?? "team") === "private"
                    ? "나에게만 보입니다. 팀을 옮겨도 내 일정으로 남습니다."
                    : "같은 팀원 모두 보고 수정할 수 있습니다."}
                </p>
              </fieldset>
              <div className="space-y-2">
                <Label htmlFor="event-title">일정명</Label>
                <Input
                  id="event-title"
                  autoFocus
                  required
                  maxLength={200}
                  placeholder="예) 제안서 초안 작성, 금요일 팀 회식"
                  value={editor?.input.title ?? ""}
                  onChange={(e) => patch({ title: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="event-category">유형</Label>
                <select
                  id="event-category"
                  className="h-9 w-full rounded-lg border bg-background px-3 text-sm"
                  value={editor?.input.category ?? "work"}
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
                disabled={
                  busy ||
                  !editor?.input.title.trim() ||
                  (!editor?.original && !currentMember)
                }
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
