/* eslint-disable @typescript-eslint/no-require-imports -- Isolated browser fixtures; no production requests. */
const assert = require("node:assert/strict");
const { installAccountMock } = require("./account-mock.cjs");

const id = (number) => `10000000-0000-4000-8000-${String(number).padStart(12, "0")}`;

async function installGameWorldMock(context) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
  let revision = 0;
  const stamp = () => new Date(Date.now() + ++revision).toISOString();
  const members = [
    { id: id(1), name: "김민수", role: "설계팀 · 대리", avatar: "🧑‍💻", color: "#547867", status_message: "제안서 작성 중", created_at: stamp() },
    { id: id(2), name: "이지은", role: "기획팀 · 과장", avatar: "👩‍💻", color: "#5B7FA6", status_message: "회의 준비 중", created_at: stamp() },
  ];
  const layouts = [
    ...Array.from({ length: 4 }, (_, index) => ({
      id: id(10 + index), name: `사무실 ${index + 1}`, room_key: `office-${index + 1}`, room_kind: "office",
      theme: "sage", canvas_width: 1600, canvas_height: 1000, updated_at: stamp(), created_at: stamp(),
      items: index ? [] : [
        { id: "empty-desk", kind: "desk", x: 300, y: 250, rotation: 0, label: "내가 앉을 책상", member_id: null },
        { id: "occupied-desk", kind: "desk", x: 650, y: 250, rotation: 0, label: "지은의 책상", member_id: members[1].id },
      ],
    })),
    { id: id(20), name: "야외 마당", room_key: "outdoor", room_kind: "outdoor", theme: "sage", canvas_width: 2400, canvas_height: 1200, items: [], updated_at: stamp(), created_at: stamp() },
    { id: id(21), name: "우리 카페", room_key: "cafe", room_kind: "cafe", theme: "sand", canvas_width: 1600, canvas_height: 1000, items: [], updated_at: stamp(), created_at: stamp() },
  ];
  const db = {
    team_members: members, office_layouts: layouts, team_presence: [
      { member_id: members[0].id, layout_id: layouts[0].id, x: 200, y: 700, facing: "down", motion: "standing", updated_at: stamp() },
      { member_id: members[1].id, layout_id: layouts[0].id, x: 650, y: 290, facing: "up", motion: "seated", updated_at: stamp() },
    ], department_events: [], projects: [],
    team_attendance: members.map((member, index) => ({ id: id(30 + index), member_id: member.id, work_date: today, checked_in_at: new Date().toISOString(), checked_out_at: null })),
  };
  const account = await installAccountMock(context, { members });
  const state = { db, account, requests: [], failSeat: false, failPresence: false };
  const matches = (row, params) => [...params].every(([column, query]) => {
    if (!["id", "member_id", "layout_id", "work_date", "updated_at", "checked_out_at"].includes(column)) return true;
    if (query.startsWith("eq.")) return String(row[column]) === query.slice(3);
    if (query === "is.null") return row[column] == null;
    return true;
  });

  await context.route("**/rest/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const table = url.pathname.split("/").pop();
    const method = request.method();
    const rows = db[table];
    state.requests.push({ table, method });
    if (!rows) return route.fulfill({ json: [] });
    if (method === "GET") {
      const selected = rows.filter((row) => matches(row, url.searchParams));
      return route.fulfill({ json: request.headers().accept?.includes("object") ? selected[0] || null : selected });
    }
    const body = method === "DELETE" ? null : request.postDataJSON();
    state.requests[state.requests.length - 1].body = body;
    if (table === "team_presence") {
      if (state.failPresence) return route.fulfill({ status: 503, json: { message: "이동 상태 저장 연결 실패" } });
      assert.equal(body.member_id, account.account.member.id, "Movement must only write the signed-in member.");
      const saved = { ...body, updated_at: stamp() };
      const existing = rows.findIndex((row) => row.member_id === body.member_id);
      if (existing < 0) rows.push(saved); else rows[existing] = saved;
      return route.fulfill({ json: saved });
    }
    if (method === "POST") {
      const row = { ...body, id: id(100 + revision), created_at: stamp(), updated_at: stamp() };
      rows.push(row);
      return route.fulfill({ json: row });
    }
    const index = rows.findIndex((row) => matches(row, url.searchParams));
    if (index < 0) return route.fulfill({ json: null });
    if (method === "DELETE") return route.fulfill({ json: rows.splice(index, 1)[0] });
    Object.assign(rows[index], body, { updated_at: stamp() });
    return route.fulfill({ json: rows[index] });
  });

  await context.route("**/api/office/seat", async (route) => {
    if (state.failSeat) return route.fulfill({ status: 503, json: { error: "자리 선택 저장 연결 실패" } });
    const { layoutId, itemId } = route.request().postDataJSON();
    const layout = layouts.find((room) => room.id === layoutId);
    if (!layout) return route.fulfill({ status: 404, json: { error: "공간을 찾을 수 없습니다." } });
    const memberId = account.account.member.id;
    const selected = itemId ? layout.items.find((item) => item.id === itemId && item.kind === "desk") : null;
    if (itemId && !selected) return route.fulfill({ status: 404, json: { error: "선택한 책상을 찾을 수 없습니다." } });
    if (selected?.member_id && selected.member_id !== memberId) return route.fulfill({ status: 409, json: { error: "다른 팀원이 사용 중인 자리입니다." } });
    for (const item of layout.items) if (item.member_id === memberId) item.member_id = null;
    if (selected) selected.member_id = memberId;
    layout.updated_at = stamp();
    state.requests.push({ endpoint: "seat", layoutId, itemId });
    return route.fulfill({ json: { layout } });
  });
  return state;
}

module.exports = { installGameWorldMock, id };
