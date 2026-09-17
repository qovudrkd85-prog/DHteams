/* eslint-disable @typescript-eslint/no-require-imports -- Standalone local browser verification. */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { installAccountMock, PASSWORD } = require("./helpers/account-mock.cjs");
const baseURL = process.env.TEST_BASE_URL || "http://localhost:3001";
if (!["localhost", "127.0.0.1"].includes(new URL(baseURL).hostname)) throw new Error("Only a local test server is allowed.");
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
const id = (number) => `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1536, height: 1180 }, timezoneId: "Asia/Seoul" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    let sequence = 10;
    let revision = 0;
    const stamp = () => new Date(Date.now() + ++revision * 1000).toISOString();
    const db = {
      team_members: [{ id: id(1), name: "김서연", role: "설계팀", avatar: "👩‍💻", color: "#5B7FA6", created_at: stamp() }],
      team_attendance: [],
      office_layouts: [{ id: id(2), name: "우리의 첫 사무실", theme: "sage", updated_at: stamp(), items: [
        { id: "desk-one", kind: "desk", x: 270, y: 220, rotation: 0, label: "첫 번째 책상", member_id: null },
        { id: "desk-two", kind: "desk", x: 490, y: 220, rotation: 0, label: "서연의 책상", member_id: id(1) },
        { id: "plant-one", kind: "plant", x: 790, y: 120, rotation: 0, label: "초록 화분", member_id: null },
        { id: "sofa-one", kind: "sofa", x: 760, y: 350, rotation: 0, label: "쉬는 곳", member_id: null },
      ] }],
      department_events: [],
      projects: [{ id: id(3), name: "하천 기본계획", code: "2026-01", description: "함께 만드는 첫 과업", created_at: stamp() }],
    };
    let missing = false, failLayout = false, failAttendance = false;
    let attendanceWrites = 0;
    const matches = (row, search) => [...search].every(([key, query]) => {
      if (!["id", "member_id", "work_date", "checked_in_at", "checked_out_at", "updated_at", "deleted_at", "starts_on", "ends_on"].includes(key)) return true;
      const [operation, ...rest] = query.split(".");
      const value = rest.join(".");
      if (operation === "eq") return String(row[key]) === value;
      if (operation === "is") return value === "null" && row[key] == null;
      if (operation === "lte") return row[key] <= value;
      if (operation === "gte") return row[key] >= value;
      return true;
    });
    await installAccountMock(context, { members: db.team_members, authenticated: false });
    await context.route("**/rest/v1/**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const table = url.pathname.split("/").pop();
      if (!(table in db)) return route.fulfill({ json: [] });
      if (missing && ["team_members", "team_attendance", "office_layouts"].includes(table)) return route.fulfill({ status: 404, json: { code: "PGRST205", message: "missing table" } });
      const rows = db[table];
      if (request.method() === "GET") {
        const selected = rows.filter((row) => matches(row, url.searchParams));
        return route.fulfill({ json: request.headers().accept?.includes("object") ? selected[0] || null : selected });
      }
      if (table === "office_layouts" && failLayout) return route.fulfill({ status: 503, json: { message: "배치 저장 연결 실패" } });
      if (table === "team_attendance") {
        attendanceWrites++;
        if (failAttendance) return route.fulfill({ status: 503, json: { message: "출퇴근 연결 실패" } });
      }
      if (request.method() === "POST") {
        const body = request.postDataJSON();
        if (table === "team_attendance" && rows.some((row) => row.member_id === body.member_id && row.work_date === today)) return route.fulfill({ json: null });
        const row = { ...body, id: id(++sequence), created_at: stamp(), updated_at: stamp() };
        if (table === "team_attendance") Object.assign(row, { work_date: today, checked_in_at: new Date().toISOString(), checked_out_at: null });
        rows.push(row);
        return route.fulfill({ json: row });
      }
      const index = rows.findIndex((row) => matches(row, url.searchParams));
      if (index < 0) return route.fulfill({ json: null });
      if (request.method() === "DELETE") return route.fulfill({ json: rows.splice(index, 1)[0] });
      Object.assign(rows[index], request.postDataJSON(), { updated_at: stamp() });
      return route.fulfill({ json: rows[index] });
    });
    await page.goto(baseURL);
    await page.getByRole("button", { name: "회원가입", exact: true }).click();
    await page.getByLabel("아이디", { exact: true }).fill("jimin");
    await page.getByLabel("비밀번호", { exact: true }).fill(PASSWORD);
    await page.getByLabel("비밀번호 확인", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "회원가입하고 내 설정하기", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("이름", { exact: true }).fill("박지민");
    await dialog.getByLabel("직책", { exact: true }).fill("설계팀 · 대리");
    await dialog.getByRole("button", { name: "프로필 색상 3", exact: true }).click();
    await dialog.getByRole("button", { name: "설정하고 시작하기", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    await page.getByRole("heading", { name: "함께 계획하는 하루" }).waitFor();
    const panel = page.getByRole("region", { name: "팀원과 출퇴근" });
    const me = db.team_members.find((member) => member.name === "박지민");
    assert.ok(me);
    assert.equal(me.username, "jimin");
    assert.ok(me.user_id);
    assert.equal(await page.evaluate(() => localStorage.getItem("teams-current-member")), null);
    assert.equal(me.color, "#C47B55");
    failAttendance = true;
    await panel.getByRole("button", { name: "출근하기", exact: true }).click();
    await page.getByText("출퇴근 연결 실패", { exact: true }).waitFor();
    assert.equal(db.team_attendance.length, 0);
    failAttendance = false;
    await panel.getByRole("button", { name: "출근하기", exact: true }).click();
    await panel.getByRole("button", { name: "퇴근하기", exact: true }).waitFor();
    assert.equal(db.team_attendance.length, 1);
    await page.reload();
    await panel.getByRole("button", { name: "퇴근하기", exact: true }).waitFor();
    // The rest of the office interaction coverage follows below.
    const office = page.getByRole("region", { name: "팀 오피스", exact: true });
    await office.waitFor();
    await office.getByRole("button", { name: "공간 꾸미기", exact: true }).click();
    await page.getByTestId("office-item-desk-one").click();
    await office.getByLabel("좌석 팀원").selectOption(me.id);
    await page.getByTestId("office-item-desk-one").focus();
    await page.keyboard.press("ArrowRight");
    const desk = page.getByTestId("office-item-desk-one");
    const box = await desk.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 50, box.y + box.height / 2 + 30, { steps: 8 });
    await page.mouse.up();
    await office.getByRole("button", { name: "저장", exact: true }).click();
    await office.getByRole("button", { name: "공간 꾸미기", exact: true }).waitFor();
    const savedDesk = db.office_layouts[0].items.find((item) => item.id === "desk-one");
    assert.equal(savedDesk.member_id, me.id);
    assert.ok(savedDesk.x > 270);
    assert.ok(savedDesk.y > 220);
    assert.equal(await desk.getAttribute("data-present"), "true");
    await page.reload();
    await panel.getByRole("button", { name: "퇴근하기", exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelector('[data-testid="office-item-desk-one"]')?.getAttribute("data-present") === "true");
    fs.mkdirSync(path.join(process.cwd(), "artifacts"), { recursive: true });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: "artifacts/team-workspace-desktop.png", fullPage: true });
    // An old checkout button must never silently become a new check-in at midnight.
    await page.clock.setFixedTime(new Date(`${today}T15:00:01.000Z`));
    await panel.getByRole("button", { name: "퇴근하기", exact: true }).click();
    await page.getByText("날짜가 바뀌어 오늘의 출퇴근 상태를 다시 확인합니다.", { exact: false }).waitFor();
    await panel.getByRole("button", { name: "출근하기", exact: true }).waitFor();
    assert.equal(attendanceWrites, 2);
    await page.clock.setFixedTime(new Date());
    await panel.getByRole("button", { name: "출퇴근 새로고침", exact: true }).click();
    await panel.getByRole("button", { name: "퇴근하기", exact: true }).waitFor();
    await panel.getByRole("button", { name: "퇴근하기", exact: true }).click();
    await panel.getByRole("button", { name: "오늘 퇴근 완료", exact: true }).waitFor();
    assert.ok(db.team_attendance[0].checked_out_at);
    assert.equal(await desk.getAttribute("data-present"), "false");
    assert.equal(attendanceWrites, 3);
    await office.getByRole("button", { name: "공간 꾸미기", exact: true }).click();
    await office.getByRole("button", { name: "책상 추가", exact: true }).click();
    failLayout = true;
    await office.getByRole("button", { name: "저장", exact: true }).click();
    await page.getByText("배치 저장 연결 실패", { exact: true }).waitFor();
    assert.equal(db.office_layouts[0].items.length, 4);
    failLayout = false;
    await office.getByRole("button", { name: "저장", exact: true }).click();
    await office.getByRole("button", { name: "공간 꾸미기", exact: true }).waitFor();
    assert.equal(db.office_layouts[0].items.length, 5);
    // Multiple floorplans, theme, rotation, duplicate seats, and unsaved-switch protection.
    await office.getByRole("button", { name: "배치도 추가", exact: true }).click();
    await office.getByLabel("배치도 이름", { exact: true }).fill("두 번째 공간");
    await office.getByRole("button", { name: "블루 스카이", exact: true }).click();
    await office.getByRole("button", { name: "회의 테이블 추가", exact: true }).click();
    const table = office.locator('[data-kind="table"]');
    await table.focus();
    await page.keyboard.press("r");
    await office.getByRole("button", { name: "책상 추가", exact: true }).click();
    await office.getByLabel("좌석 팀원").selectOption(me.id);
    await office.getByRole("button", { name: "책상 추가", exact: true }).click();
    assert.equal(await office.getByLabel("좌석 팀원").locator(`option[value="${me.id}"]`).isDisabled(), true);
    await office.getByRole("button", { name: "저장", exact: true }).click();
    await office.getByRole("button", { name: "공간 꾸미기", exact: true }).waitFor();
    const second = db.office_layouts.find((layout) => layout.name === "두 번째 공간");
    assert.equal(second.theme, "sky");
    assert.equal(second.items.find((item) => item.kind === "table").rotation, 90);
    await page.reload();
    await office.getByRole("button", { name: "공간 꾸미기", exact: true }).waitFor();
    assert.equal(await office.getByLabel("배치도 선택").inputValue(), second.id);
    await office.getByRole("button", { name: "공간 꾸미기", exact: true }).click();
    await office.getByLabel("배치도 이름", { exact: true }).fill("보관할 초안");
    await office.getByLabel("배치도 선택").selectOption(id(2));
    await office.getByText("아직 저장하지 않은 변경사항이 있어요.", { exact: true }).waitFor();
    await office.getByRole("button", { name: "계속 꾸미기", exact: true }).click();
    assert.equal(await office.getByLabel("배치도 이름", { exact: true }).inputValue(), "보관할 초안");
    // Remote changes pause during editing and stale saves cannot overwrite them.
    second.updated_at = stamp();
    await office.getByRole("button", { name: "저장", exact: true }).click();
    await office.getByText("다른 팀원이 이 배치도를 변경했습니다.", { exact: false }).waitFor();
    assert.equal(second.name, "두 번째 공간");
    assert.equal(await office.getByLabel("배치도 이름", { exact: true }).inputValue(), "보관할 초안");
    await office.getByRole("button", { name: "최신 배치도 불러오기", exact: true }).click();
    await office.getByRole("button", { name: "변경 버리고 계속", exact: true }).click();
    await office.getByRole("button", { name: "공간 꾸미기", exact: true }).waitFor();
    await office.getByRole("button", { name: "공간 꾸미기", exact: true }).click();
    await office.getByRole("button", { name: "이 배치도 삭제", exact: true }).click();
    await office.getByRole("button", { name: "배치도 삭제", exact: true }).click();
    await office.getByRole("button", { name: "공간 꾸미기", exact: true }).waitFor();
    assert.equal(db.office_layouts.length, 1);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: "artifacts/team-workspace-mobile.png", fullPage: true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "Mobile document must not overflow horizontally");
    missing = true;
    await page.reload();
    await panel.getByText("팀 공간 저장소가 아직 준비되지 않았습니다.", { exact: false }).waitFor();
    assert.equal(await panel.getByRole("button", { name: "출근하기", exact: true }).count(), 0);
    assert.deepEqual(errors, []);
    console.log("PASS: member identity, attendance/errors/midnight, seated characters, pointer/keyboard editing, multiple layouts/themes/rotation, duplicate seats, draft protection/conflicts, deletion, mobile width, missing storage.");
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
