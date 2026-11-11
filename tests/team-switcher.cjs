/* eslint-disable @typescript-eslint/no-require-imports -- Local browser verification of the team switcher. */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { installAccountMock } = require("./helpers/account-mock.cjs");
const baseURL = process.env.TEST_BASE_URL || "http://localhost:3001";
if (!["localhost", "127.0.0.1"].includes(new URL(baseURL).hostname)) throw new Error("Only local test servers are allowed.");

const teamB = { id: "00000000-0000-4000-8000-0000000000bb", name: "설계2팀", invite_code: "N4RT8WZB", is_owner: false, can_rotate_code: false };
const teamC = { id: "00000000-0000-4000-8000-0000000000cc", name: "현장지원팀", invite_code: "P9QX2MKA", is_owner: false, can_rotate_code: false };

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const members = [{ id: "00000000-0000-4000-8000-000000000101", name: "김민수", role: "설계팀 · 과장", avatar: "🧑‍💻", color: "#547867", created_at: new Date().toISOString() }];
    const state = await installAccountMock(context, { members });
    const teamA = state.team;
    state.otherTeams = [teamB];
    const teamCalls = [];
    const dataHeaders = [];
    // Several teams per person: active team first in the mock's list is not required, keep joining order.
    const all = () => [teamA, teamB, teamC];
    await context.route("**/api/team", async (route) => {
      const input = route.request().postDataJSON();
      teamCalls.push(input);
      const mine = [state.team, ...state.otherTeams];
      if (input.action === "switch") {
        const target = mine.find((team) => team.id === input.teamId);
        if (!target) return route.fulfill({ status: 403, json: { error: "소속된 팀으로만 바꿀 수 있습니다." } });
        state.otherTeams = all().filter((team) => team.id !== target.id && mine.includes(team));
        state.team = target;
      } else if (input.action === "leave") {
        // Move to the most recently joined remaining team.
        const remaining = all().filter((team) => team !== state.team && state.otherTeams.includes(team));
        state.team = remaining.at(-1) ?? null;
        state.otherTeams = remaining.filter((team) => team !== state.team);
      } else if (input.action === "join") {
        if (input.code !== teamC.invite_code) return route.fulfill({ status: 404, json: { error: "초대코드에 맞는 팀이 없습니다." } });
        state.otherTeams = mine;
        state.team = teamC;
      }
      const account = { id: state.account.id, username: state.account.username, member: state.account.member, team: state.team, teams: all().filter((team) => team && [state.team, ...state.otherTeams].includes(team)).map(({ id, name, is_owner }) => ({ id, name, is_owner })) };
      return route.fulfill({ json: { configured: true, authenticated: true, account } });
    });
    await context.route("**/rest/v1/**", (route) => {
      dataHeaders.push(route.request().headers()["x-teams-team"] ?? null);
      return route.fulfill({ json: route.request().url().includes("/team_members") ? members : [] });
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(baseURL);
    const header = page.locator("header");
    const switcher = header.getByRole("button", { name: /^팀 바꾸기/ });
    await switcher.waitFor();
    assert.match(await switcher.innerText(), /시험 팀/);
    await page.waitForTimeout(500);
    assert.ok(dataHeaders.length > 0 && dataHeaders.every((value) => value === teamA.id), "data requests carry the team on screen");

    // Menu: my teams with the current one checked, then join/create entries.
    await switcher.click();
    const menu = page.getByRole("group", { name: "팀 바꾸기" });
    const teamList = menu.getByRole("list", { name: "내 팀" });
    await menu.waitFor();
    assert.equal(await switcher.getAttribute("aria-expanded"), "true");
    assert.equal(await teamList.getByRole("button").count(), 2);
    assert.equal(await teamList.getByRole("button", { name: /시험 팀/ }).getAttribute("aria-current"), "true");
    assert.equal(await teamList.getByRole("button", { name: /설계2팀/ }).getAttribute("aria-current"), null);
    // Opening focuses the current team; Escape closes and returns focus to the button.
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-current")), "true");
    await page.keyboard.press("Escape");
    await menu.waitFor({ state: "hidden" });
    assert.match(await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? ""), /^팀 바꾸기/);
    await switcher.click();
    await menu.getByRole("button", { name: "초대코드로 참가" }).waitFor();
    await menu.getByRole("button", { name: "새 팀 만들기" }).waitFor();
    fs.mkdirSync("artifacts", { recursive: true });
    await page.screenshot({ path: "artifacts/team-switcher-menu-desktop.png" });

    // Switch: the workspace reloads for the other team.
    dataHeaders.length = 0;
    await teamList.getByRole("button", { name: /설계2팀/ }).click();
    await header.getByRole("button", { name: /^팀 바꾸기/ }).filter({ hasText: "설계2팀" }).waitFor();
    assert.deepEqual(teamCalls.at(-1), { action: "switch", teamId: teamB.id });
    await menu.waitFor({ state: "hidden" });
    await page.waitForTimeout(500);
    assert.ok(dataHeaders.length > 0 && dataHeaders.every((value) => value === teamB.id), "after switching, data requests carry the new team");

    // Join with an invite code while already in teams: three teams, moved to the new one.
    await switcher.click();
    await menu.getByRole("button", { name: "초대코드로 참가" }).click();
    await menu.getByLabel("초대코드").fill("p9qx-2mka");
    await menu.getByRole("button", { name: "참가하기" }).click();
    await header.getByRole("button", { name: /^팀 바꾸기/ }).filter({ hasText: "현장지원팀" }).waitFor();
    assert.deepEqual(teamCalls.at(-1), { action: "join", code: "P9QX2MKA" });
    await switcher.click();
    assert.equal(await teamList.getByRole("button").count(), 3);
    assert.equal(await teamList.getByRole("button", { name: /현장지원팀/ }).getAttribute("aria-current"), "true");
    await page.keyboard.press("Escape");
    await menu.waitFor({ state: "hidden" });

    // Leaving one of several teams (settings > team): the dialog closes and the remaining team opens.
    await header.getByRole("button", { name: "내 설정", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "내 설정" });
    await dialog.getByRole("button", { name: "팀", exact: true }).click();
    await dialog.getByRole("button", { name: "팀 나가기", exact: true }).click();
    await dialog.getByText(/남은 다른 팀으로 이동합니다/).waitFor();
    await dialog.getByRole("button", { name: "팀 나가기", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    await header.getByRole("button", { name: /^팀 바꾸기/ }).filter({ hasText: "설계2팀" }).waitFor();
    assert.deepEqual(teamCalls.at(-1), { action: "leave", expectedTeamId: teamC.id }, "leave names the team on screen");

    // Phone widths: the panel stays inside the screen.
    for (const width of [375, 320]) {
      await page.setViewportSize({ width, height: 760 });
      await switcher.click();
      await menu.waitFor();
      const box = await menu.boundingBox();
      assert.ok(box && box.x >= 0 && box.x + box.width <= width, `panel inside ${width}px: ${JSON.stringify(box)}`);
      await page.screenshot({ path: `artifacts/team-switcher-menu-${width}.png` });
      await page.keyboard.press("Escape");
      await menu.waitFor({ state: "hidden" });
    }
    assert.deepEqual(errors, []);
    console.log("PASS: team switcher lists my teams with the current one checked, switching reloads the workspace with the new team header, joining a third team moves there, Escape returns focus, leave sends the team on screen, panel fits 375px and 320px.");
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
