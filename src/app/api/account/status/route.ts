import { NextResponse, type NextRequest } from "next/server";

import { AccountError, accountFailure, createAuthContext, readJson, requireSameOrigin } from "@/lib/server-auth";

export async function PATCH(request: NextRequest) {
  const denied = requireSameOrigin(request);
  if (denied) return denied;
  let auth: ReturnType<typeof createAuthContext> | undefined;
  try {
    auth = createAuthContext(request);
    const account = await auth.getAccount();
    const body = await readJson(request);
    if (typeof body.statusMessage !== "string") throw new AccountError("상태 메시지를 입력해 주세요.");
    const statusMessage = body.statusMessage.trim();
    if (Array.from(statusMessage).length > 60) throw new AccountError("상태 메시지는 60자 이내로 입력해 주세요.");
    const { data: member, error } = await auth.supabase.from("team_members")
      .update({ status_message: statusMessage }).eq("user_id", account.id)
      .select("id,user_id,username,name,role,avatar,color,profile_completed,status_message,created_at").single();
    if (error || !member) {
      if (error && ["PGRST204", "42703"].includes(error.code)) throw new AccountError("상태 메시지 저장소가 준비되지 않았습니다. 관리자에게 사무실 업데이트를 요청해 주세요.", 503);
      throw new AccountError("상태 메시지를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.", 503);
    }
    return auth.applyCookies(NextResponse.json({ member }));
  } catch (error) {
    const response = accountFailure(error);
    return auth ? auth.applyCookies(response) : response;
  }
}
