import { NextResponse, type NextRequest } from "next/server";

import { AccountError, accountFailure, createAuthContext, readJson, requireSameOrigin, sessionPayload } from "@/lib/server-auth";

type TeamAction = "create" | "join" | "leave" | "regenerate";
const actions: readonly TeamAction[] = ["create", "join", "leave", "regenerate"];

function readAction(value: unknown): TeamAction {
  if (typeof value === "string" && (actions as readonly string[]).includes(value)) return value as TeamAction;
  throw new AccountError("요청을 확인해 주세요.");
}

function readName(value: unknown): string {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name || Array.from(name).length > 40) throw new AccountError("팀 이름은 1~40자로 입력해 주세요.");
  return name;
}

function readCode(value: unknown): string {
  const code = typeof value === "string" ? value.replace(/[\s-]/g, "").toUpperCase() : "";
  if (!/^[A-HJKMNP-Z2-9]{8}$/.test(code)) throw new AccountError("초대코드 8자리를 확인해 주세요.");
  return code;
}

export async function POST(request: NextRequest) {
  const denied = requireSameOrigin(request);
  if (denied) return denied;
  let auth: ReturnType<typeof createAuthContext> | undefined;
  try {
    auth = createAuthContext(request);
    await auth.getAccount();
    const body = await readJson(request);
    const action = readAction(body.action);
    const call =
      action === "create" ? auth.supabase.rpc("create_team", { p_name: readName(body.name) })
        : action === "join" ? auth.supabase.rpc("join_team", { p_code: readCode(body.code) })
          : action === "leave" ? auth.supabase.rpc("leave_team")
            : auth.supabase.rpc("regenerate_team_code");
    const { error } = await call;
    if (error) {
      if (["PGRST202", "42883", "42703", "42P01"].includes(error.code)) {
        throw new AccountError("팀 저장소가 준비되지 않았습니다. 관리자에게 팀 SQL 설치를 요청해 주세요.", 503);
      }
      const status = error.code === "42501" ? 403 : error.code === "P0002" ? 404 : ["22023", "23514"].includes(error.code) ? 400 : 503;
      throw new AccountError(status === 503 ? "팀 정보를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요." : error.message, status);
    }
    return auth.applyCookies(NextResponse.json(sessionPayload(await auth.getAccount())));
  } catch (error) {
    const response = accountFailure(error);
    return auth ? auth.applyCookies(response) : response;
  }
}
