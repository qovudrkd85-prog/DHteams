import { createBrowserClient } from "@supabase/ssr";

// Vercel 환경변수 누락 대비 기본값 (브라우저에 노출되는 공개 값)
const FALLBACK_URL = "https://yquxrohbiplkrtupkndo.supabase.co";

/**
 * 서버 차단 모드: 브라우저가 Supabase 대신 우리 서버(/api/db)로만 요청한다.
 * Supabase 주소·키는 서버에만 두고 브라우저 코드에는 넣지 않는다.
 */
export const SECURE_MODE = process.env.NEXT_PUBLIC_SECURE_MODE === "1";

export const SUPABASE_URL = SECURE_MODE
  ? "/api/db"
  : process.env.NEXT_PUBLIC_SUPABASE_URL || FALLBACK_URL;

export const SUPABASE_PUBLISHABLE_KEY = SECURE_MODE
  ? "proxied"
  : (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "");

export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);

export function createClient() {
  if (!isSupabaseConfigured) {
    throw new Error(
      "Supabase 환경변수가 없습니다. .env.local 에 NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY 를 설정하세요.",
    );
  }

  const url =
    SECURE_MODE && typeof window !== "undefined"
      ? `${window.location.origin}/api/db`
      : SUPABASE_URL;

  return createBrowserClient(url, SUPABASE_PUBLISHABLE_KEY);
}
