import { createClient } from "@/lib/supabase/client";

export const EVENT_CATEGORIES = {
  meeting: {
    label: "회의",
    className: "bg-blue-50 text-blue-800 border-blue-200",
    dot: "bg-blue-500",
  },
  dinner: {
    label: "회식",
    className: "bg-orange-50 text-orange-800 border-orange-200",
    dot: "bg-orange-500",
  },
  leave: {
    label: "휴가",
    className: "bg-emerald-50 text-emerald-800 border-emerald-200",
    dot: "bg-emerald-500",
  },
  visit: {
    label: "외근·출장",
    className: "bg-violet-50 text-violet-800 border-violet-200",
    dot: "bg-violet-500",
  },
  other: {
    label: "기타",
    className: "bg-slate-100 text-slate-700 border-slate-200",
    dot: "bg-slate-500",
  },
} as const;
export type EventCategory = keyof typeof EVENT_CATEGORIES;
export interface DepartmentEventInput {
  title: string;
  category: EventCategory;
  starts_on: string;
  ends_on: string;
  starts_at: string | null;
  location: string | null;
  organizer: string | null;
  note: string | null;
}
export interface DepartmentEvent extends DepartmentEventInput {
  id: string;
  updated_at: string;
  deleted_at: string | null;
}

export function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function monthCells(month: Date): Date[] {
  const start = new Date(month.getFullYear(), month.getMonth(), 1);
  start.setDate(start.getDate() - start.getDay());
  return Array.from(
    { length: 42 },
    (_, i) =>
      new Date(start.getFullYear(), start.getMonth(), start.getDate() + i),
  );
}
export function occursOn(event: DepartmentEventInput, day: string): boolean {
  return event.starts_on <= day && event.ends_on >= day;
}

function databaseError(error: { code?: string; message: string }): Error {
  if (["PGRST205", "42P01"].includes(error.code ?? "")) {
    return new Error(
      "부서 일정 저장소가 아직 준비되지 않았습니다. 관리자에게 초기 설정을 요청해 주세요.",
    );
  }
  return new Error(error.message);
}

export async function listDepartmentEvents(
  start: string,
  end: string,
): Promise<DepartmentEvent[]> {
  const client = createClient();
  const rows: DepartmentEvent[] = [];
  // PostgREST의 기본 행 제한을 넘는 경우에도 기간 내 일정을 모두 가져옵니다.
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await client
      .from("department_events")
      .select("*")
      .is("deleted_at", null)
      .lte("starts_on", end)
      .gte("ends_on", start)
      .order("starts_on")
      .order("starts_at", { nullsFirst: true })
      .order("id")
      .range(offset, offset + 499);
    if (error) throw databaseError(error);
    rows.push(...(data as DepartmentEvent[]));
    if (data.length < 500) return rows;
  }
}

export async function saveDepartmentEvent(
  input: DepartmentEventInput,
  original?: DepartmentEvent,
): Promise<DepartmentEvent> {
  const client = createClient();
  const query = original
    ? client
        .from("department_events")
        .update(input)
        .eq("id", original.id)
        .eq("updated_at", original.updated_at)
        .is("deleted_at", null)
    : client.from("department_events").insert(input);
  const { data, error } = await query.select().maybeSingle();
  if (error) throw databaseError(error);
  if (!data)
    throw new Error(
      "다른 부서원이 이 일정을 변경했습니다. 창을 닫고 새로고침한 뒤 다시 수정해 주세요.",
    );
  return data as DepartmentEvent;
}

export async function setDepartmentEventDeleted(
  event: DepartmentEvent,
  deleted: boolean,
): Promise<DepartmentEvent> {
  const { data, error } = await createClient()
    .from("department_events")
    .update({ deleted_at: deleted ? new Date().toISOString() : null })
    .eq("id", event.id)
    .eq("updated_at", event.updated_at)
    .select()
    .maybeSingle();
  if (error) throw databaseError(error);
  if (!data)
    throw new Error(
      "다른 부서원이 이 일정을 변경했습니다. 새로고침 후 다시 시도해 주세요.",
    );
  return data as DepartmentEvent;
}
