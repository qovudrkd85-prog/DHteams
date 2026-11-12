/* eslint-disable @typescript-eslint/no-require-imports -- Local-only runner mini-game verification (garage healing window). */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const { installGameWorldMock } = require("./helpers/game-world-mock.cjs");
const baseURL = process.env.TEST_BASE_URL || "http://localhost:3001";
if (!["localhost", "127.0.0.1"].includes(new URL(baseURL).hostname)) throw new Error("Only a local test server is allowed.");

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1100 }, timezoneId: "Asia/Seoul" });
    await installGameWorldMock(context);
    // Weather is mocked too: nothing leaves the machine.
    await context.route("https://api.open-meteo.com/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ current: { weather_code: 0, is_day: 1, temperature_2m: 18 } }) }));
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const attr = (testId, name) => page.evaluate(([id, key]) => document.querySelector(`[data-testid="${id}"]`)?.getAttribute(key) ?? null, [testId, name]);
    const phase = () => attr("runner-scene", "data-phase");
    const distance = async () => Number(await attr("runner-scene", "data-distance"));
    const walkSpot = async () => ({ x: await attr("healing-scene", "data-x"), y: await attr("healing-scene", "data-y") });
    const waitPhase = (value, timeout = 5000) => page.waitForFunction((want) => document.querySelector("[data-testid=runner-scene]")?.getAttribute("data-phase") === want, value, { timeout });

    // Garage tab -> small healing window.
    await page.goto(baseURL);
    await page.getByTestId("team-calendar-inline").waitFor();
    await page.getByTestId("hub-tab-garage").click();
    await page.getByTestId("garage").waitFor();
    await page.getByTestId("healing-open").click();
    const place = page.getByTestId("healing-place");
    await place.waitFor();
    await page.getByTestId("healing-weather").filter({ hasText: "지금" }).waitFor();
    await page.waitForTimeout(500);

    // 1. Starts walking: no runner, walk scene shown; the toggle hides in the settings fold.
    assert.equal(await page.getByTestId("runner-scene").count(), 0, "No runner before choosing 달리기.");
    assert.ok(await page.getByTestId("healing-scene").isVisible(), "The walk scene shows first.");
    assert.equal(await page.getByTestId("healing-mode-run").isVisible(), false, "The mode toggle sits inside the closed fold.");
    const walkBefore = await walkSpot();

    // 2. Fold open -> 달리기: runner ready, walk scene still in the DOM but hidden.
    await place.locator("summary").click();
    await page.getByTestId("healing-mode-run").click();
    await waitPhase("ready", 15000);
    assert.equal(await page.getByTestId("healing-scene").count(), 1, "The walk scene stays mounted.");
    assert.equal(await page.getByTestId("healing-scene").isVisible(), false, "The walk scene is hidden while running.");

    // 3. Space on a calendar button never reaches the game.
    await page.getByTestId("garage-calendar").getByRole("button", { name: "오늘", exact: true }).first().focus();
    await page.keyboard.press("Space");
    await page.waitForTimeout(1000);
    assert.equal(await phase(), "ready", "Space outside the game must not start it.");

    // 4. Typing a space in the status field stays in the field.
    const status = page.getByLabel("내 상태 메시지", { exact: true });
    const savedStatus = await status.inputValue();
    await status.focus();
    await page.keyboard.type("a b");
    assert.ok((await status.inputValue()).includes("a b"), "The space must be typed into the field.");
    assert.equal(await phase(), "ready", "Typing must not start the game.");
    await status.fill(savedStatus);

    // 5. Tap the game: it runs, then (no jumps) falls off the 20 m runway.
    await page.getByTestId("runner-scene").click();
    await waitPhase("running");
    await page.waitForFunction(() => Number(document.querySelector("[data-testid=runner-scene]")?.getAttribute("data-distance")) > 2, null, { timeout: 3000 });
    await waitPhase("over", 8000);
    const fell = await distance();
    assert.ok(fell >= 20 && fell <= 24, `First fall should be just past the runway (got ${fell}).`);
    assert.ok(Number(await attr("runner-scene", "data-best")) >= 20, "The best score is kept after a run.");

    // 6. After the 0.5 s lock, Space restarts from the start.
    await page.waitForTimeout(600);
    await page.keyboard.press("Space");
    await waitPhase("running");
    assert.ok(await distance() < 5, "Restart begins at the start.");

    // 7. Long hold flies longer than a tap (spans of data-air="true", measured in the page).
    await page.evaluate(() => {
      const el = document.querySelector("[data-testid=runner-scene]");
      window.__airSpans = [];
      let since = el.getAttribute("data-air") === "true" ? performance.now() : null;
      new MutationObserver(() => {
        const air = el.getAttribute("data-air") === "true";
        if (air && since === null) since = performance.now();
        else if (!air && since !== null) { window.__airSpans.push(performance.now() - since); since = null; }
      }).observe(el, { attributes: true, attributeFilter: ["data-air"] });
    });
    await page.keyboard.down("Space");
    await page.waitForTimeout(300);
    await page.keyboard.up("Space");
    await page.waitForFunction(() => window.__airSpans.length >= 1, null, { timeout: 3000 });
    await page.waitForTimeout(150);
    await page.keyboard.down("Space");
    await page.waitForTimeout(30);
    await page.keyboard.up("Space");
    await page.waitForFunction(() => window.__airSpans.length >= 2, null, { timeout: 3000 });
    const [longAir, shortAir] = await page.evaluate(() => window.__airSpans);
    assert.ok(longAir >= 500, `A 300 ms hold should stay up ≥ 0.5 s (got ${Math.round(longAir)} ms).`);
    assert.ok(shortAir < 400, `A 30 ms tap should stay up < 0.4 s (got ${Math.round(shortAir)} ms).`);

    // 8. Keys while running never move the hidden walker (arrows included).
    await page.keyboard.down("ArrowUp");
    await page.keyboard.down("ArrowRight");
    await page.waitForTimeout(400);
    await page.keyboard.up("ArrowUp");
    await page.keyboard.up("ArrowRight");
    assert.deepEqual(await walkSpot(), walkBefore, "The walk scene must not move while running.");

    // 9. Back to 산책: runner gone, walker exactly where it was, and arrows walk again.
    await page.getByTestId("healing-mode-walk").click();
    assert.equal(await page.getByTestId("runner-scene").count(), 0, "Walking removes the runner.");
    assert.ok(await page.getByTestId("healing-scene").isVisible(), "The walk scene is back.");
    assert.deepEqual(await walkSpot(), walkBefore, "The walker keeps its spot.");
    await page.getByTestId("healing-scene").focus();
    await page.keyboard.down("ArrowUp");
    await page.keyboard.down("ArrowRight");
    await page.waitForFunction((start) => {
      const el = document.querySelector("[data-testid=healing-scene]");
      return el?.getAttribute("data-x") !== start.x || el?.getAttribute("data-y") !== start.y;
    }, walkBefore, { timeout: 5000 });
    await page.keyboard.up("ArrowUp");
    await page.keyboard.up("ArrowRight");

    // 10. No page errors.
    assert.deepEqual(errors, []);
    console.log("PASS: runner R2 in the garage healing window (walk first, toggle in fold, lazy runner ready, walk hidden but mounted, Space from calendar/status ignored, tap start, runway fall 20-24 m, best kept, restart after lock, long vs short jump air time, arrows do not move hidden walker, back to walk keeps spot and walks again, no page errors).");
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
