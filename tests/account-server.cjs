/* eslint-disable @typescript-eslint/no-require-imports -- Actual Next route integration with a loopback-only Auth fixture. */
// Run npm run build first. No .env values or real Supabase services are used.
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { createHmac, randomUUID } = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const password = "Integrationpass123!";
const sessionSecret = "integration-session-secret-isolated-tests-only-64-characters-123456";
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return server.address().port;
}

async function freePort() {
  const server = http.createServer();
  const port = await listen(server);
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function fakeSupabase() {
  const state = { calls: [], accounts: new Map(), tokens: new Map(), refreshTokens: new Map(), ready: true, confirmEmail: false };
  const addAccount = (username) => {
    const id = randomUUID();
    const email = `${username}@members.dhteams.invalid`;
    const timestamp = new Date().toISOString();
    const user = { id, aud: "authenticated", role: "authenticated", email, email_confirmed_at: timestamp, confirmed_at: timestamp, created_at: timestamp, updated_at: timestamp, app_metadata: { provider: "email", providers: ["email"] }, user_metadata: { username }, identities: [{ id, user_id: id, identity_id: randomUUID(), provider: "email", identity_data: { email, sub: id } }] };
    const member = { id: randomUUID(), user_id: id, username, name: username, role: "", avatar: "🧑‍💻", color: "#547867", profile_completed: false, created_at: timestamp };
    const account = { user, member, password };
    state.accounts.set(email, account);
    return account;
  };
  const issueSession = (account) => {
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const token = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: account.user.id, aud: "authenticated", role: "authenticated", exp: expiresAt, iat: expiresAt - 3600, jti: randomUUID() })}.local-test-signature`;
    const refreshToken = randomUUID();
    state.tokens.set(token, account);
    state.refreshTokens.set(refreshToken, account);
    return { access_token: token, refresh_token: refreshToken, expires_in: 3600, expires_at: expiresAt, token_type: "bearer", user: account.user };
  };
  const server = http.createServer(async (request, response) => {
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const raw = Buffer.concat(chunks).toString("utf8");
      const body = raw ? JSON.parse(raw) : null;
      const url = new URL(request.url, "http://localhost");
      const token = String(request.headers.authorization || "").replace(/^Bearer /i, "");
      const account = state.tokens.get(token);
      state.calls.push({ method: request.method, path: url.pathname, search: url.search, headers: { ...request.headers }, body });
      const send = (status, payload) => {
        response.writeHead(status, { "Content-Type": "application/json", "X-Supabase-Api-Version": "2024-01-01" });
        response.end(status === 204 ? undefined : JSON.stringify(payload));
      };
      if (url.pathname === "/auth/v1/settings") return send(200, { external: { email: true, phone: false }, disable_signup: false, mailer_autoconfirm: !state.confirmEmail, phone_autoconfirm: false, sms_provider: "" });
      if (url.pathname === "/rest/v1/rpc/account_registration_ready") return state.ready ? send(200, true) : send(404, { code: "PGRST202", message: "Function not found" });
      if (url.pathname === "/auth/v1/signup") {
        if (state.accounts.has(body.email)) return send(422, { code: "user_already_exists", msg: "User already registered" });
        const created = addAccount(body.data.username);
        assert.equal(body.email, created.user.email);
        created.password = body.password;
        return send(200, issueSession(created));
      }
      if (url.pathname === "/auth/v1/token") {
        const existing = url.searchParams.get("grant_type") === "refresh_token" ? state.refreshTokens.get(body.refresh_token) : state.accounts.get(body.email);
        if (!existing || (url.searchParams.get("grant_type") !== "refresh_token" && existing.password !== body.password)) return send(400, { code: "invalid_credentials", msg: "Invalid login credentials" });
        return send(200, issueSession(existing));
      }
      if (url.pathname === "/auth/v1/user") {
        if (!account) return send(401, { code: "bad_jwt", msg: "Invalid JWT" });
        if (request.method === "PUT" && body.password) account.password = body.password;
        return send(200, account.user);
      }
      if (url.pathname === "/auth/v1/logout") {
        state.tokens.delete(token);
        return send(204);
      }
      if (url.pathname === "/rest/v1/team_members") {
        if (!account) return send(401, { message: "Missing authenticated user token" });
        let members = [...state.accounts.values()].map((candidate) => candidate.member);
        for (const key of ["user_id", "id", "username"]) {
          const filter = url.searchParams.get(key);
          if (filter?.startsWith("eq.")) members = members.filter((member) => member[key] === filter.slice(3));
        }
        if (request.method === "PATCH") {
          members = members.filter((member) => member.user_id === account.user.id);
          for (const member of members) Object.assign(member, body);
        }
        if (String(request.headers.accept).includes("application/vnd.pgrst.object+json")) return members.length === 1 ? send(200, members[0]) : send(406, { code: "PGRST116", message: "No row" });
        return send(200, members);
      }
      if (url.pathname === "/rest/v1/projects") {
        if (!account) return send(401, { message: "Missing authenticated user token" });
        return send(200, [{ id: "shared-project", name: "공유 과업" }]);
      }
      return send(404, { message: `Unexpected test upstream: ${request.method} ${url.pathname}` });
    } catch (error) {
      response.writeHead(500, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: error.message }));
    }
  });
  const port = await listen(server);
  return { state, addAccount, url: `http://127.0.0.1:${port}`, close: () => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }) };
}

