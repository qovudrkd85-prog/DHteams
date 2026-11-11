/* eslint-disable @typescript-eslint/no-require-imports -- Local-only phone-width check of the garage (personal calendar). */
// Runs against a local production server; all session/DB requests are mocked.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const path = require("node:path");
const { installGameWorldMock } = require("./helpers/game-world-mock.cjs");
const baseURL = process.env.TEST_BASE_URL || "http://localhost:3001";
if (!["localhost", "127.0.0.1"].includes(new URL(baseURL).hostname)) throw new Error("Only a local test server is allowed.");

const MIN_TAP = 40;

/** Visible controls inside `root` smaller than the minimum tap size. */
async function smallTargets(locator) {
  return locator.evaluate((root, min) => [...root.querySelectorAll("button, select, input")]
    .filter((el) => {
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && style.visibility !== "hidden" && el.type !== "hidden";
    })
    .map((el) => ({ el, r: el.getBoundingClientRect() }))
    .filter(({ el, r }) => r.height < min - 0.5 || (el.tagName !== "INPUT" && r.width < min - 0.5))
    .map(({ el, r }) => `${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") || el.textContent || el.name || "").trim().slice(0, 20)}" ${Math.round(r.width)}x${Math.round(r.height)}`), MIN_TAP);
}

const fitsWidth = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, timezoneId: "Asia/Seoul" });
    const state = await installGameWorldMock(context);
    await context.addInitScript(() => { try { localStorage.setItem("teams-hub-view", "garage"); } catch { /* storage blocked */ } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(baseURL, { waitUntil: "domcontentloaded" });
    const garage = page.getByTestId("garage");
    const calendar = page.getByTestId("garage-calendar");
    await calendar.waitFor();
    await calendar.getByRole("button", { name: "일정 등록" }).waitFor();

    // 1. The personal calendar comes first on a phone, above the attendance panel.
    const panel = garage.getByRole("region", { name: "팀원과 출퇴근" });
    await panel.waitFor();
    const calTop = (await calendar.boundingBox()).y;
    const panelTop = (await panel.boundingBox()).y;
    assert.ok(calTop < panelTop, `Calendar (${calTop}) must sit above the attendance panel (${panelTop}) on a phone.`);

    // 2. Calendar controls are big enough to tap.
    assert.deepEqual(await smallTargets(calendar), [], "Calendar controls must be at least 40px.");
    assert.ok(await fitsWidth(page), "Garage must fit the phone width.");

    // 3. Event dialog: tappable inputs and fully on screen.
    await calendar.getByRole("button", { name: "일정 등록" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    assert.deepEqual(await smallTargets(dialog), [], "Dialog controls must be at least 40px tall.");
    const box = await dialog.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= 390 + 1, `Dialog must stay inside the phone width (${box.x}..${box.x + box.width}).`);
    assert.ok(await fitsWidth(page), "Open dialog must not widen the page.");

    // 4. Create a private event from the phone.
    await dialog.getByLabel("일정명").fill("폰 개인 일정");
    await dialog.getByRole("button", { name: "저장", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    const posted = state.requests.find((r) => r.table === "department_events" && r.method === "POST");
    assert.ok(posted, "Saving must POST the event.");
    assert.equal(posted.body.visibility, "private", "Garage events must be private.");
    await calendar.getByText("폰 개인 일정").filter({ visible: true }).first().waitFor();

    await page.screenshot({ path: path.resolve("artifacts", "phone-garage.png"), fullPage: true });

    // 5. Desktop keeps the original order: attendance panel above the calendar.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForFunction(() => {
      const cal = document.querySelector('[data-testid="garage-calendar"]');
      const reg = document.querySelector('[data-testid="garage"] [aria-label="팀원과 출퇴근"]');
      return cal && reg && reg.getBoundingClientRect().top < cal.getBoundingClientRect().top;
    }, null, { timeout: 5000 });
    assert.deepEqual(errors, []);
    console.log("PASS: phone garage — calendar first, 40px taps, dialog fits, private event create.");
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
