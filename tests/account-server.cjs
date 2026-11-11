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
  const state = { calls: [], accounts: new Map(), tokens: new Map(), refreshTokens: new Map(), ready: true, confirmEmail: false, seatConflict: false, teams: new Map(), memberships: [], membershipsMissing: false, teamRpcError: null };
  const addAccount = (username) => {
    const id = randomUUID();
    const email = `${username}@members.dhteams.invalid`;
    const timestamp = new Date().toISOString();
    const user = { id, aud: "authenticated", role: "authenticated", email, email_confirmed_at: timestamp, confirmed_at: timestamp, created_at: timestamp, updated_at: timestamp, app_metadata: { provider: "email", providers: ["email"] }, user_metadata: { username }, identities: [{ id, user_id: id, identity_id: randomUUID(), provider: "email", identity_data: { email, sub: id } }] };
    const member = { id: randomUUID(), user_id: id, username, name: username, role: "", avatar: "🧑‍💻", color: "#547867", status_message: "", profile_completed: false, created_at: timestamp };
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
      if (url.pathname === "/rest/v1/rpc/claim_office_seat") {
        if (!account) return send(401, { message: "Missing authenticated user token" });
        if (state.seatConflict) return send(409, { code: "23505", message: "다른 팀원이 이미 선택한 자리입니다." });
        return send(200, { id: body.p_layout_id, name: "1번 사무실", theme: "sage", items: [{ id: "own-desk", kind: "desk", x: 250, y: 200, rotation: 0, label: "", member_id: body.p_item_id ? account.member.id : null }], updated_at: new Date().toISOString() });
      }
      // Several teams per person: memberships are rows, team_members.team_id is the active team.
      const membershipsOf = (memberId) => state.memberships.filter((row) => row.member_id === memberId);
      const addMembership = (memberId, teamId) => state.memberships.push({
        member_id: memberId, team_id: teamId, joined_at: new Date(Date.now() + state.memberships.length).toISOString(),
        role: state.memberships.some((row) => row.team_id === teamId) ? "member" : "owner",
      });
      const pick = (row, columns) => (columns.includes("*") ? row : Object.fromEntries(columns.map((column) => [column, row[column]])));
      if (url.pathname.startsWith("/rest/v1/rpc/") && ["create_team", "join_team", "leave_team", "regenerate_team_code", "switch_team"].includes(url.pathname.slice(13))) {
        if (!account) return send(401, { message: "Missing authenticated user token" });
        if (state.teamRpcError) return send(400, state.teamRpcError);
        const rpcName = url.pathname.slice(13);
        const memberId = account.member.id;
        // check_screen_team(): leave / rotation from a screen showing another team is refused.
        const screenTeam = request.headers["x-teams-team"];
        if (["leave_team", "regenerate_team_code"].includes(rpcName) && screenTeam && screenTeam !== account.member.team_id) {
          return send(403, { code: "42501", message: "다른 기기에서 팀을 바꿨습니다. 새로고침한 뒤 다시 시도해 주세요." });
        }
        if (rpcName === "create_team") {
          const team = { id: randomUUID(), name: body.p_name, invite_code: state.teams.size ? `K7QM3XP${"BCDEFGH"[state.teams.size]}` : "K7QM3XPA", created_by: memberId };
          state.teams.set(team.id, team);
          addMembership(memberId, team.id);
          account.member.team_id = team.id;
          return send(200, team);
        }
        if (rpcName === "join_team") {
          const team = [...state.teams.values()].find((candidate) => candidate.invite_code === body.p_code);
          if (!team) return send(404, { code: "P0002", message: "초대코드에 맞는 팀이 없습니다." });
          if (membershipsOf(memberId).some((row) => row.team_id === team.id)) return send(400, { code: "23514", message: "이미 이 팀 소속입니다." });
          addMembership(memberId, team.id);
          account.member.team_id = team.id;
          return send(200, team);
        }
        if (rpcName === "switch_team") {
          if (!membershipsOf(memberId).some((row) => row.team_id === body.p_team)) return send(403, { code: "42501", message: "소속된 팀으로만 바꿀 수 있습니다." });
          account.member.team_id = body.p_team;
          return send(200, state.teams.get(body.p_team));
        }
        if (rpcName === "leave_team") {
          state.memberships = state.memberships.filter((row) => !(row.member_id === memberId && row.team_id === account.member.team_id));
          account.member.team_id = membershipsOf(memberId).at(-1)?.team_id ?? null;
          return send(204);
        }
        const team = state.teams.get(account.member.team_id);
        team.invite_code = "N4RT8WZB";
        return send(200, team);
      }
      if (url.pathname === "/rest/v1/team_memberships") {
        if (!account) return send(401, { message: "Missing authenticated user token" });
        if (state.membershipsMissing) return send(404, { code: "PGRST205", message: "Could not find the table" });
        // RLS: my rows and the rows of my active team.
        let rows = state.memberships.filter((row) => row.member_id === account.member.id || row.team_id === account.member.team_id);
        for (const key of ["member_id", "team_id", "role"]) {
          const filter = url.searchParams.get(key);
          if (filter?.startsWith("eq.")) rows = rows.filter((row) => row[key] === filter.slice(3));
        }
        rows = [...rows].sort((a, b) => a.joined_at.localeCompare(b.joined_at));
        return send(200, rows.map((row) => pick(row, (url.searchParams.get("select") || "*").split(","))));
      }
      if (url.pathname === "/rest/v1/teams") {
        if (!account) return send(401, { message: "Missing authenticated user token" });
        const filter = url.searchParams.get("id") || "";
        const wanted = filter.startsWith("in.(") ? filter.slice(4, -1).split(",") : [filter.slice(3)];
        // RLS: teams I belong to (legacy DB without memberships: the active team only).
        const mine = state.membershipsMissing ? [account.member.team_id] : membershipsOf(account.member.id).map((row) => row.team_id);
        const teams = [...state.teams.values()].filter((team) => wanted.includes(team.id) && mine.includes(team.id))
          .map((team) => pick(team, (url.searchParams.get("select") || "*").split(",")));
        if (String(request.headers.accept).includes("application/vnd.pgrst.object+json")) return teams.length === 1 ? send(200, teams[0]) : send(406, { code: "PGRST116", message: "No row" });
        return send(200, teams);
      }
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
      if (url.pathname === "/rest/v1/team_presence") {
        if (!account) return send(401, { message: "Missing authenticated user token" });
        return send(200, [{ member_id: account.member.id, room_key: "office-1", x: 100, y: 200 }]);
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
    assert.equal((await browser.request("/api/db/rest/v1/team_presence?select=*")).status, 401);
    assert.equal((await browser.request("/api/account/status", { method: "PATCH", body: { statusMessage: "로그인 전" } })).status, 401);
    assert.equal((await browser.request("/api/office/seat", { method: "POST", body: { layoutId: randomUUID(), itemId: "own-desk" } })).status, 401);
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

    const changedStatus = await browser.request("/api/account/status", { method: "PATCH", body: { statusMessage: "  집중 작업 중 · 3시에 답할게요  ", user_id: bob.user.id, id: bob.member.id, name: "다른 사람" } });
    assert.equal(changedStatus.status, 200, JSON.stringify(changedStatus.data));
    assert.equal(changedStatus.data.member.status_message, "집중 작업 중 · 3시에 답할게요");
    assert.equal(changedStatus.data.member.id, alice.member.id);
    assert.equal(bob.member.status_message, "");
    const statusWrite = upstream.state.calls.findLast((call) => call.path === "/rest/v1/team_members" && call.method === "PATCH");
    assert.ok(statusWrite.search.includes(`user_id=eq.${alice.user.id}`));
    assert.deepEqual(Object.keys(statusWrite.body), ["status_message"]);
    assert.equal((await browser.request("/api/session")).data.account.member.status_message, "집중 작업 중 · 3시에 답할게요");
    const limitStatus = await browser.request("/api/account/status", { method: "PATCH", body: { statusMessage: "가".repeat(61) } });
    assert.equal(limitStatus.status, 400);
    assert.equal(alice.member.status_message, "집중 작업 중 · 3시에 답할게요");
    assert.equal((await browser.request("/api/account/status", { method: "PATCH", body: { statusMessage: "😀".repeat(60) } })).status, 200);
    assert.equal((await browser.request("/api/account/status", { method: "PATCH", origin: "https://untrusted.example", body: { statusMessage: "변조" } })).status, 403);
    assert.equal((await browser.request("/api/account/status", { method: "PATCH", body: { statusMessage: "   " } })).data.member.status_message, "");

    const seatBody = { layoutId: randomUUID(), itemId: "own-desk", memberId: bob.member.id };
    assert.equal((await browser.request("/api/office/seat", { method: "POST", origin: "https://untrusted.example", body: seatBody })).status, 403);
    assert.equal((await browser.request("/api/office/seat", { method: "POST", body: { ...seatBody, layoutId: "invalid" } })).status, 400);
    const claimedSeat = await browser.request("/api/office/seat", { method: "POST", body: seatBody });
    assert.equal(claimedSeat.status, 200, JSON.stringify(claimedSeat.data));
    assert.equal(claimedSeat.data.layout.items[0].member_id, alice.member.id);
    const seatCall = upstream.state.calls.findLast((call) => call.path === "/rest/v1/rpc/claim_office_seat");
    assert.deepEqual(seatCall.body, { p_layout_id: seatBody.layoutId, p_item_id: "own-desk" });
    assert.equal(upstream.state.tokens.get(seatCall.headers.authorization.replace(/^Bearer /, "")).user.id, alice.user.id);
    upstream.state.seatConflict = true;
    assert.equal((await browser.request("/api/office/seat", { method: "POST", body: seatBody })).status, 409);
    upstream.state.seatConflict = false;
    assert.equal((await browser.request("/api/office/seat", { method: "POST", body: { ...seatBody, itemId: null } })).data.layout.items[0].member_id, null);

    // Team spaces: input validation, RPC mapping, session payload carries the team.
    assert.equal((await browser.request("/api/team", { method: "POST", origin: "https://untrusted.example", body: { action: "create", name: "A팀" } })).status, 403);
    assert.equal((await browser.request("/api/team", { method: "POST", body: { action: "explode" } })).status, 400);
    assert.equal((await browser.request("/api/team", { method: "POST", body: { action: "create", name: "   " } })).status, 400);
    assert.equal((await browser.request("/api/team", { method: "POST", body: { action: "join", code: "O0O0" } })).status, 400);
    const created = await browser.request("/api/team", { method: "POST", body: { action: "create", name: " A팀 " } });
    assert.equal(created.status, 200, JSON.stringify(created.data));
    assert.deepEqual(created.data.account.team, { id: alice.member.team_id, name: "A팀", invite_code: "K7QM3XPA", is_owner: true, can_rotate_code: true });
    assert.deepEqual(created.data.account.teams, [{ id: alice.member.team_id, name: "A팀", is_owner: true }], "team list never carries invite codes");
    assert.deepEqual(upstream.state.calls.findLast((call) => call.path === "/rest/v1/rpc/create_team").body, { p_name: "A팀" });
    const rotated = await browser.request("/api/team", { method: "POST", body: { action: "regenerate" } });
    assert.equal(rotated.data.account.team.invite_code, "N4RT8WZB");
    assert.equal((await browser.request("/api/session")).data.account.team.name, "A팀");
    const left = await browser.request("/api/team", { method: "POST", body: { action: "leave" } });
    assert.equal(left.status, 200);
    assert.equal(left.data.account.team, null);
    assert.equal((await browser.request("/api/team", { method: "POST", body: { action: "join", code: "zzzz-zzzz" } })).status, 404);
    const joined = await browser.request("/api/team", { method: "POST", body: { action: "join", code: " n4rt-8wzb " } });
    assert.equal(joined.status, 200, JSON.stringify(joined.data));
    assert.deepEqual(upstream.state.calls.findLast((call) => call.path === "/rest/v1/rpc/join_team").body, { p_code: "N4RT8WZB" });
    assert.equal(joined.data.account.team.is_owner, true);
    // A second team while already in one: allowed, the new team becomes active.
    const teamA = joined.data.account.team;
    const second = await browser.request("/api/team", { method: "POST", body: { action: "create", name: "B팀" } });
    assert.equal(second.status, 200, JSON.stringify(second.data));
    assert.equal(second.data.account.team.name, "B팀");
    assert.deepEqual(second.data.account.teams.map((team) => team.name), ["A팀", "B팀"]);
    assert.equal(second.data.account.teams.some((team) => "invite_code" in team), false);
    const teamB = second.data.account.team;
    // Switching: uuid checked before any upstream call, RPC refusal is 403.
    const switchCalls = () => upstream.state.calls.filter((call) => call.path === "/rest/v1/rpc/switch_team").length;
    const beforeSwitch = switchCalls();
    assert.equal((await browser.request("/api/team", { method: "POST", body: { action: "switch", teamId: "not-a-uuid" } })).status, 400);
    assert.equal((await browser.request("/api/team", { method: "POST", body: { action: "switch" } })).status, 400);
    assert.equal((await browser.request("/api/team", { method: "POST", origin: "https://untrusted.example", body: { action: "switch", teamId: teamA.id } })).status, 403);
    assert.equal(switchCalls(), beforeSwitch);
    assert.equal((await browser.request("/api/team", { method: "POST", body: { action: "switch", teamId: randomUUID() } })).status, 403);
    const switchedBack = await browser.request("/api/team", { method: "POST", body: { action: "switch", teamId: teamA.id.toUpperCase() } });
    assert.equal(switchedBack.status, 200, JSON.stringify(switchedBack.data));
    assert.deepEqual(upstream.state.calls.findLast((call) => call.path === "/rest/v1/rpc/switch_team").body, { p_team: teamA.id });
    assert.equal(switchedBack.data.account.team.id, teamA.id);
    assert.equal(switchedBack.data.account.team.invite_code, "N4RT8WZB");
    assert.equal((await browser.request("/api/session")).data.account.team.id, teamA.id);
    // Owner flags follow the role in the active team.
    const aliceInA = upstream.state.memberships.find((row) => row.member_id === alice.member.id && row.team_id === teamA.id);
    aliceInA.role = "member";
    upstream.state.memberships.push({ member_id: bob.member.id, team_id: teamA.id, role: "owner", joined_at: new Date(0).toISOString() });
    const asMember = (await browser.request("/api/session")).data.account;
    assert.equal(asMember.team.is_owner, false);
    assert.equal(asMember.team.can_rotate_code, false);
    assert.deepEqual(asMember.teams.map((team) => [team.name, team.is_owner]), [["A팀", false], ["B팀", true]]);
    upstream.state.memberships = upstream.state.memberships.filter((row) => row.member_id !== bob.member.id);
    assert.equal((await browser.request("/api/session")).data.account.team.can_rotate_code, true, "nobody owns the team: anyone may rotate");
    aliceInA.role = "owner";
    // Stale screen (shows B, active is A): leave is refused and nothing changes; malformed team id never reaches upstream.
    assert.equal((await browser.request("/api/team", { method: "POST", body: { action: "leave", expectedTeamId: "x" } })).status, 400);
    const staleLeave = await browser.request("/api/team", { method: "POST", body: { action: "leave", expectedTeamId: teamB.id } });
    assert.equal(staleLeave.status, 403);
    assert.equal(upstream.state.calls.findLast((call) => call.path === "/rest/v1/rpc/leave_team").headers["x-teams-team"], teamB.id);
    assert.equal(upstream.state.memberships.filter((row) => row.member_id === alice.member.id).length, 2);
    // Leaving the active team moves to the remaining one.
    const leftA = await browser.request("/api/team", { method: "POST", body: { action: "leave", expectedTeamId: teamA.id } });
    assert.equal(leftA.data.account.team.id, teamB.id);
    assert.deepEqual(leftA.data.account.teams.map((team) => team.id), [teamB.id]);
    // Database without the memberships SQL: the active team still loads, listed alone.
    upstream.state.membershipsMissing = true;
    const legacySession = (await browser.request("/api/session")).data.account;
    assert.equal(legacySession.team.id, teamB.id);
    assert.equal(legacySession.team.is_owner, true);
    assert.deepEqual(legacySession.teams, [{ id: teamB.id, name: "B팀", is_owner: true }]);
    upstream.state.membershipsMissing = false;
    upstream.state.teamRpcError = { code: "23514", message: "이미 팀에 소속되어 있습니다." };
    const already = await browser.request("/api/team", { method: "POST", body: { action: "create", name: "B팀" } });
    assert.equal(already.status, 400);
    assert.equal(already.data.error, "이미 팀에 소속되어 있습니다.");
    upstream.state.teamRpcError = { code: "PGRST202", message: "Function not found" };
    assert.equal((await browser.request("/api/team", { method: "POST", body: { action: "leave" } })).status, 503);
    upstream.state.teamRpcError = { code: "XX000", message: "internal detail must not leak" };
    const hidden = await browser.request("/api/team", { method: "POST", body: { action: "leave" } });
    assert.equal(hidden.status, 503);
    assert.doesNotMatch(hidden.data.error, /internal detail/);
    upstream.state.teamRpcError = null;

    const proxy = await browser.request("/api/db/rest/v1/projects?select=*", { headers: { Authorization: "Bearer spoofed-user-token", apikey: "spoofed-key" } });
    assert.equal(proxy.status, 200);
    assert.equal(proxy.data[0].name, "공유 과업");
    const proxyCall = upstream.state.calls.findLast((call) => call.path === "/rest/v1/projects");
    const userToken = proxyCall.headers.authorization.replace(/^Bearer /, "");
    assert.equal(upstream.state.tokens.get(userToken).user.id, alice.user.id);
    assert.notEqual(proxyCall.headers.authorization, `Bearer ${proxyCall.headers.apikey}`);
    assert.equal(proxyCall.headers.apikey, "sb_publishable_local_integration_only");
    // The screen's team id is forwarded (database refuses stale screens); other headers and junk values are not.
    const screenTeam = randomUUID();
    await browser.request("/api/db/rest/v1/projects?select=*", { headers: { "x-teams-team": screenTeam, "x-other": "drop-me" } });
    const teamHeaderCall = upstream.state.calls.findLast((call) => call.path === "/rest/v1/projects");
    assert.equal(teamHeaderCall.headers["x-teams-team"], screenTeam);
    assert.equal(teamHeaderCall.headers["x-other"], undefined);
    const beforeJunk = upstream.state.calls.length;
    assert.equal((await browser.request("/api/db/rest/v1/projects?select=*", { headers: { "x-teams-team": "not-a-uuid" } })).status, 400);
    assert.equal(upstream.state.calls.length, beforeJunk, "malformed team header is refused before any upstream call");
    const presence = await browser.request("/api/db/rest/v1/team_presence?select=*", { headers: { Authorization: "Bearer spoofed-user-token" } });
    assert.equal(presence.status, 200);
    assert.equal(presence.data[0].member_id, alice.member.id);
    const presenceCall = upstream.state.calls.findLast((call) => call.path === "/rest/v1/team_presence");
    assert.equal(upstream.state.tokens.get(presenceCall.headers.authorization.replace(/^Bearer /, "")).user.id, alice.user.id);
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

    assert.equal((await browser.request("/api/db/rest/v1/team_presence")).status, 401);

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