async function startNext(upstream, configured = true) {
  const port = await freePort();
  const baseURL = `http://127.0.0.1:${port}`;
  let log = "";
  const server = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      SUPABASE_URL: configured ? upstream : "",
      NEXT_PUBLIC_SUPABASE_URL: "",
      SUPABASE_KEY: configured ? "sb_publishable_local_integration_only" : "",
      SUPABASE_PUBLISHABLE_KEY: configured ? "sb_publishable_local_integration_only" : "",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
      SUPABASE_SERVICE_ROLE_KEY: "",
      SESSION_SECRET: configured ? sessionSecret : "",
      TEAM_PASSWORD: "obsolete-team-password",
      NODE_ENV: "production",
    },
  });
  server.stdout.on("data", (chunk) => { log += chunk.toString(); });
  server.stderr.on("data", (chunk) => { log += chunk.toString(); });
  const close = async () => {
    if (server.exitCode === null) await new Promise((resolve) => { server.once("exit", resolve); server.kill(); });
  };
  try {
    for (let attempt = 0; attempt < 90; attempt++) {
      if (server.exitCode !== null) throw new Error(`Next test server stopped: ${log}`);
      try {
        const result = await fetch(`${baseURL}/api/session`, { signal: AbortSignal.timeout(1000) });
        if (result.status !== 404) return { baseURL, close, logs: () => log };
      } catch { /* Wait for the isolated server startup. */ }
      await delay(300);
    }
    throw new Error(`Next test server did not start: ${log}`);
  } catch (error) {
    await close();
    throw error;
  }
}

function client(baseURL) {
  const cookies = new Map();
  return {
    cookies,
    async request(endpoint, { method = "GET", body, origin = baseURL, cookie, headers = {} } = {}) {
      const response = await fetch(`${baseURL}${endpoint}`, {
        method, signal: AbortSignal.timeout(10000),
        headers: { ...(method !== "GET" ? { Origin: origin } : {}), ...(body ? { "Content-Type": "application/json" } : {}), Cookie: cookie ?? [...cookies].map(([name, value]) => `${name}=${value}`).join("; "), ...headers },
        body: body ? JSON.stringify(body) : undefined,
      });
      const setCookies = response.headers.getSetCookie();
      for (const setCookie of setCookies) {
        const first = setCookie.split(";", 1)[0];
        const separator = first.indexOf("=");
        const name = first.slice(0, separator);
        const value = first.slice(separator + 1);
        if (/max-age=0(?:;|$)/i.test(setCookie) || value === "") cookies.delete(name);
        else cookies.set(name, value);
      }
      const raw = await response.text();
      let data;
      try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
      return { status: response.status, data, setCookies, response };
    },
  };
}

