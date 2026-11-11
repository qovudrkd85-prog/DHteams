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
    // The garage healing walk asks for the weather as soon as the garage shows.
    await page.route("https://api.open-meteo.com/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ current: { weather_code: 61, is_day: 1, temperature_2m: 14.2 } }) }));
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

    // Team room walking: arrow keys only while the room has focus, tap/click walks there, furniture blocks, sitting stops walking.
    const roomView = page.getByTestId("team-room-view");
    const meInRoom = page.getByTestId("team-room-me");
    await meInRoom.waitFor();
    const roomSpot = async () => ({ x: Number(await meInRoom.getAttribute("data-x")), y: Number(await meInRoom.getAttribute("data-y")) });
    const settled = async () => {
      let last = await roomSpot();
      for (let attempt = 0; attempt < 40; attempt++) {
        await page.waitForTimeout(150);
        const now = await roomSpot();
        if (now.x === last.x && now.y === last.y) return now;
        last = now;
      }
      throw new Error("Team room character never stopped.");
    };
    const roomPoint = (x, y) => page.evaluate(([rx, ry]) => {
      const svg = document.querySelector("[data-testid=team-room-view] svg");
      const point = new DOMPoint(rx, ry).matrixTransform(svg.getScreenCTM());
      return { x: point.x, y: point.y };
    }, [x, y]);
    assert.ok(Number.isFinite((await roomSpot()).x), "Standing me must be drawn in the team room.");
    const typed = await roomSpot();
    await panel.getByLabel("내 상태 메시지", { exact: true }).focus();
    await page.keyboard.down("ArrowRight");
    await page.waitForTimeout(400);
    await page.keyboard.up("ArrowRight");
    assert.equal((await roomSpot()).x, typed.x, "Arrow keys in another field must not walk.");
    await roomView.focus();
    const scrolled = await page.evaluate(() => window.scrollY);
    const keyed = await roomSpot();
    await page.keyboard.down("ArrowRight");
    await page.waitForFunction((start) => Number(document.querySelector("[data-testid=team-room-me]")?.getAttribute("data-x")) > start + 20, keyed.x);
    await page.keyboard.up("ArrowRight");
    assert.equal(await page.evaluate(() => window.scrollY), scrolled, "Arrow keys in the room must not scroll the page.");
    await roomView.scrollIntoViewIfNeeded();
    const floor = await roomPoint(1200, 800);
    const clicked = await settled();
    await page.mouse.click(floor.x, floor.y);
    await page.waitForFunction(([x, y]) => {
      const me = document.querySelector("[data-testid=team-room-me]");
      return Number(me?.getAttribute("data-x")) !== x || Number(me?.getAttribute("data-y")) !== y;
    }, [clicked.x, clicked.y]);
    const arrived = await settled();
    assert.ok(Math.hypot(arrived.x - 1200, arrived.y - 800) < 10, `Clicking free floor must walk there (got ${arrived.x},${arrived.y}).`);
    const deskSpot = await roomPoint(650, 250);
    await page.mouse.click(deskSpot.x, deskSpot.y);
    const stopped = await settled();
    assert.ok(Math.abs(stopped.x - 650) >= 62 + 8 || Math.abs(stopped.y - 250) >= 28 + 6, `Clicking a desk must not walk into it (got ${stopped.x},${stopped.y}).`);
    await sit.click();
    await meInRoom.waitFor({ state: "detached" });
    await page.waitForFunction((memberId) => document.querySelector(`[data-testid^="team-desk-"][data-member-id="${memberId}"]`)?.getAttribute("data-seated") === "true", me.id);
    await roomView.focus();
    await page.keyboard.down("ArrowDown");
    await sit.waitFor();
    await page.keyboard.up("ArrowDown");
    await meInRoom.waitFor();

    // Garage door: walk near first, then E / Enter / button. F sits and stands. Keys never fire from inputs.
    const tabSelected = (tab) => page.evaluate((t) => document.querySelector(`[data-testid="hub-tab-${t}"]`)?.getAttribute("aria-selected") === "true", tab);
    const door = page.getByTestId("team-room-door");
    const enter = page.getByTestId("team-room-enter");
    const stand = page.getByTestId("team-room-stand");
    const doorSpot = { x: Number(await door.getAttribute("data-x")), y: Number(await door.getAttribute("data-y")) };
    const away = await settled();
    assert.ok(Math.hypot(away.x - doorSpot.x, away.y - doorSpot.y) >= 150, "This check must start away from the door.");
    assert.equal(await enter.count(), 0, "The enter button waits until I am near the door.");
    await roomView.focus();
    await page.keyboard.press("e");
    await page.waitForTimeout(200);
    assert.equal(await tabSelected("team"), true, "E far from the door must not leave the team tab.");
    const search = page.getByLabel("과업 검색", { exact: true });
    await search.fill("");
    await search.focus();
    await page.keyboard.type("ef");
    await page.waitForTimeout(300);
    assert.equal(await search.inputValue(), "ef", "Typing in the search field keeps the letters.");
    assert.equal(await tabSelected("team"), true, "Typing e in a field must not enter the garage.");
    assert.equal(await stand.count(), 0, "Typing f in a field must not sit me down.");
    await search.fill("");
    const seatedWrites = () => state.requests.filter((r) => r.table === "team_presence" && r.method !== "GET" && r.body?.motion === "seated").length;
    const seatedBefore = seatedWrites();
    await roomView.focus();
    await page.keyboard.down("f");
    await page.keyboard.down("f");
    await page.keyboard.down("f");
    await page.keyboard.up("f");
    await stand.waitFor();
    await page.waitForTimeout(800);
    assert.equal(await stand.count(), 1, "A held F must not toggle back up.");
    assert.equal(seatedWrites() - seatedBefore, 1, "A held F must save the seat once.");
    // Korean IME: key is "ㄹ" but code stays KeyF.
    await roomView.evaluate((el) => el.dispatchEvent(new KeyboardEvent("keydown", { key: "ㄹ", code: "KeyF", bubbles: true, cancelable: true })));
    await sit.waitFor();
    // After a mouse click on the sit button, focus returns to the room so F still works.
    await sit.click();
    await stand.waitFor();
    await page.keyboard.press("f");
    await sit.waitFor();
    // Tap the door: I walk there and the enter button appears.
    await meInRoom.waitFor();
    await roomView.scrollIntoViewIfNeeded();
    const doorPoint = await roomPoint(doorSpot.x, doorSpot.y);
    await page.mouse.click(doorPoint.x, doorPoint.y);
    await enter.waitFor();
    const atDoor = await settled();
    assert.ok(Math.hypot(atDoor.x - doorSpot.x, atDoor.y - doorSpot.y) < 150, `Tapping the door must walk me near it (got ${atDoor.x},${atDoor.y}).`);
    assert.match(await enter.textContent(), /들어가기/);
    // Korean IME E ("ㄷ", KeyE) enters; the tab is remembered across a reload.
    await roomView.evaluate((el) => el.dispatchEvent(new KeyboardEvent("keydown", { key: "ㄷ", code: "KeyE", bubbles: true, cancelable: true })));
    await page.getByTestId("garage").waitFor();
    assert.equal(await tabSelected("garage"), true, "E near the door enters my garage.");
    await page.reload();
    await page.getByTestId("garage").waitFor();
    assert.equal(await tabSelected("garage"), true, "The garage tab survives a reload.");
    // Coming back: still by the door, no automatic re-entry; the button and Enter both go in.
    await openTab("team");
    await enter.waitFor();
    await page.waitForTimeout(300);
    assert.equal(await tabSelected("team"), true, "Returning to the team tab must not re-enter on its own.");
    await enter.click();
    await page.getByTestId("garage").waitFor();
    await openTab("team");
    await enter.waitFor();
    await roomView.focus();
    await page.keyboard.press("Enter");
    await page.getByTestId("garage").waitFor();
    await openTab("team");
    await meInRoom.waitFor();

    // The chosen tab survives a reload.
    await openTab("garage");
    await page.getByTestId("garage").waitFor();
    await page.getByTestId("garage-calendar").waitFor();
    await page.reload();
    await page.getByTestId("garage").waitFor();

    // Garage: the healing walk is open from the start in the side column (it took the card's place; no modal).
    const place = page.getByTestId("healing-place");
    const scene = page.getByTestId("healing-scene");
    const original = "오후 보고서 집중 중";
    await scene.waitFor();
    assert.equal(await page.getByTestId("healing-open").count(), 0, "No healing card: the walk takes its place.");
    assert.equal(await page.getByTestId("healing-overlay").count(), 0, "Healing opens inline, not as a modal.");
    assert.ok(await page.getByTestId("garage-calendar").isVisible(), "My calendar stays on screen beside the walk.");
    assert.equal(await page.locator('aside[aria-label="과업 목록과 팀 방"] [data-testid="healing-place"]').count(), 1, "Healing sits in the side column.");
    const placeBox = await place.boundingBox();
    assert.ok(placeBox.width <= 380 && placeBox.height <= 420, `Healing window too big (${Math.round(placeBox.width)}x${Math.round(placeBox.height)}).`);
    assert.ok((await scene.boundingBox()).height <= 220, "Healing picture stays small.");
    await page.getByTestId("healing-weather").filter({ hasText: "비" }).waitFor();
    await page.getByTestId("healing-effect-rain").waitFor();
    await page.waitForFunction(() => document.querySelector("[data-testid=healing-scene]")?.getAttribute("data-scene") === "rooftop", null, { timeout: 10000 });
    assert.match(await place.getAttribute("aria-label"), /옥상 쉼터/, "Rain should start me on the rooftop.");
    await page.waitForTimeout(600);
    assert.equal(me.status_message, original, "Just being open must not change my status.");
    // Esc never closes the always-open window.
    await page.getByTestId("garage-calendar").getByRole("button").first().focus();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    assert.equal(await place.count(), 1, "Esc must not close the garage healing window.");
    // Arrow keys walk only from inside the healing area; holding ↑ walks, letting go stops.
    const xOf = async () => Number(await scene.getAttribute("data-x"));
    const steadyX = async (label) => {
      await page.waitForTimeout(400);
      const a = await xOf();
      await page.waitForTimeout(600);
      assert.equal(await xOf(), a, label);
      return a;
    };
    await panel.getByLabel("내 상태 메시지", { exact: true }).focus();
    const typedX = await steadyX("Standing still by default.");
    await page.keyboard.down("ArrowUp");
    await page.waitForTimeout(500);
    await page.keyboard.up("ArrowUp");
    assert.equal(await xOf(), typedX, "Arrow keys in another field must not walk.");
    await scene.click();
    await page.keyboard.down("ArrowUp");
    const upFrom = await xOf();
    await page.waitForFunction((start) => Number(document.querySelector("[data-testid=healing-scene]")?.getAttribute("data-x")) > start + 1, upFrom, { timeout: 5000 });
    await page.keyboard.up("ArrowUp");
    await steadyX("Letting go of ↑ must stop walking.");
    // Start at the fishing place, walk up to its signpost, turn left into the pier: I sit and fish.
    await place.locator("summary").click();
    await page.getByLabel("시작 장소", { exact: true }).selectOption("fishing");
    await page.waitForFunction(() => {
      const el = document.querySelector("[data-testid=healing-scene]");
      return el?.getAttribute("data-scene") === "fishing" && Number(el.getAttribute("data-x")) < 152;
    });
    await scene.focus();
    await page.keyboard.down("ArrowUp");
    await page.waitForFunction(() => Number(document.querySelector("[data-testid=healing-scene]")?.getAttribute("data-x")) >= 167.4, null, { timeout: 25000 });
    await page.keyboard.up("ArrowUp");
    await page.keyboard.down("ArrowLeft");
    await page.waitForFunction(() => document.querySelector("[data-testid=healing-avatar]")?.getAttribute("data-activity") === "fishing", null, { timeout: 10000 });
    await page.keyboard.up("ArrowLeft");
    assert.equal(await scene.getAttribute("data-activity"), "fishing");
    await until(() => me.status_message !== original, "Sitting down to fish must show teammates I am resting.");
    fs.mkdirSync(path.resolve("artifacts", "logs"), { recursive: true });
    const shot = await page.screenshot({ path: path.resolve("artifacts", "logs", "healing-fishing.png") });
    assert.ok(shot.length > 30_000, "Trail screenshot looks empty.");
    // Wide view and back with Esc: the same walk instance (no remount), still fishing, status kept.
    await scene.evaluate((el) => { el.dataset.probe = "same"; });
    await page.getByTestId("healing-wide").click();
    await page.waitForFunction(() => document.querySelector("[data-testid=healing-place]")?.getAttribute("data-wide") === "true");
    const wideBox = await place.boundingBox();
    const shown = await page.evaluate(() => ({ w: document.documentElement.clientWidth, h: document.documentElement.clientHeight }));
    assert.ok(wideBox.width >= shown.w - 1 && wideBox.height >= shown.h - 1, `Wide view must fill the screen (${Math.round(wideBox.width)}x${Math.round(wideBox.height)} of ${shown.w}x${shown.h}).`);
    const cover = await page.evaluate(() => { const el = document.elementFromPoint(800, 20); return document.querySelector("[data-testid=healing-place]").contains(el) ? "" : `${el?.tagName}.${el?.className}`; });
    assert.equal(cover, "", "Nothing covers the wide view.");
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector("[data-testid=healing-place]")?.hasAttribute("data-wide"));
    assert.equal(await scene.getAttribute("data-probe"), "same", "Wide view must not remount the walk.");
    assert.equal(await scene.getAttribute("data-activity"), "fishing", "Still fishing after the wide view.");
    assert.notEqual(me.status_message, original, "The wide view must not end the healing status.");
    assert.ok((await scene.boundingBox()).height <= 220, "Back to the small picture.");
    // ↑ stands me up and back onto the path; my status comes back.
    await scene.focus();
    await page.keyboard.down("ArrowUp");
    await page.waitForFunction(() => document.querySelector("[data-testid=healing-avatar]")?.getAttribute("data-activity") === "walk", null, { timeout: 10000 });
    await page.keyboard.up("ArrowUp");
    await until(() => me.status_message === original, "Standing up must restore my status.");

    // A trip to the team tab and back: the walk is open again.
    await openTab("team");
    await page.getByTestId("team-room").waitFor();
    await openTab("garage");
    await scene.waitFor();
    assert.equal(me.status_message, original, "Coming back must not change my status.");

    // Mobile: no horizontal scroll; a tap in the middle of the picture walks, another tap stops.
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "Garage with the walk must fit the mobile width.");
    await scene.scrollIntoViewIfNeeded();
    const sbox = await scene.boundingBox();
    const before = await xOf();
    await page.mouse.click(sbox.x + sbox.width / 2, sbox.y + sbox.height * 0.4);
    await page.waitForFunction((start) => Number(document.querySelector("[data-testid=healing-scene]")?.getAttribute("data-x")) !== start, before, { timeout: 10000 });
    assert.equal(await scene.getAttribute("data-phase"), "walking", "A tap starts walking.");
    await page.mouse.click(sbox.x + sbox.width / 2, sbox.y + sbox.height * 0.4);
    await page.waitForFunction(() => document.querySelector("[data-testid=healing-scene]")?.getAttribute("data-phase") === "standing", null, { timeout: 5000 });
    await steadyX("A second tap stops.");
    await openTab("team");
    await page.getByTestId("team-room").waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "Team tab must fit the mobile width.");
    // Mobile: a tap on the team room floor walks me there.
    await meInRoom.waitFor();
    const phoneStart = await settled();
    await page.getByTestId("team-room-view").scrollIntoViewIfNeeded();
    const phoneFloor = await roomPoint(400, 800);
    await page.mouse.click(phoneFloor.x, phoneFloor.y);
    await page.waitForFunction((x) => Number(document.querySelector("[data-testid=team-room-me]")?.getAttribute("data-x")) !== x, phoneStart.x);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "Walking must not widen the mobile page.");
    await page.screenshot({ path: path.resolve("artifacts", "game-world-mobile.png"), fullPage: true });
    // Mobile: let the floor walk finish (a tap on the door while still beside it enters at once), then tap the door, then the enter button.
    await settled();
    const phoneDoor = await roomPoint(doorSpot.x, doorSpot.y);
    await page.mouse.click(phoneDoor.x, phoneDoor.y);
    await enter.waitFor();
    await enter.click();
    await page.getByTestId("garage").waitFor();
    assert.equal(await tabSelected("garage"), true, "Mobile: door then button enters the garage.");
    assert.deepEqual(errors, []);
    console.log("PASS: inline team calendar and room, other member seated, status retry, sit once/stand, garage door (two-step E/Enter/button, F sit/stand, IME codes, no keys from inputs), tab memory across reload, garage healing walk open from the start (small, rain -> rooftop, status untouched, no Esc close, keys only from inside, hold-up walks/let-go stops, start place fishing -> signpost -> left into the pier -> fishing + status, wide view + Esc without remount, up to stand + status restore), back after team tab, mobile width + tap walk/stop.");
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
