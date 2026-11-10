/* eslint-disable @typescript-eslint/no-require-imports -- Local-only hub flow verification (team room, garage, healing). */
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
    const panel = page.getByRole("region", { name: "팀원과 출퇴근", exact: true });
    const me = state.db.team_members[0];
    const other = state.db.team_members[1];
    async function until(predicate, label) {
      for (let attempt = 0; attempt < 100; attempt++) {
        if (predicate()) return;
        await page.waitForTimeout(50);
      }
      throw new Error(label);
    }
    async function openTab(id) {
      await page.getByTestId(`hub-tab-${id}`).click();
      await page.waitForFunction((tab) => document.querySelector(`[data-testid="hub-tab-${tab}"]`)?.getAttribute("aria-selected") === "true", id);
    }

    // Team tab: inline calendar + team room mini view, no calendar dialog.
    await page.goto(baseURL);
    await page.getByTestId("team-calendar-inline").waitFor();
    await page.getByTestId("team-room").waitFor();
    assert.equal(await page.getByRole("dialog", { name: "우리 팀 공유 달력", exact: true }).count(), 0);

    // Another account's seated character is visible in the room.
    await page.waitForFunction(() => document.querySelector('[data-testid="team-desk-occupied-desk"]')?.getAttribute("data-seated") === "true");
    assert.equal(await page.getByTestId("team-desk-occupied-desk").getAttribute("data-member-id"), other.id);

    // Status retry keeps the draft; the saved status reaches the shared roster.
    await panel.getByLabel("내 상태 메시지", { exact: true }).fill("오후 보고서 집중 중");
    state.account.failStatus = true;
    await panel.getByRole("button", { name: "저장", exact: true }).click();
    await panel.getByText("상태 메시지 저장 연결 실패", { exact: true }).waitFor();
    assert.equal(await panel.getByLabel("내 상태 메시지", { exact: true }).inputValue(), "오후 보고서 집중 중");
    state.account.failStatus = false;
    await panel.getByRole("button", { name: "저장", exact: true }).click();
    await until(() => me.status_message === "오후 보고서 집중 중", "Status was not saved.");

    // Sitting down reserves my desk once and shows me seated; standing keeps the reservation.
    const sit = page.getByTestId("team-room-sit");
    await page.waitForFunction(() => !document.querySelector('[data-testid="team-room-sit"]')?.hasAttribute("disabled"));
    await sit.click();
    await page.getByTestId("team-room-stand").waitFor();
    assert.equal(state.requests.filter((request) => request.endpoint === "seat").length, 1, "Sitting must reserve the desk exactly once.");
    await page.waitForFunction((memberId) => document.querySelector(`[data-member-id="${memberId}"][data-seated="true"]`) !== null, me.id);
    assert.equal(await page.getByTestId("team-desk-occupied-desk").getAttribute("data-member-id"), other.id, "Another member's desk stays theirs.");
    await page.getByTestId("team-room-stand").click();
    await sit.waitFor();

    // The chosen tab survives a reload.
    await openTab("garage");
    await page.getByTestId("garage").waitFor();
    await page.getByTestId("garage-calendar").waitFor();
    await page.reload();
    await page.getByTestId("garage").waitFor();

    // Garage -> healing place (inline, no modal) -> activity -> back with Esc.
    await page.route("https://api.open-meteo.com/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ current: { weather_code: 61, is_day: 1, temperature_2m: 14.2 } }) }));
    await page.getByTestId("healing-open").click();
    const place = page.getByTestId("healing-place");
    await place.waitFor();
    assert.equal(await page.getByTestId("healing-overlay").count(), 0, "Healing opens inline, not as a modal.");
    assert.equal(await page.getByTestId("garage").count(), 0, "The healing place replaces the garage area.");
    await page.getByTestId("healing-weather").filter({ hasText: "비" }).waitFor();
    await page.getByTestId("healing-effect-rain").waitFor();
    const scene = page.getByTestId("healing-scene");
    await page.waitForFunction(() => document.querySelector("[data-testid=healing-scene]")?.getAttribute("data-scene") === "rooftop", null, { timeout: 10000 });
    assert.match(await place.getAttribute("aria-label"), /옥상 쉼터/, "Rain should start me on the rooftop.");
    await until(() => me.status_message !== "오후 보고서 집중 중", "Healing must show teammates I am resting.");
    // Fast travel chip, then the activity button walks me to the rod and fishing starts on arrival.
    await page.getByRole("button", { name: /낚시터/ }).click();
    await page.waitForFunction(() => document.querySelector("[data-testid=healing-scene]")?.getAttribute("data-scene") === "fishing");
    await page.getByTestId("healing-activity-fishing").click();
    await page.waitForFunction(() => document.querySelector("[data-testid=healing-avatar]")?.getAttribute("data-activity") === "fishing", null, { timeout: 15000 });
    fs.mkdirSync(path.resolve("artifacts", "logs"), { recursive: true });
    const shot = await page.screenshot({ path: path.resolve("artifacts", "logs", "healing-fishing.png") });
    assert.ok(shot.length > 30_000, "World screenshot looks empty.");
    // One continuous world: holding left walks off the pier straight onto the beach, no portal.
    await scene.focus();
    await page.keyboard.down("ArrowLeft");
    await page.waitForFunction(() => document.querySelector("[data-testid=healing-scene]")?.getAttribute("data-scene") === "beach", null, { timeout: 15000 });
    await page.keyboard.up("ArrowLeft");
    await page.waitForFunction(() => document.querySelector("[data-testid=healing-avatar]")?.getAttribute("data-activity") === "rest", null, { timeout: 5000 });
    await page.getByTestId("healing-close").focus();
    await page.keyboard.press("Escape");
    await place.waitFor({ state: "detached" });
    await page.getByTestId("garage").waitFor();
    await until(() => me.status_message === "오후 보고서 집중 중", "Leaving healing must restore my status.");

    // A trip to the team tab ends healing for good: coming back shows the garage, not healing.
    await page.getByTestId("healing-open").click();
    await place.waitFor();
    await openTab("team");
    await page.getByTestId("team-room").waitFor();
    await openTab("garage");
    await page.getByTestId("garage").waitFor();
    await page.waitForTimeout(400);
    assert.equal(await place.count(), 0, "Healing must not reappear after visiting the team tab.");
    await until(() => me.status_message === "오후 보고서 집중 중", "Switching tabs must restore my status.");

    // Mobile: no horizontal document scroll on either tab; a tap on the world walks there.
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "Garage must fit the mobile width.");
    await page.getByTestId("healing-open").click();
    await place.waitFor();
    const before = Number(await page.getByTestId("healing-scene").getAttribute("data-x"));
    const spot = await page.evaluate(() => {
      const world = document.querySelector("[data-testid=healing-scene]");
      const r = world.getBoundingClientRect();
      for (let fy = 0.3; fy <= 0.7; fy += 0.05) for (let fx = 0.1; fx <= 0.9; fx += 0.1) {
        const x = r.left + r.width * fx;
        const y = r.top + r.height * fy;
        if (world.contains(document.elementFromPoint(x, y))) return { x, y };
      }
      return null;
    });
    assert.ok(spot, "Some part of the world must be tappable on mobile.");
    await page.mouse.click(spot.x, spot.y);
    await page.waitForFunction((start) => Number(document.querySelector("[data-testid=healing-scene]")?.getAttribute("data-x")) !== start, before, { timeout: 10000 });
    await page.getByTestId("healing-close").click();
    await page.getByTestId("garage").waitFor();
    await openTab("team");
    await page.getByTestId("team-room").waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "Team tab must fit the mobile width.");
    await page.screenshot({ path: path.resolve("artifacts", "game-world-mobile.png"), fullPage: true });
    assert.deepEqual(errors, []);
    console.log("PASS: inline team calendar and room, other member seated, status retry, sit once/stand, tab memory across reload, garage -> inline healing (weather start zone, fast travel, walk to rod, seam walk, Esc back, status restore), no healing after team tab trip, mobile width + tap to walk.");
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
