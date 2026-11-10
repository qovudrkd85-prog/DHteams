/* eslint-disable @typescript-eslint/no-require-imports -- Standalone CommonJS test harness; supports an external Playwright installation. */
// Run against a local production server. All session/DB requests are mocked;
// this test never creates, changes, or deletes production data.
// PLAYWRIGHT_MODULE may point to an existing Playwright installation.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { installAccountMock } = require("./helpers/account-mock.cjs");
const baseURL = process.env.TEST_BASE_URL || "http://localhost:3001";
if (!["localhost", "127.0.0.1"].includes(new URL(baseURL).hostname))
  throw new Error("Only a local test server is allowed.");

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1120 },
      timezoneId: "Asia/Seoul",
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
    }).format(new Date());
    const members = [
      { id: "11111111-1111-4111-8111-111111111111", name: "김민수", role: "설계", avatar: "🐻", color: "#547867", created_at: today },
      { id: "22222222-2222-4222-8222-222222222222", name: "이지은", role: "기획", avatar: "🐱", color: "#5B7FA6", created_at: today },
    ];
    let revision = 0;
    const stamp = () =>
      `2026-01-01T00:00:${String(++revision).padStart(2, "0")}.000Z`;
    let rows = [
      {
        id: "e1",
        title: "부서 주간회의",
        category: "meeting",
        starts_on: today,
        ends_on: today,
        starts_at: "10:00:00",
        location: "2층 회의실",
        organizer: "부서 전체",
        note: "",
        updated_at: stamp(),
        deleted_at: null,
      },
    ];
    const projects = [
      {
        id: "p1",
        name: "효곡지구 자연재해위험개선지구",
        code: "2026-01",
        description: "기본계획 및 설계 검토",
        created_at: today,
      },
      {
        id: "p2",
        name: "지평지구",
        code: "2026-02",
        description: "",
        created_at: today,
      },
      {
        id: "p3",
        name: "후포지구 풍수해생활권",
        code: "2026-03",
        description: "현장 조사와 보고서 작성",
        created_at: today,
      },
    ];
    let missing = false,
      failSave = false,
      oldSchema = false,
      writes = 0;
    const accountState = await installAccountMock(context, { members });
    await page.route("**/rest/v1/**", async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      if (url.pathname.endsWith("/projects"))
        return route.fulfill({ json: projects });
      if (url.pathname.endsWith("/team_members"))
        return route.fulfill({ json: members });
      if (!url.pathname.endsWith("/department_events"))
        return route.fulfill({ json: [] });
      if (missing)
        return route.fulfill({
          status: 404,
          json: { code: "PGRST205", message: "missing table" },
        });
      if (req.method() === "GET") {
        const start = url.searchParams.get("ends_on")?.slice(4);
        const end = url.searchParams.get("starts_on")?.slice(4);
        return route.fulfill({
          json: rows.filter(
            (r) => !r.deleted_at && r.starts_on <= end && r.ends_on >= start,
          ),
        });
      }
      writes++;
      if (failSave)
        return route.fulfill({
          status: 503,
          json: { message: "테스트 연결 실패" },
        });
      if (oldSchema)
        return route.fulfill({
          status: 400,
          json: { code: "PGRST204", message: "created_by column missing" },
        });
      const body = req.postDataJSON();
      if (req.method() === "POST") {
        const row = {
          ...body,
          id: `e${rows.length + 1}`,
          updated_at: stamp(),
          deleted_at: null,
        };
        rows.push(row);
        return route.fulfill({ json: row });
      }
      const row = rows.find(
        (r) =>
          r.id === url.searchParams.get("id")?.slice(3) &&
          r.updated_at === url.searchParams.get("updated_at")?.slice(3),
      );
      for (const key of ["created_by", "creator_name", "creator_color"]) {
        assert.equal(Object.hasOwn(body, key), false, "Shared edits must not send creator fields.");
      }
      if (!row) return route.fulfill({ json: null });
      Object.assign(row, body, { updated_at: stamp() });
      return route.fulfill({ json: row });
    });
    await page.goto(baseURL);
    await page.getByRole("heading", { name: "함께 계획하는 하루" }).waitFor();
    // The team calendar is inline on the team tab; leaving for the garage tab replaces the old close/reopen.
    const calendar = page.getByTestId("team-calendar-inline");
    const dialog = page.getByRole("dialog", { name: /^(새 부서 일정|부서 일정 수정)$/ });
    async function openCalendar() {
      await calendar.waitFor();
      await page.getByRole("button", { name: "일정 등록", exact: true }).waitFor();
    }
    async function closeCalendar() {
      await page.getByTestId("hub-tab-garage").click();
      await page.getByTestId("garage").waitFor();
      await page.getByTestId("hub-tab-team").click();
      await calendar.waitFor();
    }
    await calendar.waitFor();
    assert.equal(await page.getByRole("dialog", { name: "우리 팀 공유 달력", exact: true }).count(), 0, "The team calendar is inline, not a dialog.");
    await page.getByLabel("과업 검색").fill("후포");
    assert.equal(await page.locator("aside a").count(), 1);
    assert.equal(
      await page.locator("aside a").getAttribute("href"),
      "/projects/p3",
    );
    await page.getByLabel("과업 검색").fill("");
    await openCalendar();
    await page.getByRole("button", { name: "회의 부서 주간회의", exact: false }).waitFor();
    // Switching tabs keeps month, category and author filters.
    await page.getByRole("button", { name: "다음 달", exact: true }).click();
    const viewedMonth = await calendar.getByRole("heading", { name: /^\d{4}\. \d{2}$/ }).textContent();
    await page.getByRole("button", { name: "업무", exact: true }).click();
    await page.getByLabel("등록자", { exact: true }).selectOption("mine");
    await closeCalendar();
    await openCalendar();
    assert.equal(await calendar.getByRole("heading", { name: /^\d{4}\. \d{2}$/ }).textContent(), viewedMonth);
    assert.equal(await page.getByRole("button", { name: "업무", exact: true }).getAttribute("aria-pressed"), "true");
    assert.equal(await page.getByLabel("등록자", { exact: true }).inputValue(), "mine");
    await page.getByRole("button", { name: "필터 초기화", exact: true }).click();
    await page.getByRole("button", { name: "오늘", exact: true }).click();
    await page.getByRole("button", { name: "회의 부서 주간회의", exact: false }).waitFor();
    // Escape closes only the inner editor; focus returns to the calendar.
    await page.getByRole("button", { name: "일정 등록", exact: true }).click();
    await dialog.getByLabel("일정명", { exact: true }).fill("닫기 동작 확인");
    // Another window switches to the garage: the editor portal hides too, and the draft comes back with the team tab.
    await page.evaluate(() => { localStorage.setItem("teams-hub-view", "garage"); window.dispatchEvent(new StorageEvent("storage", { key: "teams-hub-view" })); });
    await page.getByTestId("garage").waitFor();
    await dialog.waitFor({ state: "hidden" });
    await page.getByTestId("hub-tab-team").click();
    await dialog.waitFor();
    assert.equal(await dialog.getByLabel("일정명", { exact: true }).inputValue(), "닫기 동작 확인", "The draft must survive a hidden tab.");
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    assert.equal(await calendar.isVisible(), true);
    await page.waitForFunction(() => document.querySelector('[data-testid="team-calendar-inline"]')?.contains(document.activeElement)).catch(async (error) => {
      console.error("Nested dialog focus:", await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 1000)));
      await page.screenshot({ path: "artifacts/calendar-focus-failure.png", fullPage: true });
      throw error;
    });
    // Rows changed while I was in the garage appear when I come back.
    rows = [...rows, { id: "e-away", title: "자리 비운 사이 일정", category: "meeting", starts_on: today, ends_on: today, starts_at: null, location: "", organizer: "", note: "", updated_at: stamp(), deleted_at: null }];
    await closeCalendar();
    await calendar.getByRole("button", { name: /자리 비운 사이 일정/ }).first().waitFor({ timeout: 10000 });
    rows = rows.filter((row) => row.id !== "e-away");
    await closeCalendar();
    await calendar.getByRole("button", { name: /자리 비운 사이 일정/ }).first().waitFor({ state: "detached", timeout: 10000 });
    // The signed-in account becomes the author; legacy events remain readable.
    await page.getByRole("button", { name: "일정 등록", exact: true }).click();
    assert.equal(await dialog.getByLabel("유형", { exact: true }).inputValue(), "work");
    await dialog.getByLabel("일정명", { exact: true }).fill("금요일 부서 회식");
    await dialog.getByLabel("유형", { exact: true }).selectOption("dinner");
    await dialog.getByLabel("장소", { exact: true }).fill("부서 식당");
    await dialog.getByLabel("시작 시간", { exact: false }).fill("18:30");
    await dialog.getByRole("button", { name: "저장", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    assert.equal(rows.length, 2);
    assert.equal(rows[1].created_by, members[0].id);
    assert.equal(rows[1].creator_name, members[0].name);
    assert.equal(rows[1].creator_color, members[0].color);
    await page.getByRole("button", { name: "회식", exact: true }).click();
    assert.equal(
      await page.locator('button[title^="회의 · 부서 주간회의 ·"]').count(),
      0,
    );
    await page.getByRole("button", { name: "전체", exact: true }).click();
    // Another authenticated account can edit content without taking over authorship.
    accountState.useMember(1);
    await page.reload();
    await openCalendar();
    await page.locator('button[title^="회식 · 금요일 부서 회식 ·"]').click();
    await dialog.getByText("등록자 김민수", { exact: true }).waitFor();
    await dialog
      .getByLabel("일정명", { exact: true })
      .fill("부서 회식 장소 변경");
    await dialog.getByRole("button", { name: "저장", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    assert.equal(rows[1].title, "부서 회식 장소 변경");
    assert.equal(rows[1].created_by, members[0].id);
    assert.equal(rows[1].creator_name, members[0].name);
    assert.equal(rows[1].creator_color, members[0].color);
    await page.reload();
    await openCalendar();
    await page.locator('button[title^="회식 · 부서 회식 장소 변경 ·"]').waitFor();
    await page.locator('button[title^="회식 · 부서 회식 장소 변경 ·"]').click();
    await dialog.getByRole("button", { name: "삭제", exact: true }).click();
    await dialog
      .getByRole("button", { name: "삭제 확인", exact: true })
      .click();
    await dialog.waitFor({ state: "hidden" });
    assert.ok(rows[1].deleted_at);
    // Undo must refresh the displayed month, even after navigating away.
    await page.getByRole("button", { name: "다음 달", exact: true }).click();
    await page.getByText("일정을 불러오고 있습니다.", { exact: true }).waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "되돌리기", exact: true }).click();
    await page.getByText("일정을 복원했습니다.", { exact: true }).waitFor();
    await page.getByText("일정을 불러오고 있습니다.", { exact: true }).waitFor({ state: "hidden", timeout: 5000 });
    assert.equal(await page.getByRole("button", { name: "일정 등록", exact: true }).isEnabled(), true);
    await page.getByRole("button", { name: "이전 달", exact: true }).click();
    await page.locator('button[title^="회식 · 부서 회식 장소 변경 ·"]').waitFor();
    assert.equal(rows[1].deleted_at, null);
    // Conflict: another member edits while this editor is open.
    await page.locator('button[title^="회식 · 부서 회식 장소 변경 ·"]').click();
    rows[1].updated_at = stamp();
    await dialog
      .getByLabel("일정명", { exact: true })
      .fill("덮어쓰면 안 되는 내용");
    await dialog.getByRole("button", { name: "저장", exact: true }).click();
    await page
      .getByText("다른 부서원이 이 일정을 변경했습니다.", { exact: false })
      .waitFor();
    assert.equal(rows[1].title, "부서 회식 장소 변경");
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    // Save failure keeps the form and its contents.
    await page.getByRole("button", { name: "일정 등록", exact: true }).click();
    await dialog.getByLabel("일정명", { exact: true }).fill("실패 시 보존");
    failSave = true;
    await dialog.getByRole("button", { name: "저장", exact: true }).click();
    await page.getByText("테스트 연결 실패", { exact: true }).waitFor();
    assert.equal(
      await dialog.getByLabel("일정명", { exact: true }).inputValue(),
      "실패 시 보존",
    );
    failSave = false;
    oldSchema = true;
    await dialog.getByRole("button", { name: "저장", exact: true }).click();
    await page.getByText("업무 일정과 등록자 표시를 위한 업데이트가 필요합니다.", { exact: false }).waitFor();
    assert.equal(await dialog.getByLabel("일정명", { exact: true }).inputValue(), "실패 시 보존");
    oldSchema = false;
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    // Authored work schedules distinguish their creator from their organizer.
    await page.getByRole("button", { name: "일정 등록", exact: true }).click();
    await dialog.getByLabel("일정명", { exact: true }).fill("제안서 초안 작성");
    assert.equal(await dialog.getByLabel("유형", { exact: true }).inputValue(), "work");
    await dialog.getByLabel("담당자·참석자", { exact: true }).fill("김민수");
    await dialog.getByRole("button", { name: "저장", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    const work = rows.find((row) => row.title === "제안서 초안 작성");
    assert.equal(work.created_by, members[1].id);
    assert.equal(work.creator_name, "이지은");
    assert.equal(work.organizer, "김민수");
    const workButton = page.locator('button[title^="업무 · 제안서 초안 작성 ·"]');
    await workButton.waitFor();
    await page.getByLabel("등록자", { exact: true }).selectOption("mine");
    await workButton.waitFor();
    assert.equal(await page.locator('button[title^="회식 ·"]').count(), 0);
    await page.getByRole("button", { name: "업무", exact: true }).click();
    await workButton.waitFor();
    await page.getByLabel("등록자", { exact: true }).selectOption(members[0].id);
    assert.equal(await workButton.count(), 0);
    await page.getByText("선택한 유형·등록자의 일정이 없어요.", { exact: true }).waitFor();
    await page.getByRole("button", { name: "전체", exact: true }).click();
    await page.locator('button[title^="회식 · 부서 회식 장소 변경 ·"]').waitFor();
    await page.getByLabel("등록자", { exact: true }).selectOption("unassigned");
    await page.locator('button[title^="회의 · 부서 주간회의 ·"]').waitFor();
    assert.equal(await workButton.count(), 0);
    // Editing an older row must leave its unassigned author intact.
    await page.locator('button[title^="회의 · 부서 주간회의 ·"]').click();
    await dialog.getByText("등록자 미지정", { exact: true }).waitFor();
    await dialog.getByLabel("메모", { exact: true }).fill("기존 일정도 함께 수정할 수 있어요.");
    await dialog.getByRole("button", { name: "저장", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    assert.equal(rows[0].created_by, undefined);
    await page.getByRole("button", { name: "필터 초기화", exact: true }).click();
    // Multi-day leave crosses the month/year boundary.
    await page.getByRole("button", { name: "일정 등록", exact: true }).click();
    await dialog.getByLabel("일정명", { exact: true }).fill("연말 휴가");
    await dialog.getByLabel("유형", { exact: true }).selectOption("leave");
    await dialog.getByLabel("시작일", { exact: true }).fill("2026-12-31");
    await dialog.getByLabel("종료일", { exact: true }).fill("2027-01-02");
    await dialog.getByRole("button", { name: "저장", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    await page
      .getByRole("heading", { name: "2026. 12", exact: true })
      .waitFor();
    await page.getByRole("button", { name: "다음 달", exact: true }).click();
    await page
      .getByRole("heading", { name: "2027. 01", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "2027-01-01 일정 보기", exact: true })
      .click();
    await page
      .getByRole("button", { name: "휴가 연말 휴가", exact: false })
      .waitFor();
    await page.getByRole("button", { name: "오늘", exact: true }).click();
    await page.locator('button[title^="회의 · 부서 주간회의 ·"]').waitFor();
    fs.mkdirSync(path.resolve("artifacts"), { recursive: true });
    await page.waitForFunction(
      () => document.querySelectorAll("[data-sonner-toast]").length === 0,
    );
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: "artifacts/calendar-desktop.png",
      fullPage: true,
    });
    await closeCalendar();
    await page.screenshot({
      path: "artifacts/dashboard-desktop.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await calendar.waitFor();
    await page.screenshot({ path: "artifacts/dashboard-mobile.png", fullPage: true });
    await openCalendar();
    await page
      .getByRole("button", { name: "회의 부서 주간회의", exact: false })
      .waitFor();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      ),
      false,
    );
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: "artifacts/calendar-mobile.png",
      fullPage: true,
    });
    // Another member's change becomes visible when returning to this window.
    rows[0].title = "다른 부서원이 수정한 회의";
    rows[0].updated_at = stamp();
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.getByRole("button", { name: "회의 다른 부서원이 수정한 회의", exact: false }).waitFor();
    // Table absent: explicit error instead of pretending there are no events.
    missing = true;
    await page
      .getByRole("button", { name: "일정 새로고침", exact: true })
      .click();
    await page
      .getByText("부서 일정 저장소가 아직 준비되지 않았습니다.", {
        exact: false,
      })
      .waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "일정 등록", exact: true })
        .isDisabled(),
      true,
    );
    await closeCalendar();
    assert.equal(await page.locator("aside a").count(), 3);
    assert.deepEqual(errors, []);
    console.log(
      "PASS: inline team calendar, month/filters kept across tabs, nested editor focus, search/navigation links, account-authored work, combined member/category filters, immutable creator and legacy authorship, create/edit/reload/delete/undo across month navigation, concurrency conflict, save/schema failures, year boundary, mobile overflow, missing table. Mock writes:",
      writes,
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
