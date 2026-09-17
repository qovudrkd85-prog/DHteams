import { NextResponse, type NextRequest } from "next/server";

import { AccountError, accountFailure, createAuthContext, jsonError, requireSameOrigin } from "@/lib/server-auth";

const TABLES = new Set(["projects", "nodes", "file_logs", "schedules", "project_memos", "office_layouts", "department_events", "team_members", "team_attendance", "project_members"]);
const REQUEST_HEADERS = ["content-type", "accept", "prefer", "range", "range-unit", "if-match", "if-none-match"];
const RESPONSE_HEADERS = ["content-type", "content-range", "range-unit", "preference-applied", "etag"];

async function handle(request: NextRequest, path: string[]) {
  const denied = requireSameOrigin(request);
  if (denied) return denied;
  // Never proxy auth, storage, arbitrary RPCs, schemas or user-supplied hosts.
  if (path.length !== 3 || path[0] !== "rest" || path[1] !== "v1" || !TABLES.has(path[2])) return jsonError("지원하지 않는 데이터 요청입니다.", 404);
  for (const header of ["accept-profile", "content-profile"]) {
    if (request.headers.has(header) && request.headers.get(header) !== "public") return jsonError("지원하지 않는 데이터 영역입니다.", 403);
  }
  let auth: ReturnType<typeof createAuthContext> | undefined;
  try {
    auth = createAuthContext(request);
    // Verify with Auth first. The cookie's embedded user is never authorization.
    const { data: userData, error: userError } = await auth.supabase.auth.getUser();
    if (userError || !userData.user) {
      if (userError && (userError.status === 0 || (userError.status ?? 0) >= 500)) throw new AccountError("로그인 서버에 연결하지 못했습니다.", 503);
      auth.clearSessionCookies();
      throw new AccountError("다시 로그인해 주세요.", 401);
    }
    const { data: sessionData, error: sessionError } = await auth.supabase.auth.getSession();
    if (sessionError || !sessionData.session?.access_token) throw new AccountError("다시 로그인해 주세요.", 401);
    const headers = new Headers({ apikey: auth.config.key, authorization: `Bearer ${sessionData.session.access_token}` });
    REQUEST_HEADERS.forEach((name) => {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    });
    const raw = ["GET", "HEAD"].includes(request.method) ? "" : await request.text();
    const upstream = await fetch(`${auth.config.url}/rest/v1/${path[2]}${request.nextUrl.search}`, {
      method: request.method, headers, body: raw || undefined, cache: "no-store", redirect: "error",
    });
    const responseHeaders = new Headers();
    RESPONSE_HEADERS.forEach((name) => {
      const value = upstream.headers.get(name);
      if (value) responseHeaders.set(name, value);
    });
    const empty = request.method === "HEAD" || [204, 205, 304].includes(upstream.status);
    return auth.applyCookies(new NextResponse(empty ? null : await upstream.text(), { status: upstream.status, headers: responseHeaders }));
  } catch (error) {
    const response = accountFailure(error);
    return auth ? auth.applyCookies(response) : response;
  }
}

type Context = RouteContext<"/api/db/[...path]">;
export async function GET(request: NextRequest, context: Context) { return handle(request, (await context.params).path); }
export async function HEAD(request: NextRequest, context: Context) { return handle(request, (await context.params).path); }
export async function POST(request: NextRequest, context: Context) { return handle(request, (await context.params).path); }
export async function PATCH(request: NextRequest, context: Context) { return handle(request, (await context.params).path); }
export async function DELETE(request: NextRequest, context: Context) { return handle(request, (await context.params).path); }
