import { createClient } from "@/lib/supabase/client";

export const MEMBER_COLORS = [
  "#547867", "#5B7FA6", "#C47B55", "#8B70A8",
  "#BD6F83", "#B29345", "#508E96", "#737A86",
];
export const MEMBER_AVATARS = ["🧑‍💻", "👩‍💻", "👨‍💻", "🐻", "🐱", "🐰", "🦊", "🐼", "🐶", "🐥", "🐸", "🦁"];
export const OFFICE_WIDTH = 1000;
export const OFFICE_HEIGHT = 560;

export interface TeamMember {
  id: string;
  user_id?: string | null;
  username?: string | null;
  profile_completed?: boolean;
  name: string;
  role: string;
  avatar: string;
  color: string;
  created_at: string;
}
export interface Attendance {
  id: string;
  member_id: string;
  work_date: string;
  checked_in_at: string;
  checked_out_at: string | null;
}
export interface OfficeItem {
  id: string;
  kind: "desk" | "table" | "plant" | "sofa" | "board";
  x: number;
  y: number;
  rotation: 0 | 90 | 180 | 270;
  label: string;
  member_id: string | null;
}
export interface OfficeLayout {
  id: string;
  name: string;
  theme: "sage" | "sand" | "sky";
  items: OfficeItem[];
  updated_at: string;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const koreanDateFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
});

