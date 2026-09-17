/* eslint-disable @typescript-eslint/no-require-imports -- Browser API fixtures. */
const { randomUUID } = require("node:crypto");

const PASSWORD = "Testpass123!";

async function installAccountMock(context, { members = [], authenticated = true } = {}) {
  const accounts = members.map((member, index) => {
    member.user_id ??= randomUUID();
    member.username ??= `member_${index + 1}`;
    member.profile_completed ??= true;
    return { id: member.user_id, username: member.username, member, password: PASSWORD };
  });
  let current = authenticated ? accounts[0] ?? null : null;
  const state = {
    configured: true,
    failProfile: false,
    registrationAvailable: true,
    accounts,
    get account() { return current; },
    useMember(index) { current = accounts[index] ?? null; },
    expire() { current = null; },
  };
  const identity = () => current ? { id: current.id, username: current.username, member: current.member } : null;
  const payload = () => ({ configured: state.configured, authenticated: Boolean(current), account: identity() });

  await context.route("**/api/session", async (route) => {
    const request = route.request();
    if (request.method() === "DELETE") { current = null; return route.fulfill({ json: payload() }); }
    if (request.method() === "POST") {
      const input = request.postDataJSON();
      const found = accounts.find((account) => account.username === input.username.trim().toLowerCase() && account.password === input.password);
      if (!found) return route.fulfill({ status: 401, json: { ...payload(), error: "아이디 또는 비밀번호가 맞지 않습니다." } });
      current = found;
    }
    return route.fulfill({ json: payload() });
  });
  await context.route("**/api/account/register", async (route) => {
    if (!state.registrationAvailable) return route.fulfill({ status: 503, json: { error: "회원가입 저장소가 아직 준비되지 않았습니다." } });
    const input = route.request().postDataJSON();
    const username = input.username.trim().toLowerCase();
    if (accounts.some((account) => account.username === username)) return route.fulfill({ status: 409, json: { error: "이미 사용 중인 아이디입니다." } });
    const member = { id: randomUUID(), user_id: randomUUID(), username, name: username, role: "", avatar: "🧑‍💻", color: "#547867", created_at: new Date().toISOString(), profile_completed: false };
    members.push(member);
    current = { id: member.user_id, username, member, password: input.password };
    accounts.push(current);
    return route.fulfill({ json: payload() });
  });
  await context.route("**/api/account/profile", async (route) => {
    if (!current) return route.fulfill({ status: 401, json: { error: "로그인이 필요합니다." } });
    if (state.failProfile) return route.fulfill({ status: 503, json: { error: "프로필 저장 연결 실패" } });
    const input = route.request().postDataJSON();
    Object.assign(current.member, { name: input.name.trim(), role: input.role.trim(), avatar: input.avatar, color: input.color, profile_completed: true });
    return route.fulfill({ json: { account: identity() } });
  });
  await context.route("**/api/account/password", async (route) => {
    if (!current) return route.fulfill({ status: 401, json: { error: "로그인이 필요합니다." } });
    const input = route.request().postDataJSON();
    if (input.currentPassword !== current.password) return route.fulfill({ status: 400, json: { error: "현재 비밀번호가 맞지 않습니다." } });
    current.password = input.password;
    return route.fulfill({ json: { ok: true } });
  });
  return state;
}

module.exports = { installAccountMock, PASSWORD };
