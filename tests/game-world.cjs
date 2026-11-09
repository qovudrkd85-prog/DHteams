/* eslint-disable @typescript-eslint/no-require-imports -- Local-only movement and shared office verification. */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { installGameWorldMock } = require("./helpers/game-world-mock.cjs");
const baseURL = process.env.TEST_BASE_URL || "http://localhost:3001";
if (!["localhost", "127.0.0.1"].includes(new URL(baseURL).hostname)) throw new Error("Only a local test server is allowed.");

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1100 }, timezoneId: "Asia/Seoul" });
    const state = await installGameWorldMock(context);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const office = page.getByRole("region", { name: "팀 오피스", exact: true });
    const world = page.getByTestId("office-game-world");
    const player = page.getByTestId("office-player");
    const panel = page.getByRole("region", { name: "팀원과 출퇴근", exact: true });
    const rooms = state.db.office_layouts;
    const me = state.db.team_members[0];
    const ownDesk = rooms[0].items.find((item) => item.id === "empty-desk");
    const otherDesk = rooms[0].items.find((item) => item.id === "occupied-desk");
    const position = () => player.evaluate((element) => ({ x: Number(element.getAttribute("data-x")), y: Number(element.getAttribute("data-y")) }));
    const room = (key) => rooms.find((item) => item.room_key === key);
    async function waitRoom(key) {
      await page.waitForFunction((roomId) => document.querySelector('[data-testid="office-player"]')?.getAttribute("data-room-id") === roomId, room(key).id);
    }
    async function waitMotion(motion) {
      await page.waitForFunction((expected) => document.querySelector('[data-testid="office-player"]')?.getAttribute("data-motion") === expected, motion);
    }
    async function holdArrow(key, duration = 260) {
      await page.keyboard.down(key);
      await page.waitForTimeout(duration);
      await page.keyboard.up(key);
    }
    async function until(predicate, label) {
      for (let attempt = 0; attempt < 100; attempt++) {
        if (predicate()) return;
        await page.waitForTimeout(50);
      }
      throw new Error(label);
    }
    async function visitPortal(key) {
      await page.getByTestId(`portal-${key}`).click();
      await waitRoom(key);
    }

    await page.goto(baseURL);
    await world.waitFor();
    await player.waitFor();
    await waitRoom("office-1");
    assert.equal(await page.getByRole("region", { name: "부서 공유 달력", exact: true }).count(), 0);
    for (const layout of rooms) await office.getByRole("button", { name: layout.name, exact: true }).waitFor();

    // The character keeps moving while a direction is held, and stops on release.
    await world.focus();
    const start = await position();
    await holdArrow("ArrowRight");
    const moved = await position();
    assert.ok(moved.x > start.x + 20, "Holding an arrow must continuously move the avatar.");
    assert.ok(Math.abs(moved.y - start.y) < 2, "Horizontal movement must not drift vertically.");
    await page.waitForTimeout(300);
    const stopped = await position();
    assert.ok(Math.abs(stopped.x - moved.x) < 2 && Math.abs(stopped.y - moved.y) < 2, "Releasing the key must stop movement.");
    await until(() => state.requests.some((request) => request.table === "team_presence" && request.method === "POST" && request.body?.x > start.x), "Movement was not synchronized to the shared presence API.");
    // The on-screen direction pad also supports a held keyboard activation.
    const directionButton = office.getByRole("button", { name: "캐릭터 오른쪽으로 이동", exact: true });
    await directionButton.focus();
    const beforePad = await position();
    await holdArrow("Space", 250);
    const afterPad = await position();
    assert.ok(afterPad.x > beforePad.x + 20, "Holding Space on the direction pad must keep moving instead of stopping on focus transfer.");
    await page.waitForTimeout(250);
    assert.ok(Math.abs((await position()).x - afterPad.x) < 2, "Releasing Space on the direction pad must stop movement.");

    // Text fields and modal controls must keep their keyboard behavior.
    await panel.getByLabel("내 상태 메시지", { exact: true }).fill("오후 보고서 집중 중");
    const typing = await position();
    await holdArrow("ArrowLeft");
    assert.deepEqual(await position(), typing, "An arrow inside a text input must not move the avatar.");
    state.account.failStatus = true;
    await panel.getByRole("button", { name: "저장", exact: true }).click();
    await panel.getByText("상태 메시지 저장 연결 실패", { exact: true }).waitFor();
    assert.equal(await panel.getByLabel("내 상태 메시지", { exact: true }).inputValue(), "오후 보고서 집중 중");
    state.account.failStatus = false;
    await panel.getByRole("button", { name: "저장", exact: true }).click();
    await until(() => me.status_message === "오후 보고서 집중 중", "Status was not saved.");
    await office.getByText("오후 보고서 집중 중", { exact: true }).first().waitFor();
    await page.getByRole("button", { name: "일정 확인하기", exact: true }).click();
    const calendar = page.getByRole("dialog", { name: "우리 팀 공유 달력", exact: true });
    await calendar.waitFor();
    const calendarPosition = await position();
    await holdArrow("ArrowRight");
    assert.deepEqual(await position(), calendarPosition, "A calendar dialog must suspend world movement.");
    await calendar.getByRole("button", { name: "달력 닫기", exact: true }).click();
    await calendar.waitFor({ state: "hidden" });
    // A new room starts near its exit, allowing the keyboard portal interaction.
    await office.getByRole("button", { name: room("office-2").name, exact: true }).click();
    await waitRoom("office-2");
    await world.focus();
    await page.keyboard.press("e");
    await waitRoom("outdoor");
    await visitPortal("office-1");

    // Occupied desks stay exclusive. Save failure leaves the reservation unchanged.
    await page.getByTestId("office-item-occupied-desk").click();
    const claim = office.getByRole("button", { name: "내 자리로 선택", exact: true });
    assert.ok(await claim.count() === 0 || await claim.isDisabled(), "Another member's desk cannot be claimed.");
    assert.equal(otherDesk.member_id, state.db.team_members[1].id);
    await page.getByTestId("office-item-empty-desk").click();
    state.failSeat = true;
    await claim.click();
    await page.getByText("자리 선택 저장 연결 실패", { exact: true }).waitFor();
    assert.equal(ownDesk.member_id, null);
    state.failSeat = false;
    await claim.click();
    await until(() => ownDesk.member_id === me.id, "Selecting a desk did not reserve the signed-in member's seat.");
    assert.equal(otherDesk.member_id, state.db.team_members[1].id);
    if (await player.getAttribute("data-motion") === "seated") {
      await office.getByRole("button", { name: "일어나기", exact: true }).click();
      await waitMotion("standing");
    }
    await page.getByTestId("office-item-empty-desk").click();
    await office.getByRole("button", { name: "자리에 앉기", exact: true }).click();
    await waitMotion("seated");
    // Healing time: only from my own seat, real 360° photo, weather overlay, Esc closes.
    await page.route("https://api.open-meteo.com/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ current: { weather_code: 61, is_day: 1, temperature_2m: 14.2 } }) }));
    await page.getByTestId("healing-open").click();
    const healing = page.getByTestId("healing-overlay");
    await healing.waitFor();
    await page.getByTestId("healing-weather").filter({ hasText: "비" }).waitFor();
    await page.getByTestId("healing-effect-rain").waitFor();
    assert.match(await healing.getAttribute("aria-label"), /옥상 쉼터/, "Rain should suggest the rooftop.");
    await page.waitForFunction(() => !document.querySelector("[data-testid=healing-overlay]")?.textContent?.includes("불러오는 중"), null, { timeout: 20000 });
    await page.getByRole("button", { name: /낚시터/ }).click();
    await page.waitForFunction(() => !document.querySelector("[data-testid=healing-overlay]")?.textContent?.includes("불러오는 중"), null, { timeout: 20000 });
    const shotPath = path.resolve(__dirname, "../artifacts/logs/healing-fishing.png");
    const shot = await page.screenshot({ path: shotPath });
    assert.ok(shot.length > 50_000, "Panorama screenshot looks empty.");
    await page.keyboard.press("Escape");
    await healing.waitFor({ state: "detached" });
    await office.getByRole("button", { name: "일어나기", exact: true }).click();
    await waitMotion("standing");
    assert.equal(await page.getByTestId("healing-open").count(), 0, "Healing is only offered while seated.");
    await world.focus();
    const beforeWalking = await position();
    await holdArrow("ArrowDown");
    assert.ok((await position()).y > beforeWalking.y + 10, "The seated character must be able to stand and walk away.");
    assert.equal(ownDesk.member_id, me.id, "Walking away must preserve the desk reservation.");

    // Buildings connect through the shared courtyard and keep desk reservations.
    await visitPortal("outdoor");
    await visitPortal("cafe");
    await visitPortal("outdoor");
    for (const key of ["office-2", "office-3", "office-4"]) {
      await visitPortal(key);
      await visitPortal("outdoor");
    }
    await visitPortal("office-1");
    assert.equal(ownDesk.member_id, me.id);
    await page.reload();
    await world.waitFor();
    await player.waitFor();
    await waitRoom("office-1");
    await panel.getByLabel("내 상태 메시지", { exact: true }).waitFor();
    assert.equal(await panel.getByLabel("내 상태 메시지", { exact: true }).inputValue(), "오후 보고서 집중 중");
    await page.getByTestId("office-item-empty-desk").click();
    await office.getByRole("button", { name: "자리에 앉기", exact: true }).click();
    await waitMotion("seated");
    await page.getByTestId("office-item-empty-desk").click();
    await office.getByRole("button", { name: "자리 예약 해제", exact: true }).click();
    await until(() => ownDesk.member_id === null, "A member must be able to release their own reservation.");
    await waitMotion("standing");
    assert.equal(otherDesk.member_id, state.db.team_members[1].id);

    fs.mkdirSync(path.resolve("artifacts"), { recursive: true });
    await office.getByRole("button", { name: room("outdoor").name, exact: true }).click();
    await waitRoom("outdoor");
    await office.getByRole("button", { name: "전체 보기", exact: true }).click();
    await page.screenshot({ path: "artifacts/game-world-desktop.png", fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await world.scrollIntoViewIfNeeded();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "The game must scroll within its own viewport on mobile.");
    const informationTitle = await office.getByText("각자의 자리, 함께하는 하루", { exact: true }).boundingBox();
    assert.ok(informationTitle.width > 240 && informationTitle.height < 60, "Mobile room information must remain readable instead of collapsing into a narrow grid column.");
    await page.screenshot({ path: "artifacts/game-world-mobile.png", fullPage: true });
    assert.deepEqual(errors, []);
    console.log("PASS: held arrows and keyboard direction pad/release, authenticated shared movement, input/modal keyboard isolation, status retry and bubble, exclusive seat reservation/release, sitting/walking, six room portals and E shortcut, reload persistence, mobile document width.");
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
