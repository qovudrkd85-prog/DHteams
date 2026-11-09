import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import type { AccountIdentity, ProfileInput, SessionPayload, TeamSpace } from "@/lib/account/types";
import type { TeamMember } from "@/lib/team/workspace";

export const SESSION_COOKIE = "teams_sid";
export const ACCOUNT_COOKIE = "teams_account";

export class AccountError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

/** Never accepts a service-role/secret key, including on the server. */
export function getServerConfig(): { url: string; key: string } | null {
  const url = (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim().replace(/\/$/, "");
  const key = (process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY ?? process.env.SUPABASE_KEY
    ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();
  if (!url || !key) return null;
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) return null;
    if (!key.startsWith("sb_publishable_")) {
      const parts = key.split(".");
      if (parts.length !== 3 || JSON.parse(Buffer.from(parts[1], "base64url").toString()).role !== "anon") return null;
    }
    return { url, key };
  } catch { return null; }
}

export function noStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "private, no-store, no-cache, max-age=0, must-revalidate");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
  response.headers.set("Vary", "Cookie");
  return response;
}

export function jsonError(message: string, status: number): NextResponse {
  return noStore(NextResponse.json({ error: message, message }, { status }));
}

export function requireSameOrigin(request: Request): NextResponse | null {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return null;
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  // NextURL rewrites loopback addresses to localhost. Keep the actual Host
  // supplied by the browser so IP access and reverse-proxied domains still work.
  const expected = new URL(request.url);
  const host = request.headers.get("host");
  if (host) expected.host = host;
  if (site === "cross-site" || (origin ? origin !== expected.origin : site !== "same-origin")) {
    return jsonError("이 사이트에서 다시 요청해 주세요.", 403);
  }
  return null;
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new AccountError("JSON 형식으로 요청해 주세요.", 415);
  if (Number(request.headers.get("content-length")) > 16_384) throw new AccountError("입력 내용이 너무 깁니다.", 413);
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > 16_384) throw new AccountError("입력 내용이 너무 깁니다.", 413);
  try {
    const body: unknown = JSON.parse(raw);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return body as Record<string, unknown>;
  } catch { throw new AccountError("입력 내용을 확인해 주세요."); }
}

export function sessionPayload(account: AccountIdentity | null, error?: string): SessionPayload {
  return { configured: Boolean(getServerConfig()), authenticated: Boolean(account), account, ...(error ? { error } : {}) };
}

export function validateProfileInput(input: Record<string, unknown>): ProfileInput {
  const text = (field: string, label: string, max: number) => {
    const value = typeof input[field] === "string" ? input[field].trim() : "";
    if (!value || Array.from(value).length > max) throw new AccountError(`${label}을(를) 1~${max}자로 입력해 주세요.`);
    return value;
  };
  const profile = { name: text("name", "이름", 40), role: text("role", "직책", 60), avatar: text("avatar", "캐릭터", 16), color: typeof input.color === "string" ? input.color : "" };
  if (!/^#[0-9a-f]{6}$/i.test(profile.color)) throw new AccountError("프로필 색상을 다시 선택해 주세요.");
  return profile;
}

/** Refreshes are copied onto every response, including errors. */
export function createAuthContext(request: NextRequest) {
  const config = getServerConfig();
  if (!config) throw new AccountError("서버에 Supabase 주소와 publishable 또는 anon 키를 설정해 주세요.", 503);
  const cookies = new Map(request.cookies.getAll().map(({ name, value }) => [name, value]));
  const changed = new Map<string, { value: string; options: CookieOptions }>();
  const cookieOptions: CookieOptions = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/" };
  const supabase = createServerClient(config.url, config.key, {
    cookieOptions: { name: ACCOUNT_COOKIE, ...cookieOptions },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }) },
    cookies: {
      getAll: () => Array.from(cookies, ([name, value]) => ({ name, value })),
      setAll(values) {
        for (const { name, value, options } of values) {
          cookies.set(name, value);
          // Remove Supabase's persistent expiry. Max-Age is only used to delete.
          changed.set(name, { value, options: { ...cookieOptions, ...(options.maxAge === 0 || !value ? { maxAge: 0 } : {}) } });
        }
      },
    },
  });
  const clearSessionCookies = () => {
    for (const name of new Set([...cookies.keys(), ...changed.keys(), ACCOUNT_COOKIE, SESSION_COOKIE])) {
      if (name === SESSION_COOKIE || name === ACCOUNT_COOKIE || name.startsWith(`${ACCOUNT_COOKIE}.`) || name.startsWith(`${ACCOUNT_COOKIE}-`)) {
        changed.set(name, { value: "", options: { ...cookieOptions, maxAge: 0 } });
      }
    }
  };
  const applyCookies = (response: NextResponse) => {
    changed.forEach(({ value, options }, name) => response.cookies.set(name, value, options));
    response.cookies.set(SESSION_COOKIE, "", { ...cookieOptions, maxAge: 0 });
    return noStore(response);
  };
  const getAccount = async (): Promise<AccountIdentity> => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      if (error && (error.status === 0 || (error.status ?? 0) >= 500)) throw new AccountError("로그인 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.", 503);
      clearSessionCookies();
      throw new AccountError("로그인이 만료되었습니다. 다시 로그인해 주세요.", 401);
    }
    const { data: member, error: profileError } = await supabase.from("team_members").select("id,user_id,username,name,role,avatar,color,status_message,profile_completed,created_at,team_id").eq("user_id", data.user.id).maybeSingle();
    if (profileError || !member?.username) throw new AccountError("계정 프로필을 불러오지 못했습니다. 계정·팀 SQL 설치 상태를 확인해 주세요.", 503);
    let team: TeamSpace | null = null;
    if (member.team_id) {
      const { data: row, error: teamError } = await supabase.from("teams").select("id,name,invite_code,created_by").eq("id", member.team_id).maybeSingle();
      if (teamError) throw new AccountError("팀 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.", 503);
      if (row) {
        const isOwner = row.created_by === member.id;
        let canRotate = isOwner;
        if (!isOwner) {
          // Mirrors regenerate_team_code(): anyone may rotate once the creator has left the team.
          const { data: creator, error: creatorError } = row.created_by
            ? await supabase.from("team_members").select("id").eq("id", row.created_by).eq("team_id", row.id).maybeSingle()
            : { data: null, error: null };
          if (creatorError) throw new AccountError("팀 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.", 503);
          canRotate = !creator;
        }
        team = { id: row.id, name: row.name, invite_code: row.invite_code, is_owner: isOwner, can_rotate_code: canRotate };
      }
    }
    return { id: data.user.id, username: member.username, member: member as TeamMember, team };
  };
  return { supabase, config, getAccount, applyCookies, clearSessionCookies };
}

export function accountFailure(error: unknown): NextResponse {
  return error instanceof AccountError ? jsonError(error.message, error.status) : jsonError("서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.", 503);
}
