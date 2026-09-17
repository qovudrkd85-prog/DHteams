import { NextResponse, type NextRequest } from "next/server";

import { AccountError, accountFailure, createAuthContext, readJson, requireSameOrigin } from "@/lib/server-auth";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  const denied = requireSameOrigin(request);
  if (denied) return denied;
  let auth: ReturnType<typeof createAuthContext> | undefined;
  try {
    auth = createAuthContext(request);
    await auth.getAccount();
    const body = await readJson(request);
    if (typeof body.layoutId !== "string" || !uuidPattern.test(body.layoutId)) throw new AccountError("배치도를 다시 선택해 주세요.");
    if (body.itemId !== null && (typeof body.itemId !== "string" || !body.itemId.trim() || Array.from(body.itemId).length > 80)) {
      throw new AccountError("선택할 책상을 확인해 주세요.");
    }
    const { data: layout, error } = await auth.supabase.rpc("claim_office_seat", { p_layout_id: body.layoutId, p_item_id: body.itemId }).single();
    if (error) {
      if (["PGRST202", "42883", "42703"].includes(error.code)) throw new AccountError("자리 선택 저장소가 준비되지 않았습니다. 관리자에게 사무실 업데이트를 요청해 주세요.", 503);
      const status = error.code === "23505" ? 409 : error.code === "42501" ? 403 : error.code === "P0002" ? 404 : ["22023", "23514"].includes(error.code) ? 400 : 503;
      throw new AccountError(status === 503 ? "자리 선택을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요." : error.message, status);
    }
    if (!layout) throw new AccountError("자리 선택 결과를 확인하지 못했습니다. 새로고침해 주세요.", 503);
    return auth.applyCookies(NextResponse.json({ layout }));
  } catch (error) {
    const response = accountFailure(error);
    return auth ? auth.applyCookies(response) : response;
  }
}
