import { createBrowserClient } from "@supabase/ssr";

// Vercel 환경변수 누락 대비 기본값 (브라우저에 노출되는 공개 값)
const FALLBACK_URL = "https://yquxrohbiplkrtupkndo.supabase.co";

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || FALLBACK_URL;
export const SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);

export function createClient() {
  if (!isSupabaseConfigured) {
    throw new Error(
      "Supabase 환경변수가 없습니다. .env.local 에 NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY 를 설정하세요.",
    );
  }
  return createBrowserClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
}
