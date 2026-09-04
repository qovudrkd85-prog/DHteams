import { NextResponse } from "next/server";

import { SESSION_COOKIE, isValidPassword, secureModeReady, sessionToken } from "@/lib/server-auth";

const THIRTY_DAYS = 60 * 60 * 24 * 30;

/** 비밀번호 확인 후 서버 세션 쿠키 발급 */
export async function POST(request: Request) {
  if (!secureModeReady) {
    return NextResponse.json({ ok: false, reason: "not-configured" }, { status: 501 });
  }

  let password = "";
  try {
    const body = (await request.json()) as { password?: unknown };
    password = typeof body.password === "string" ? body.password : "";
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  if (!password || !isValidPassword(password)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, sessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: THIRTY_DAYS,
  });
  return response;
}

/** 서버 차단 모드 사용 가능 여부 + 로그인 상태 */
export async function GET(request: Request) {
  const cookie = request.headers.get("cookie") ?? "";
  const { isValidSession } = await import("@/lib/server-auth");
  const value = cookie
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${SESSION_COOKIE}=`))
    ?.split("=")[1];

  return NextResponse.json({ secureMode: secureModeReady, authenticated: isValidSession(value) });
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return response;
}
