import { createClient } from "@/lib/supabase/client";
import type { OfficeLayout, TeamPresence } from "./workspace";

function presenceError(error: { code?: string; message: string }) {
  return new Error(["PGRST205", "PGRST204", "42P01", "42703"].includes(error.code ?? "")
    ? "공간 이동 저장소가 아직 준비되지 않았습니다. 관리자에게 사무실 업데이트를 요청해 주세요."
    : error.message);
}

export async function listTeamPresence(): Promise<TeamPresence[]> {
  const { data, error } = await createClient().from("team_presence").select("*").order("member_id");
  if (error) throw presenceError(error);
  return data as TeamPresence[];
}

export async function saveTeamPresence(input: TeamPresence): Promise<TeamPresence> {
  const { member_id, layout_id, x, y, facing, motion } = input;
  const client = createClient();
  for (let attempt = 0; ; attempt++) {
    const { data, error } = await client.from("team_presence")
      .upsert({ member_id, layout_id, x: Math.round(x), y: Math.round(y), facing, motion }, { onConflict: "member_id" }).select().single();
    if (!error) return data as TeamPresence;
    // A seat/furniture update may briefly own the room lock. Retry the entire
    // failed transaction so the database checks its latest bounds and seat.
    if (!["55P03", "40P01", "40001"].includes(error.code ?? "") || attempt >= 2) throw presenceError(error);
    await new Promise((resolve) => setTimeout(resolve, 80 * (attempt + 1)));
  }
}

export async function claimOfficeSeat(layoutId: string, itemId: string | null): Promise<OfficeLayout> {
  const response = await fetch("/api/office/seat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ layoutId, itemId }), cache: "no-store" });
  if (response.status === 401) window.dispatchEvent(new Event("teams:session-expired"));
  const data = await response.json() as { layout?: OfficeLayout; error?: string };
  if (!response.ok || !data.layout) throw new Error(data.error || "자리를 선택하지 못했습니다. 다시 확인해 주세요.");
  return data.layout;
}
