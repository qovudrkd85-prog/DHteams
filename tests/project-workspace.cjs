/* eslint-disable @typescript-eslint/no-require-imports -- Standalone browser regression harness. */
// Only local pages are opened; all session and database requests are mocked.
const assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { installAccountMock } = require("./helpers/account-mock.cjs");
const baseURL = process.env.TEST_BASE_URL || "http://localhost:3001";
if (!["localhost", "127.0.0.1"].includes(new URL(baseURL).hostname)) {
  throw new Error("Only a local test server is allowed.");
}

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, timezoneId: "Asia/Seoul" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
    const month = today.slice(0, 7);
    const nextDate = new Date(`${month}-01T12:00:00+09:00`);
    nextDate.setUTCMonth(nextDate.getUTCMonth() + 1);
    const nextMonth = nextDate.toISOString().slice(0, 7);
    const project = { id: "p1", name: "기존 과업 회귀 검사", code: null, created_at: today };
    const nodes = [{ id: "n1", project_id: "p1", parent_id: null, name: "설계보고서.hwp", kind: "file", sort_order: 0, created_at: today, deleted_at: null }];
    const logs = [{ id: "l1", node_id: "n1", action: "받음", actor: "김담당", counterpart: null, occurred_on: today, subject: "검토본", detail: null, didas_uploaded: false, created_at: today, deleted_at: null }];
    const schedules = [{ id: "s1", project_id: "p1", title: "복구한 검토 일정", due_date: today, assignee: null, note: null, color: "yellow", done: false, created_at: today, deleted_at: new Date().toISOString() }];
    // Five live items on today (one done) exercise the 3-per-cell cap and the month todo fold.
    // s1 stays index 0 so it is the first item drawn once restored.
    ["오늘 일정 1", "오늘 일정 2", "오늘 일정 3", "오늘 일정 4", "오늘 완료 일정"].forEach((title, i) => {
      schedules.push({ id: `t${i + 1}`, project_id: "p1", title, due_date: today, assignee: null, note: null, color: "blue", done: i === 4, created_at: today, deleted_at: null });
    });
    const memos = new Map([[month, "이번 달 원래 메모"], [nextMonth, "다음 달 원래 메모"]]);
    const memoWrites = [];
    const logWrites = [];
    let holdSave = null;
    let nextLoad = null;
    let failSave = false;
    let failLogs = false;
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      return url.origin === new URL(baseURL).origin ? route.continue() : route.abort();
    });
    await installAccountMock(context, { members: [{ id: "11111111-1111-4111-8111-111111111111", name: "김담당", role: "설계", avatar: "🧑‍💻", color: "#547867", created_at: today }] });
    await page.route("**/rest/v1/**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const table = url.pathname.split("/").at(-1);
      const method = request.method();
      const body = method === "GET" || method === "DELETE" ? null : request.postDataJSON();
      const deleted = url.searchParams.get("deleted_at") === "not.is.null";
      if (method === "DELETE") return route.fulfill({ status: 204 });
      if (table === "projects") return route.fulfill({ json: project });
      if (table === "nodes") return route.fulfill({ json: nodes.filter((row) => Boolean(row.deleted_at) === deleted) });
      if (table === "file_logs") {
        if (method === "PATCH") {
          logWrites.push(body);
          if (failLogs) return route.fulfill({ status: 503, json: { message: "이력 연결 실패" } });
          if (body.actor === null) return route.fulfill({ status: 400, json: { message: "actor must not be null" } });
          Object.assign(logs[0], body);
          return route.fulfill({ json: logs[0] });
        }
        return route.fulfill({ json: logs.filter((row) => Boolean(row.deleted_at) === deleted) });
      }
      if (table === "schedules") {
        if (method === "PATCH") {
          const row = schedules.find((s) => `eq.${s.id}` === url.searchParams.get("id"));
          if (!row) return route.fulfill({ status: 404, json: { message: "no schedule row" } });
          Object.assign(row, body);
          return route.fulfill({ json: row });
        }
        return route.fulfill({ json: schedules.filter((row) => Boolean(row.deleted_at) === deleted) });
      }
      if (table === "project_memos") {
        if (method === "GET") {
          const key = url.searchParams.get("month").slice(3);
          if (key === nextMonth && nextLoad) await nextLoad.promise;
          return route.fulfill({ json: { content: memos.get(key) || "" } });
        }
        memoWrites.push(body);
        const blocked = holdSave;
        holdSave = null;
        if (blocked) await blocked.promise;
        if (failSave) return route.fulfill({ status: 503, json: { message: "테스트 저장 실패" } });
        memos.set(body.month, body.content);
        return route.fulfill({ status: 204 });
      }
      return route.fulfill({ json: [] });
    });

    await page.goto(`${baseURL}/projects/p1`);
    await page.getByRole("button", { name: "설계보고서.hwp", exact: true }).click();
    const actor = page.getByPlaceholder("담당자", { exact: true });
    await actor.waitFor();
    assert.equal(await actor.inputValue(), "김담당");
    await actor.fill("");
    const actorResponse = page.waitForResponse((response) => response.url().includes("/file_logs") && response.request().method() === "PATCH");
    await actor.blur();
    await actorResponse;
    assert.equal(logWrites.at(-1).actor, "", "Clearing a required text field must persist an empty string.");
    // Failed writes keep the server value intact and leave editable text for retry.
    const subject = page.getByPlaceholder("자료명 / 버전", { exact: true });
    failLogs = true;
    await subject.fill("실패 후 다시 저장할 제목");
    await subject.blur();
    await page.getByText("입력한 내용이 아직 저장되지 않았습니다.", { exact: false }).waitFor();
    assert.equal(logs[0].subject, "검토본");
    assert.equal(await subject.inputValue(), "실패 후 다시 저장할 제목");
    const didas = page.getByRole("checkbox", { name: "DIDAS 업로드 완료" });
    const checkboxResponse = page.waitForResponse((response) => response.url().includes("/file_logs") && response.request().method() === "PATCH");
    await didas.click();
    await checkboxResponse;
    assert.equal(await didas.isChecked(), false, "Failed checkbox writes must retain the saved state.");
    assert.equal(logs[0].didas_uploaded, false);
    failLogs = false;
    await page.getByRole("button", { name: "이력 다시 저장", exact: true }).click();
    await page.getByRole("button", { name: "이력 다시 저장", exact: true }).waitFor({ state: "hidden" });
    assert.equal(logs[0].subject, "실패 후 다시 저장할 제목");

    const openSchedule = () => page.getByRole("button", { name: "00_업무일정", exact: true }).click();
    await openSchedule();
    const memo = page.getByRole("textbox", { name: `${month} 주요사항`, exact: true });
    await memo.waitFor();
    await page.waitForFunction((label) => !document.querySelector(`[aria-label="${label}"]`).disabled, `${month} 주요사항`);
    assert.equal(await memo.inputValue(), "이번 달 원래 메모");

    // A busy day shows 3 items plus a fold control that must not open the add dialog.
    const todayCell = page.locator(`[data-day="${today}"]`);
    await todayCell.getByRole("checkbox").first().waitFor();
    assert.equal(await todayCell.getByRole("checkbox").count(), 3);
    await todayCell.getByRole("button", { name: "+2건 더 보기", exact: true }).click();
    await todayCell.getByRole("button", { name: "접기", exact: true }).waitFor();
    assert.equal(await todayCell.getByRole("checkbox").count(), 5);
    assert.equal(await page.getByRole("dialog").count(), 0, "Expanding a day must not open the add dialog.");
    await todayCell.getByRole("button", { name: "접기", exact: true }).click();
    await todayCell.getByRole("button", { name: "+2건 더 보기", exact: true }).waitFor();
    assert.equal(await page.getByRole("dialog").count(), 0, "Folding a day must not open the add dialog.");

    // Month todo lists only open items; done ones sit behind a fold.
    const monthTodo = page.getByTestId("month-todo");
    assert.equal(await monthTodo.getByRole("checkbox").count(), 4);
    assert.equal(await monthTodo.getByText("오늘 완료 일정", { exact: true }).count(), 0);
    assert.equal(await monthTodo.locator('[data-overdue="true"]').count(), 0);
    await monthTodo.getByRole("button", { name: "완료 1건 보기", exact: true }).click();
    await monthTodo.getByText("오늘 완료 일정", { exact: true }).waitFor();
    assert.equal(await monthTodo.getByRole("checkbox").count(), 5);
    await monthTodo.getByRole("button", { name: "완료 1건 숨기기", exact: true }).click();
    await monthTodo.getByRole("button", { name: "완료 1건 보기", exact: true }).waitFor();

    // Leaving before the debounce expires saves the original month. The next
    // month stays empty and disabled until its own data arrives.
    const firstSave = deferred();
    holdSave = firstSave;
    nextLoad = deferred();
    await memo.fill("월 전환 직전 메모");
    await page.locator("button:has(svg.lucide-chevron-right)").click();
    const nextMemo = page.getByRole("textbox", { name: `${nextMonth} 주요사항`, exact: true });
    await nextMemo.waitFor();
    assert.equal(await nextMemo.isDisabled(), true);
    assert.equal(await nextMemo.inputValue(), "");
    firstSave.resolve();
    nextLoad.resolve();
    await page.waitForFunction((label) => !document.querySelector(`[aria-label="${label}"]`).disabled, `${nextMonth} 주요사항`);
    assert.equal(await nextMemo.inputValue(), "다음 달 원래 메모");
    await page.locator("button:has(svg.lucide-chevron-left)").click();
    await page.waitForFunction((label) => document.querySelector(`[aria-label="${label}"]`)?.value === "월 전환 직전 메모", `${month} 주요사항`);
    assert.equal(memos.get(month), "월 전환 직전 메모");

    // An older slow save must finish before the newest change is sent.
    const slowSave = deferred();
    holdSave = slowSave;
    const beforeSerial = memoWrites.length;
    await memo.fill("느린 첫 저장");
    const firstRequest = page.waitForRequest((request) => request.method() === "POST" && request.url().includes("/project_memos"));
    await memo.blur();
    await firstRequest;
    await memo.fill("마지막 저장 내용");
    await memo.blur();
    assert.equal(memoWrites.length, beforeSerial + 1, "The second write waits for the first.");
    slowSave.resolve();
    await page.getByText("저장됨", { exact: true }).waitFor();
    assert.equal(memos.get(month), "마지막 저장 내용");
    assert.equal(memoWrites.length, beforeSerial + 2);

    failSave = true;
    await memo.fill("실패 후 재시도 메모");
    await memo.blur();
    await page.getByText("저장 실패", { exact: true }).waitFor();
    assert.equal(await memo.inputValue(), "실패 후 재시도 메모");
    failSave = false;
    await page.getByRole("button", { name: "다시 시도", exact: true }).click();
    await page.getByText("저장됨", { exact: true }).waitFor();
    assert.equal(memos.get(month), "실패 후 재시도 메모");

    // Restoring a deleted schedule updates the already open calendar.
    assert.equal(await page.getByRole("button", { name: "복구한 검토 일정", exact: true }).count(), 0);
    await page.getByRole("button", { name: "휴지통", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByText("복구한 검토 일정", { exact: true }).waitFor();
    await dialog.getByRole("button", { name: "복구", exact: true }).click();
    await dialog.getByText("휴지통이 비어 있습니다.").waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "복구한 검토 일정", exact: true }).first().waitFor();
    assert.equal(await memo.inputValue(), "실패 후 재시도 메모", "Restoring keeps the calendar month and memo mounted.");
    await page.getByRole("button", { name: "설계보고서.hwp", exact: true }).click();
    await actor.waitFor();
    assert.equal(await actor.inputValue(), "", "A reloaded log keeps the cleared actor.");
    assert.deepEqual(errors, []);
    console.log("PASS: cleared log actor, failed log drafts/retry and checkbox rollback, memo month switching/loading, ordered saves/retry, restored schedule refresh, day cell 3-cap fold, month todo open/done fold.");
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
