import { NextResponse, type NextRequest } from "next/server";

import { normalizeUsername, usernameEmail, validateUsername, validatePassword } from "@/lib/account/types";
import { AccountError, ACCOUNT_COOKIE, SESSION_COOKIE, accountFailure, createAuthContext, getServerConfig, noStore, readJson, requireSameOrigin, sessionPayload } from "@/lib/server-auth";

export async function GET(request: NextRequest) {
  if (!getServerConfig()) return noStore(NextResponse.json(sessionPayload(null, "서버 계정 설정이 필요합니다.")));
  const auth = createAuthContext(request);
  try {
    return auth.applyCookies(NextResponse.json(sessionPayload(await auth.getAccount())));
  } catch (error) {
    const status = error instanceof AccountError && error.status === 401 ? 200 : 503;
    return auth.applyCookies(NextResponse.json(sessionPayload(null, status === 200 ? undefined : error instanceof AccountError ? error.message : "로그인 서버에 연결하지 못했습니다."), { status }));
  }
}

export async function POST(request: NextRequest) {
  const denied = requireSameOrigin(request);
  if (denied) return denied;
  let auth: ReturnType<typeof createAuthContext> | undefined;
  try {
    const body = await readJson(request);
    const username = normalizeUsername(body.username);
    const validation = validateUsername(username) ?? validatePassword(body.password);
    if (validation) throw new AccountError(validation);
    auth = createAuthContext(request);
    const { error } = await auth.supabase.auth.signInWithPassword({ email: usernameEmail(username), password: body.password as string });
    if (error) {
      const busy = error.status === 429;
      const unavailable = error.status === 0 || (error.status ?? 0) >= 500;
      throw new AccountError(busy ? "로그인 시도가 많습니다. 잠시 후 다시 시도해 주세요." : unavailable ? "로그인 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요." : "아이디 또는 비밀번호를 확인해 주세요.", busy ? 429 : unavailable ? 503 : 401);
    }
    return auth.applyCookies(NextResponse.json(sessionPayload(await auth.getAccount())));
  } catch (error) {
    const response = accountFailure(error);
    return auth ? auth.applyCookies(response) : response;
  }
}

export async function DELETE(request: NextRequest) {
  const denied = requireSameOrigin(request);
  if (denied) return denied;
  if (!getServerConfig()) {
    const response = noStore(NextResponse.json({ ok: true }));
    request.cookies.getAll().forEach(({ name }) => {
      if (name === SESSION_COOKIE || name === ACCOUNT_COOKIE || name.startsWith(`${ACCOUNT_COOKIE}.`)) response.cookies.set(name, "", { path: "/", maxAge: 0 });
    });
    return response;
  }
  const auth = createAuthContext(request);
  try { await auth.supabase.auth.signOut({ scope: "local" }); }
  catch { /* Always remove browser cookies, even if Auth is unavailable. */ }
  finally { auth.clearSessionCookies(); }
  return auth.applyCookies(NextResponse.json({ ok: true }));
}
