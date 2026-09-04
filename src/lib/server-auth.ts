import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "teams_sid";

/** 서버에만 두는 값들 — NEXT_PUBLIC_ 접두사를 붙이지 않는다 */
const TEAM_PASSWORD = process.env.TEAM_PASSWORD ?? "";
const SESSION_SECRET = process.env.SESSION_SECRET ?? "";

export const SUPABASE_SERVER_URL =
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_SERVER_KEY = process.env.SUPABASE_KEY ?? "";

/** 서버 차단 모드가 켜져 있는지 (필요한 값이 모두 있을 때만) */
export const secureModeReady = Boolean(
  TEAM_PASSWORD && SESSION_SECRET && SUPABASE_SERVER_URL && SUPABASE_SERVER_KEY,
);

export function sessionToken(): string {
  return createHmac("sha256", SESSION_SECRET).update("teams-session-v1").digest("hex");
}

export function isValidPassword(input: string): boolean {
  const a = createHash("sha256").update(input).digest();
  const b = createHash("sha256").update(TEAM_PASSWORD).digest();
  return timingSafeEqual(a, b);
}

export function isValidSession(cookieValue: string | undefined): boolean {
  if (!cookieValue) return false;
  const expected = sessionToken();
  if (cookieValue.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(cookieValue), Buffer.from(expected));
}
