import { NextResponse, type NextRequest } from "next/server";

import { AccountError, accountFailure, createAuthContext, readJson, requireSameOrigin, validateProfileInput } from "@/lib/server-auth";
import type { TeamMember } from "@/lib/team/workspace";

export async function PATCH(request: NextRequest) {
  const denied = requireSameOrigin(request);
  if (denied) return denied;
  let auth: ReturnType<typeof createAuthContext> | undefined;
  try {
    auth = createAuthContext(request);
    const account = await auth.getAccount();
    const profile = validateProfileInput(await readJson(request));
    const { data: member, error } = await auth.supabase.from("team_members")
      .update({ ...profile, profile_completed: true }).eq("user_id", account.id)
      .select("id,user_id,username,name,role,avatar,color,status_message,profile_completed,created_at").single();
    if (error || !member) throw new AccountError("프로필을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.", 503);
    return auth.applyCookies(NextResponse.json({ account: { ...account, member: member as TeamMember } }));
  } catch (error) {
    const response = accountFailure(error);
    return auth ? auth.applyCookies(response) : response;
  }
}
