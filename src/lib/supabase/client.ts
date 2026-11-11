import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";

// Configuration and authentication are checked by /api/session on the server.
export const isSupabaseConfigured = true;
let client: SupabaseClient | undefined;
let screenTeamId: string | null = null;
let lastTeamCheck = 0;

/** The team this screen shows; sent with every data request so a stale screen cannot write into another team. */
export function setScreenTeam(teamId: string | null): void {
  screenTeamId = teamId;
}

export function createClient(): SupabaseClient {
  if (typeof window === "undefined") throw new Error("데이터 클라이언트는 브라우저에서 사용해 주세요.");
  if (!client) {
    client = createSupabaseClient(`${window.location.origin}/api/db`, "proxied", {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: {
        fetch: async (input, init) => {
          const headers = new Headers(init?.headers);
          if (screenTeamId) headers.set("x-teams-team", screenTeamId);
          const response = await fetch(input, { ...init, headers, credentials: "same-origin", cache: "no-store" });
          if (response.status === 401) window.dispatchEvent(new Event("teams:session-expired"));
          // 403 = refused by team rules, usually because another device switched teams: reload the session.
          if (response.status === 403 && Date.now() - lastTeamCheck > 3000) {
            lastTeamCheck = Date.now();
            window.dispatchEvent(new Event("teams:team-check"));
          }
          return response;
        },
      },
    });
  }
  return client;
}