/** Attendance dates follow Korea even when a teammate's browser uses another timezone. */
export function officeDateKey(date: Date = new Date()): string {
  const parts = koreanDateFormat.formatToParts(date);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function databaseError(error: { code?: string; message: string }): Error {
  if (["PGRST205", "PGRST204", "42P01", "42703"].includes(error.code ?? "")) {
    return new Error("팀 공간 저장소가 아직 준비되지 않았습니다. 관리자에게 팀 공간 초기 설정을 요청해 주세요.");
  }
  if (error.code === "23503") return new Error("등록된 팀원을 찾을 수 없습니다. 새로고침한 뒤 팀원을 다시 선택해 주세요.");
  return new Error(error.message);
}

function trimmedText(value: string, label: string, maximum: number, required = true): string {
  if (typeof value !== "string") throw new Error(`${label}을 확인해 주세요.`);
  const result = value.trim();
  if ((required && result.length === 0) || Array.from(result).length > maximum) {
    throw new Error(`${label}은 ${required ? "1~" : ""}${maximum}자${required ? "로" : " 이내로"} 입력해 주세요.`);
  }
  return result;
}

function validMemberId(id: string): void {
  if (!uuidPattern.test(id)) throw new Error("로그인 계정의 내 설정을 확인해 주세요.");
}

export async function listTeamMembers(): Promise<TeamMember[]> {
  const client = createClient();
  const rows: TeamMember[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await client.from("team_members").select("*")
      .order("created_at").order("id").range(offset, offset + 499);
    if (error) throw databaseError(error);
    rows.push(...(data as TeamMember[]));
    if (data.length < 500) return rows;
  }
}

export async function listAttendance(workDate: string): Promise<Attendance[]> {
  const date = new Date(`${workDate}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== workDate) {
    throw new Error("출퇴근 날짜를 확인해 주세요.");
  }
  const client = createClient();
  const rows: Attendance[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await client.from("team_attendance").select("*")
      .eq("work_date", workDate).order("checked_in_at").order("id").range(offset, offset + 499);
    if (error) throw databaseError(error);
    rows.push(...(data as Attendance[]));
    if (data.length < 500) return rows;
  }
}

export async function checkIn(memberId: string): Promise<Attendance> {
  validMemberId(memberId);
  const client = createClient();
  // The database chooses the date/time and ignores an overlapping check-in atomically.
  // A second attempt also covers midnight passing between the insert and read.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { data, error } = await client.from("team_attendance")
      .upsert({ member_id: memberId }, { onConflict: "member_id,work_date", ignoreDuplicates: true })
      .select().maybeSingle();
    if (error) throw databaseError(error);
    if (data) return data as Attendance;
    const { data: existing, error: readError } = await client.from("team_attendance").select("*")
      .eq("member_id", memberId).eq("work_date", officeDateKey()).maybeSingle();
    if (readError) throw databaseError(readError);
    if (existing?.checked_out_at) throw new Error("오늘은 이미 퇴근을 기록했습니다. 출퇴근 기록은 하루에 한 번 등록할 수 있습니다.");
    if (existing) return existing as Attendance;
  }
  throw new Error("출근 기록의 날짜가 변경되었습니다. 새로고침한 뒤 다시 확인해 주세요.");
}

export async function checkOut(attendance: Attendance): Promise<Attendance> {
  validMemberId(attendance.member_id);
  if (!uuidPattern.test(attendance.id)) throw new Error("출근 기록을 먼저 확인해 주세요.");
  const client = createClient();
  const { data, error } = await client.from("team_attendance")
    .update({ checked_out_at: new Date().toISOString() })
    .eq("id", attendance.id).eq("member_id", attendance.member_id)
    .eq("work_date", attendance.work_date).eq("checked_in_at", attendance.checked_in_at)
    .is("checked_out_at", null).select().maybeSingle();
  if (error) throw databaseError(error);
  if (data) return data as Attendance;
  // Another tab may have completed the same checkout; preserve its original timestamp.
  const { data: existing, error: readError } = await client.from("team_attendance").select("*")
    .eq("id", attendance.id).eq("member_id", attendance.member_id)
    .eq("work_date", attendance.work_date).eq("checked_in_at", attendance.checked_in_at).maybeSingle();
  if (readError) throw databaseError(readError);
  if (existing?.checked_out_at) return existing as Attendance;
  throw new Error("출근 기록이 변경되었거나 삭제되었습니다. 새로고침한 뒤 다시 확인해 주세요.");
}

function layoutPayload(input: Pick<OfficeLayout, "name" | "theme" | "items">) {
  const name = trimmedText(input.name, "배치도 이름", 60);
  if (!["sage", "sand", "sky"].includes(input.theme)) throw new Error("공간 테마를 다시 선택해 주세요.");
  if (!Array.isArray(input.items) || input.items.length > 100) throw new Error("가구는 배치도마다 최대 100개까지 배치할 수 있습니다.");
  const ids = new Set<string>();
  const seatedMembers = new Set<string>();
  const items = input.items.map((item): OfficeItem => {
    const id = trimmedText(item.id, "가구 ID", 80);
    if (ids.has(id)) throw new Error("중복된 가구가 있습니다. 배치도를 다시 확인해 주세요.");
    ids.add(id);
    if (!["desk", "table", "plant", "sofa", "board"].includes(item.kind)
      || ![0, 90, 180, 270].includes(item.rotation)
      || !Number.isFinite(item.x) || !Number.isFinite(item.y)
      || item.x < 0 || item.x > OFFICE_WIDTH || item.y < 0 || item.y > OFFICE_HEIGHT) {
      throw new Error("가구 종류나 위치를 확인해 주세요.");
    }
    if (item.member_id !== null) {
      validMemberId(item.member_id);
      if (item.kind !== "desk") throw new Error("팀원은 책상에만 배정할 수 있습니다.");
      if (seatedMembers.has(item.member_id)) throw new Error("같은 배치도에서 한 팀원은 하나의 책상에만 배정할 수 있습니다.");
      seatedMembers.add(item.member_id);
    }
    return { id, kind: item.kind, x: item.x, y: item.y, rotation: item.rotation,
      label: trimmedText(item.label, "가구 이름", 40, false), member_id: item.member_id };
  });
  return { name, theme: input.theme, items };
}

export async function listOfficeLayouts(): Promise<OfficeLayout[]> {
  const client = createClient();
  const rows: OfficeLayout[] = [];
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await client.from("office_layouts").select("*")
      .order("created_at").order("id").range(offset, offset + 99);
    if (error) throw databaseError(error);
    rows.push(...(data as OfficeLayout[]));
    if (data.length < 100) return rows;
  }
}

export async function saveOfficeLayout(
  input: Pick<OfficeLayout, "name" | "theme" | "items">,
  original?: OfficeLayout,
): Promise<OfficeLayout> {
  const payload = layoutPayload(input);
  const client = createClient();
  const query = original
    ? client.from("office_layouts").update(payload).eq("id", original.id).eq("updated_at", original.updated_at)
    : client.from("office_layouts").insert(payload);
  const { data, error } = await query.select().maybeSingle();
  if (error) throw databaseError(error);
  if (!data) throw new Error("다른 팀원이 이 배치도를 변경했습니다. 새로고침한 뒤 변경 내용을 확인해 주세요.");
  return data as OfficeLayout;
}

export async function deleteOfficeLayout(original: OfficeLayout): Promise<void> {
  const { data, error } = await createClient().from("office_layouts").delete()
    .eq("id", original.id).eq("updated_at", original.updated_at).select("id").maybeSingle();
  if (error) throw databaseError(error);
  if (!data) throw new Error("다른 팀원이 이 배치도를 변경했거나 삭제했습니다. 새로고침한 뒤 다시 확인해 주세요.");
}
