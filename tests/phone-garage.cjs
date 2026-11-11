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
    // Start not yet checked in, so the compact card's check-in button is exercised.
    const myId = state.db.team_members[0].id;
    state.db.team_attendance.splice(state.db.team_attendance.findIndex((row) => row.member_id === myId), 1);
    await context.addInitScript(() => { try { localStorage.setItem("teams-hub-view", "garage"); } catch { /* storage blocked */ } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    // The shared mock stores only the posted columns; the real DB stamps the date and time, so do that here.
    await page.route("**/rest/v1/team_attendance**", async (route) => {
      const request = route.request();
      if (request.method() !== "POST") return route.fallback();
      const body = request.postDataJSON();
      const row = { id: "10000000-0000-4000-8000-000000000777", member_id: body.member_id, work_date: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date()), checked_in_at: new Date().toISOString(), checked_out_at: null };
      state.db.team_attendance.push(row);
      state.requests.push({ table: "team_attendance", method: "POST", body });
      return route.fulfill({ json: row });
    });
    let statusWrites = 0;
    page.on("request", (request) => { if (request.url().includes("/api/account/status") && request.method() === "PATCH") statusWrites++; });
    await page.goto(baseURL, { waitUntil: "domcontentloaded" });
    const garage = page.getByTestId("garage");
    const calendar = page.getByTestId("garage-calendar");
    await calendar.waitFor();
    await calendar.getByRole("button", { name: "일정 등록" }).waitFor();

    // 1. Phone order: my calendar -> our team (compact) -> healing -> project list.
    const panel = page.getByRole("region", { name: "팀원과 출퇴근" });
    await panel.waitFor();
    assert.equal(await garage.getByRole("region", { name: "팀원과 출퇴근" }).count(), 0, "The team card left the garage column.");
    const tops = [];
    for (const locator of [calendar, panel, page.getByTestId("healing-open"), page.getByTestId("project-list")]) tops.push((await locator.boundingBox()).y);
    assert.deepEqual([...tops].sort((a, b) => a - b), tops, `Phone order must be calendar, team, healing, projects (got ${tops.join(", ")}).`);

    // 2. Calendar controls are big enough to tap.
    assert.deepEqual(await smallTargets(calendar), [], "Calendar controls must be at least 40px.");
    assert.ok(await fitsWidth(page), "Garage must fit the phone width.");

    // 3. Event dialog: tappable inputs and fully on screen.
    await calendar.getByRole("button", { name: "일정 등록" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    // Measure after the open animation (zoom-in from 95%), not mid-way.
    await dialog.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished.catch(() => undefined))));
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

    // 5. Desktop: calendar on the left, a compact team card in the right column.
    await page.setViewportSize({ width: 1280, height: 900 });
    const aside = page.locator("aside[aria-label=\"과업 목록과 팀 방\"]");
    const compact = aside.getByRole("region", { name: "팀원과 출퇴근" });
    await compact.waitFor();
    assert.equal(await garage.getByRole("region", { name: "팀원과 출퇴근" }).count(), 0, "No team card inside the garage column.");
    assert.equal(await aside.getByRole("region", { name: "팀원과 출퇴근" }).count(), 1);
    assert.equal(await compact.getAttribute("data-compact"), "true");
    const cardBox = await compact.boundingBox();
    assert.ok((await calendar.boundingBox()).x < cardBox.x, "Calendar sits left of the team card.");
    assert.ok(cardBox.width <= 380 && cardBox.height <= 420, `Compact card too big (${Math.round(cardBox.width)}x${Math.round(cardBox.height)}).`);
    const attend = compact.getByRole("button", { name: "출근하기" });
    assert.ok((await attend.boundingBox()).width < cardBox.width / 2, "Check-in button is small.");
    const posts = () => state.requests.filter((r) => r.table === "team_attendance" && r.method === "POST").length;
    await attend.click();
    await compact.getByRole("button", { name: "퇴근하기" }).waitFor();
    assert.equal(posts(), 1, "Check-in must POST once.");
    const statusInput = compact.getByLabel("내 상태 메시지", { exact: true });
    const statusSave = compact.getByRole("button", { name: "저장", exact: true });
    const inputBox = await statusInput.boundingBox();
    const saveBox = await statusSave.boundingBox();
    assert.ok(Math.abs((inputBox.y + inputBox.height / 2) - (saveBox.y + saveBox.height / 2)) < 4, "Status input and save share one line.");
    await statusInput.fill("작게 보는 상태");
    await statusSave.click();
    await page.waitForFunction(() => document.querySelector("aside[aria-label=\"과업 목록과 팀 방\"] [aria-label=\"팀원과 출퇴근\"]")?.textContent?.includes("작게 보는 상태"));
    assert.equal(statusWrites, 1, "Saving the status must PATCH once.");
    // The team tab keeps the big card (full-width attendance button).
    await page.getByTestId("hub-tab-team").click();
    await page.getByTestId("team-room").waitFor();
    const bigCard = page.getByRole("region", { name: "팀원과 출퇴근" });
    assert.notEqual(await bigCard.getAttribute("data-compact"), "true");
    const bigButton = bigCard.getByRole("button", { name: "퇴근하기" });
    assert.ok((await bigButton.boundingBox()).width > (await bigCard.boundingBox()).width * 0.7, "Team tab card keeps the full-width button.");
    assert.deepEqual(errors, []);
    console.log("PASS: phone garage — calendar/team/healing/projects order, 40px taps, dialog fits, private event create; desktop compact team card (small check-in, one-line status) and big card on the team tab.");
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
