/* eslint-disable @typescript-eslint/no-require-imports -- Read-only deployment readiness checks. */
const path = require("node:path");
const fs = require("node:fs");
const root = path.resolve(__dirname, "..");
const envFile = path.join(root, ".env.local");
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
const baseURL = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

(async () => {
  let publicKey = key.startsWith("sb_publishable_");
  try { publicKey ||= JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString()).role === "anon"; } catch { /* Publishable key or invalid legacy key. */ }
  if (!baseURL || !publicKey) throw new Error("Supabase URL and a publishable/anon key are required.");
  const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  const request = async (endpoint, method = "GET") => {
    const response = await fetch(`${baseURL}${endpoint}`, { method, headers, ...(method === "POST" ? { body: "{}" } : {}), redirect: "error", signal: AbortSignal.timeout(15000) });
    return { status: response.status, data: await response.json() };
  };
  const [rpc, settings, ...tables] = await Promise.all([
    request("/rest/v1/rpc/account_registration_ready", "POST"),
    request("/auth/v1/settings"),
    ...["team_members", "team_attendance", "office_layouts", "projects", "department_events"].map((name) => request(`/rest/v1/${name}?select=id&limit=0`)),
  ]);
  const result = {
    accountMigrationReady: rpc.status === 200 && rpc.data === true,
    emailProviderEnabled: settings.status === 200 && settings.data.external?.email === true,
    signupEnabled: settings.status === 200 && settings.data.disable_signup === false,
    emailConfirmationDisabled: settings.status === 200 && settings.data.mailer_autoconfirm === true,
    anonymousDataAccessBlocked: tables.every(({ status, data }) => [401, 403].includes(status) && data.code === "42501"),
  };
  console.log(JSON.stringify(result, null, 2));
  if (!Object.values(result).every(Boolean)) process.exitCode = 1;
})().catch(() => { console.error("Unable to verify Supabase readiness. Check the local configuration and network."); process.exitCode = 1; });