(async () => {
  assert.ok(fs.existsSync(path.join(root, ".next", "BUILD_ID")), "Run npm run build before account server verification.");
  let upstream;
  let app;
  try {
    upstream = await fakeSupabase();
    const alice = upstream.addAccount("alice");
    const bob = upstream.addAccount("bob");
    app = await startNext(upstream.url, false);
    const unconfigured = client(app.baseURL);
    const unavailable = await unconfigured.request("/api/session");
    assert.equal(unavailable.data.configured, false);
    assert.equal(unavailable.data.authenticated, false);
    const blockedSignup = await unconfigured.request("/api/account/register", { method: "POST", body: { username: "orphan", password, passwordConfirm: password } });
    assert.equal(blockedSignup.status, 503);
    assert.equal(upstream.state.calls.length, 0);
    await app.close();
    app = await startNext(upstream.url);
    const browser = client(app.baseURL);

    const initial = await browser.request("/api/session");
    assert.equal(initial.data.configured, true);
    assert.equal(initial.data.authenticated, false);
    assert.equal((await browser.request("/api/db/rest/v1/projects?select=*")).status, 401);
    const legacy = createHmac("sha256", sessionSecret).update("teams-session-v1").digest("hex");
    assert.equal((await browser.request("/api/session", { cookie: `teams_sid=${legacy}` })).data.authenticated, false);
    assert.equal((await browser.request("/api/db/rest/v1/projects", { cookie: `teams_sid=${legacy}` })).status, 401);

    const loginBody = { username: "  ALICE  ", password };
    const beforeCsrf = upstream.state.calls.length;
    assert.equal((await browser.request("/api/session", { method: "POST", origin: "https://untrusted.example", body: loginBody })).status, 403);
    assert.equal(upstream.state.calls.length, beforeCsrf);
    assert.equal((await browser.request("/api/session", { method: "POST", body: { ...loginBody, password: "wrong-password" } })).status, 401);
    const login = await browser.request("/api/session", { method: "POST", body: loginBody });
    assert.equal(login.status, 200, JSON.stringify(login.data));
    assert.equal(login.data.account.id, alice.user.id);
    assert.equal(login.data.account.username, "alice");
    assert.equal(login.data.authenticated, true);
    const sessionCookies = login.setCookies.filter((cookie) => cookie.startsWith("teams_account") && !/max-age=0(?:;|$)/i.test(cookie));
    assert.ok(sessionCookies.length > 0);
    for (const cookie of sessionCookies) {
      assert.ok(/httponly/i.test(cookie) && /samesite=lax/i.test(cookie), "Session cookies must be HttpOnly and SameSite=Lax");
      assert.ok(/secure/i.test(cookie), "Production session cookie must be Secure");
      assert.ok(!/max-age=|expires=/i.test(cookie), "Login must use browser-session cookies");
    }
    assert.ok(!JSON.stringify(login.data).includes("access_token"), "Access tokens must not be sent in the JSON response");
    assert.equal((await browser.request("/api/session")).data.account.id, alice.user.id);

    const profile = await browser.request("/api/account/profile", { method: "PATCH", body: { name: "  김민지  ", role: "  디자이너  ", avatar: "👩‍💻", color: "#5B7FA6", user_id: bob.user.id, id: bob.member.id } });
    assert.equal(profile.status, 200, JSON.stringify(profile.data));
    assert.equal(profile.data.account.member.name, "김민지");
    assert.equal(profile.data.account.member.role, "디자이너");
    assert.equal(profile.data.account.member.profile_completed, true);
    assert.equal(alice.member.user_id, alice.user.id);
    assert.equal(bob.member.name, "bob");
    const profileWrite = upstream.state.calls.findLast((call) => call.path === "/rest/v1/team_members" && call.method === "PATCH");
    assert.ok(profileWrite.search.includes(`user_id=eq.${alice.user.id}`));
    assert.deepEqual(Object.keys(profileWrite.body).sort(), ["avatar", "color", "name", "profile_completed", "role"]);

    const proxy = await browser.request("/api/db/rest/v1/projects?select=*", { headers: { Authorization: "Bearer spoofed-user-token", apikey: "spoofed-key" } });
    assert.equal(proxy.status, 200);
    assert.equal(proxy.data[0].name, "공유 과업");
    const proxyCall = upstream.state.calls.findLast((call) => call.path === "/rest/v1/projects");
    const userToken = proxyCall.headers.authorization.replace(/^Bearer /, "");
    assert.equal(upstream.state.tokens.get(userToken).user.id, alice.user.id);
    assert.notEqual(proxyCall.headers.authorization, `Bearer ${proxyCall.headers.apikey}`);
    assert.equal(proxyCall.headers.apikey, "sb_publishable_local_integration_only");
    const beforeUnknown = upstream.state.calls.length;
    const unknown = await browser.request("/api/db/auth/v1/admin/users");
    assert.ok([403, 404].includes(unknown.status));
    assert.ok(!upstream.state.calls.slice(beforeUnknown).some((call) => call.path.includes("/admin/")));
    assert.equal((await browser.request("/api/account/profile", { method: "PATCH", origin: "https://untrusted.example", body: { name: "변조", role: "", avatar: "🧑", color: "#000000" } })).status, 403);
    assert.equal((await browser.request("/api/db/rest/v1/projects", { method: "POST", origin: "https://untrusted.example", body: { name: "변조" } })).status, 403);

    const changedPassword = "ChangedIntegration123!";
    const passwordChange = { currentPassword: "wrong-password", password: changedPassword };
    assert.equal((await browser.request("/api/account/password", { method: "POST", body: passwordChange })).status, 400);
    assert.equal(alice.password, password);
    passwordChange.currentPassword = password;
    const changed = await browser.request("/api/account/password", { method: "POST", body: passwordChange });
    assert.equal(changed.status, 200, JSON.stringify(changed.data));
    assert.equal(alice.password, changedPassword);
    assert.equal((await browser.request("/api/session")).data.account.id, alice.user.id, "Temporary password verification must not sign out the current browser");

    // Expire the cookie payload to exercise the actual SSR refresh-token flow.
    const encoded = [...browser.cookies].filter(([name]) => /^teams_account(?:\.\d+)?$/.test(name)).sort(([a], [b]) => a.localeCompare(b)).map(([, value]) => decodeURIComponent(value)).join("");
    assert.ok(encoded.startsWith("base64-"));
    const expired = JSON.parse(Buffer.from(encoded.slice(7), "base64url").toString("utf8"));
    expired.expires_at = Math.floor(Date.now() / 1000) - 30;
    browser.cookies.clear();
    browser.cookies.set("teams_account", `base64-${Buffer.from(JSON.stringify(expired)).toString("base64url")}`);
    const refreshStart = upstream.state.calls.length;
    const refreshed = await browser.request("/api/session");
    assert.equal(refreshed.data.account.id, alice.user.id);
    assert.ok(upstream.state.calls.slice(refreshStart).some((call) => call.path === "/auth/v1/token" && call.search.includes("refresh_token")));
    assert.ok(refreshed.setCookies.some((cookie) => cookie.startsWith("teams_account") && !/max-age=0/i.test(cookie)));

    const logout = await browser.request("/api/session", { method: "DELETE" });
    assert.equal(logout.status, 200);
    assert.ok(logout.setCookies.some((cookie) => /max-age=0(?:;|$)/i.test(cookie)));
    assert.equal((await browser.request("/api/session")).data.authenticated, false);
    assert.equal((await browser.request("/api/db/rest/v1/projects")).status, 401);

    const registration = { username: "  NEW_MEMBER  ", password, passwordConfirm: password };
    upstream.state.ready = false;
    let beforeSignup = upstream.state.calls.filter((call) => call.path === "/auth/v1/signup").length;
    assert.equal((await browser.request("/api/account/register", { method: "POST", body: registration })).status, 503);
    assert.equal(upstream.state.calls.filter((call) => call.path === "/auth/v1/signup").length, beforeSignup);
    upstream.state.ready = true;
    upstream.state.confirmEmail = true;
    beforeSignup = upstream.state.calls.filter((call) => call.path === "/auth/v1/signup").length;
    assert.equal((await browser.request("/api/account/register", { method: "POST", body: registration })).status, 503);
    assert.equal(upstream.state.calls.filter((call) => call.path === "/auth/v1/signup").length, beforeSignup);
    upstream.state.confirmEmail = false;
    const registered = await browser.request("/api/account/register", { method: "POST", body: registration });
    assert.equal(registered.status, 201, JSON.stringify(registered.data));
    assert.equal(registered.data.authenticated, true);
    assert.equal(registered.data.account.username, "new_member");
    assert.equal(registered.data.account.member.profile_completed, false);
    assert.ok(registered.setCookies.some((cookie) => /httponly/i.test(cookie)));
    const signupCall = upstream.state.calls.findLast((call) => call.path === "/auth/v1/signup");
    assert.equal(signupCall.body.email, "new_member@members.dhteams.invalid");
    assert.equal(signupCall.body.data.username, "new_member");
    assert.equal((await browser.request("/api/session")).data.account.username, "new_member");
    assert.equal((await browser.request("/api/account/register", { method: "POST", body: registration })).status, 409);
    // An invalid upstream token must clear the session instead of leaving a stale user.
    upstream.state.tokens.clear();
    assert.equal((await browser.request("/api/session")).data.authenticated, false);
    assert.equal((await browser.request("/api/db/rest/v1/projects")).status, 401);
    console.log("PASS: actual Next account routes, fail-closed configuration/setup, legacy session rejection, normalized username auth, HttpOnly session cookies, CSRF, profile ownership, user JWT proxy, password verification/change, token refresh/expiry, signup, logout.");
  } catch (error) {
    if (app) console.error(app.logs());
    throw error;
  } finally {
    if (app) await app.close();
    if (upstream) await upstream.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
