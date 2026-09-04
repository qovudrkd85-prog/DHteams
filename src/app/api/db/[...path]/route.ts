import { NextResponse, type NextRequest } from "next/server";

import {
  SESSION_COOKIE,
  SUPABASE_SERVER_KEY,
  SUPABASE_SERVER_URL,
  isValidSession,
  secureModeReady,
} from "@/lib/server-auth";

/**
 * Supabase REST 프록시.
 * 브라우저는 Supabase 주소·키를 모르고, 이 서버를 거쳐야만 데이터에 닿는다.
 * 비밀번호 세션 쿠키가 없으면 401.
 */
const PASS_THROUGH_REQUEST = ["content-type", "accept", "prefer", "range", "accept-profile", "content-profile"];
const PASS_THROUGH_RESPONSE = ["content-type", "content-range", "range-unit"];

async function handle(request: NextRequest, path: string[]) {
  if (!secureModeReady) {
    return NextResponse.json({ message: "server proxy is not configured" }, { status: 501 });
  }

  if (!isValidSession(request.cookies.get(SESSION_COOKIE)?.value)) {
    return NextResponse.json({ message: "unauthorized" }, { status: 401 });
  }

  const target = `${SUPABASE_SERVER_URL.replace(/\/$/, "")}/${path.join("/")}${request.nextUrl.search}`;

  const headers = new Headers({
    apikey: SUPABASE_SERVER_KEY,
    authorization: `Bearer ${SUPABASE_SERVER_KEY}`,
  });
  PASS_THROUGH_REQUEST.forEach((name) => {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  });

  const method = request.method;
  const raw = method === "GET" || method === "HEAD" ? "" : await request.text();
  // 본문이 비어 있으면 아예 보내지 않는다 (DELETE 등에서 빈 문자열은 오류를 낸다)
  const body = raw.length > 0 ? raw : undefined;

  const upstream = await fetch(target, { method, headers, body, cache: "no-store" });
  const text = await upstream.text();

  const responseHeaders = new Headers();
  PASS_THROUGH_RESPONSE.forEach((name) => {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  });

  // 204 / 304 응답은 본문을 가질 수 없다
  const emptyBody = upstream.status === 204 || upstream.status === 205 || upstream.status === 304;

  return new NextResponse(emptyBody ? null : text, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

export async function GET(request: NextRequest, ctx: RouteContext<"/api/db/[...path]">) {
  const { path } = await ctx.params;
  return handle(request, path);
}

export async function POST(request: NextRequest, ctx: RouteContext<"/api/db/[...path]">) {
  const { path } = await ctx.params;
  return handle(request, path);
}

export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/db/[...path]">) {
  const { path } = await ctx.params;
  return handle(request, path);
}

export async function PUT(request: NextRequest, ctx: RouteContext<"/api/db/[...path]">) {
  const { path } = await ctx.params;
  return handle(request, path);
}

export async function DELETE(request: NextRequest, ctx: RouteContext<"/api/db/[...path]">) {
  const { path } = await ctx.params;
  return handle(request, path);
}
