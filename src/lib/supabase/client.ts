import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";

// Configuration and authentication are checked by /api/session on the server.
export const isSupabaseConfigured = true;
let client: SupabaseClient | undefined;

export function createClient(): SupabaseClient {
  if (typeof window === "undefined") throw new Error("데이터 클라이언트는 브라우저에서 사용해 주세요.");
  if (!client) {
    client = createSupabaseClient(`${window.location.origin}/api/db`, "proxied", {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: {
        fetch: async (input, init) => {
          const response = await fetch(input, { ...init, credentials: "same-origin", cache: "no-store" });
          if (response.status === 401) window.dispatchEvent(new Event("teams:session-expired"));
          return response;
        },
      },
    });
  }
  return client;
}
