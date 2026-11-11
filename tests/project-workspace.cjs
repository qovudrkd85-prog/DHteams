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
    // Monotonic fake clock for project_memos.updated_at (the optimistic-lock token).
    let clock = Date.parse("2026-01-01T00:00:00Z");
    const stamp = () => new Date((clock += 1000)).toISOString();
    // Schedules carry updated_at (the D6 lock token) except t3, which stands for a DB without the column.
    schedules.forEach((row) => { if (row.id !== "t3") row.updated_at = stamp(); });
    const schedulePatches = [];
    const schedulePosts = [];
    const memos = new Map([
      [month, { content: "이번 달 원래 메모", updated_at: stamp() }],
      [nextMonth, { content: "다음 달 원래 메모", updated_at: stamp() }],
    ]);
    const memoSelects = [];
    const memoWrites = [];
    const logWrites = [];
    let holdSave = null;
    let nextLoad = null;
    let failSave = false;
    let failLogs = false;
    let scheduleGets = 0;
    // D7: project_memo_items starts missing (DB without the SQL) so the memo checks above run on the fallback editor.
    let itemsMissing = true;
    const memoItems = [];
    const itemPosts = [];
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
        if (method === "POST") {
          // D8 quick add from the week board.
          schedulePosts.push(body);
          const input = Array.isArray(body) ? body[0] : body;
          const at = stamp();
          const row = { ...input, id: `new${schedulePosts.length}`, project_id: "p1", done: false, created_at: at, updated_at: at, deleted_at: null };
          schedules.push(row);
          return route.fulfill({ status: 201, json: { ...row } });
        }
        if (method === "PATCH") {
          const row = schedules.find((s) => `eq.${s.id}` === url.searchParams.get("id"));
          const expected = url.searchParams.get("updated_at");
          schedulePatches.push({ id: row && row.id, expected, liveOnly: url.searchParams.get("deleted_at") === "is.null", body });
          if (!row) return route.fulfill({ status: 404, json: { message: "no schedule row" } });
          // Conditional update: a stale token or a deleted row matches nothing (PostgREST returns no row).
          if (expected !== null && (expected !== `eq.${row.updated_at}` || (url.searchParams.get("deleted_at") === "is.null" && row.deleted_at))) {
            return route.fulfill({ json: null });
          }
          Object.assign(row, body);
          // The trigger bumps updated_at only where the column exists.
          if ("updated_at" in row) row.updated_at = stamp();
          return route.fulfill({ json: { ...row } });
        }
        scheduleGets++;
        return route.fulfill({ json: schedules.filter((row) => Boolean(row.deleted_at) === deleted) });
      }
      if (table === "project_memos") {
        if (method === "GET") {
          const key = url.searchParams.get("month").slice(3);
          memoSelects.push(url.searchParams.get("select") || "");
          if (key === nextMonth && nextLoad) await nextLoad.promise;
          const row = memos.get(key);
          return route.fulfill({ json: row ? [{ ...row }] : [] });
        }
        memoWrites.push({ method, body });
        const blocked = holdSave;
        holdSave = null;
        if (blocked) await blocked.promise;
        if (failSave) return route.fulfill({ status: 503, json: { message: "테스트 저장 실패" } });
        if (method === "POST") {
          // Insert only: an existing row is a unique violation, like the real primary key.
          if (memos.has(body.month)) return route.fulfill({ status: 409, json: { code: "23505", message: "duplicate key value" } });
          const updatedAt = body.updated_at || stamp();
          memos.set(body.month, { content: body.content, updated_at: updatedAt });
          return route.fulfill({ status: 201, json: { updated_at: updatedAt } });
        }
        // PATCH ... updated_at=eq.<base>: a stale base matches no row.
        const key = url.searchParams.get("month").slice(3);
        const row = memos.get(key);
        if (!row || url.searchParams.get("updated_at") !== `eq.${row.updated_at}`) return route.fulfill({ json: null });
        const updatedAt = body.updated_at || stamp();
        memos.set(key, { content: body.content, updated_at: updatedAt });
        return route.fulfill({ json: { updated_at: updatedAt } });
      }
      if (table === "project_memo_items") {
        if (itemsMissing) return route.fulfill({ status: 404, json: { code: "PGRST205", message: "Could not find the table 'public.project_memo_items' in the schema cache" } });
        if (method === "GET") {
          const key = url.searchParams.get("month").slice(3);
          const live = memoItems.filter((row) => row.month === key && !row.deleted_at);
          return route.fulfill({ json: live.sort((a, b) => b.created_at.localeCompare(a.created_at)).map((row) => ({ ...row })) });
        }
        if (method === "POST") {
          itemPosts.push(body);
          const input = Array.isArray(body) ? body[0] : body;
          // The server trigger stamps the author; the client never sends it.
          const at = stamp();
          const row = { id: `mi${memoItems.length + 1}`, project_id: input.project_id, month: input.month, content: input.content, created_by: "11111111-1111-4111-8111-111111111111", creator_name: "김담당", created_at: at, updated_at: at, deleted_at: null };
          memoItems.push(row);
          return route.fulfill({ status: 201, json: { ...row } });
        }
        // PATCH id=eq.<id>&updated_at=eq.<token>: a stale token matches no row.
        const row = memoItems.find((r) => `eq.${r.id}` === url.searchParams.get("id"));
        if (!row || url.searchParams.get("updated_at") !== `eq.${row.updated_at}`) return route.fulfill({ json: null });
        Object.assign(row, body, { updated_at: stamp() });
        return route.fulfill({ json: { ...row } });
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

    // A teammate's new schedule appears on window focus without a page reload.
    const fireFocus = () => page.evaluate(() => window.dispatchEvent(new Event("focus")));
    const peerDay = `${month}-${today.slice(8) === "28" ? "27" : "28"}`;
    const peerCell = page.locator(`[data-day="${peerDay}"]`);
    const peer = { id: "peer1", project_id: "p1", title: "동료가 추가한 일정", due_date: peerDay, assignee: "박동료", note: null, color: "pink", done: false, created_at: today, deleted_at: null };
    schedules.push(peer);
    await fireFocus();
    await peerCell.getByRole("button", { name: "동료가 추가한 일정", exact: true }).waitFor();
    // An open edit dialog blocks the refresh: typed text and the dialog stay.
    await todayCell.getByRole("button", { name: "오늘 일정 1", exact: true }).click();
    const editDialog = page.getByRole("dialog");
    const editTitle = editDialog.getByLabel("할 일", { exact: true });
    await editTitle.fill("입력 중인 제목");
    peer.title = "동료가 고친 일정";
    const getsBefore = scheduleGets;
    await fireFocus();
    await page.waitForTimeout(500);
    assert.equal(scheduleGets, getsBefore, "No background reload while the edit dialog is open.");
    assert.equal(await editTitle.inputValue(), "입력 중인 제목");
    assert.equal(await editDialog.isVisible(), true);
    await page.keyboard.press("Escape");
    await editDialog.waitFor({ state: "hidden" });
    assert.equal(schedules.find((s) => s.id === "t1").title, "오늘 일정 1", "Closing without saving writes nothing.");
    // Remove the pushed row so later calendar assertions see the original data.
    schedules.splice(schedules.indexOf(peer), 1);
    await fireFocus();
    await peerCell.getByRole("button", { name: "동료가 고친 일정", exact: true }).waitFor({ state: "hidden" });
    await peerCell.getByRole("button", { name: "동료가 추가한 일정", exact: true }).waitFor({ state: "hidden" });
    assert.equal(await todayCell.getByRole("checkbox").count(), 3);

    // D6: toggle done, then edit right away. The toggle is unconditional and its
    // returned row refreshes updated_at, so the edit right after is not a conflict.
    const saveButton = editDialog.getByRole("button", { name: "저장", exact: true });
    const t1 = schedules.find((s) => s.id === "t1");
    const t2 = schedules.find((s) => s.id === "t2");
    const t3 = schedules.find((s) => s.id === "t3");
    const toggleResponse = page.waitForResponse((response) => response.url().includes("/schedules") && response.request().method() === "PATCH");
    await todayCell.getByRole("checkbox").nth(1).click();
    await toggleResponse;
    assert.equal(t2.done, true);
    assert.equal(schedulePatches.at(-1).expected, null, "Toggling done saves without a condition.");
    await todayCell.getByRole("button", { name: "오늘 일정 2", exact: true }).click();
    await editTitle.fill("완료 후 바로 고친 제목");
    await saveButton.click();
    await editDialog.waitFor({ state: "hidden" });
    assert.ok(String(schedulePatches.at(-1).expected).startsWith("eq."), "An edit sends the updated_at it read.");
    assert.ok(schedulePatches.at(-1).liveOnly, "A conditional edit only matches a live row.");
    assert.equal(t2.title, "완료 후 바로 고친 제목", "Edit right after a toggle must not be a conflict.");

    // Conflict: a teammate saved after we opened the dialog. Ours is kept, the chip shows theirs.
    const conflictToast = page.getByText("다른 팀원이 이 일정을 먼저 수정했습니다. 최신 내용을 확인한 뒤 다시 저장해 주세요.", { exact: true });
    await todayCell.getByRole("button", { name: "오늘 일정 1", exact: true }).click();
    await editTitle.fill("내가 고친 일정 제목");
    const openedToken = t1.updated_at;
    t1.title = "동료가 먼저 고친 제목";
    t1.updated_at = stamp();
    await saveButton.click();
    await conflictToast.waitFor();
    await todayCell.getByText("동료가 먼저 고친 제목", { exact: true }).waitFor();
    assert.equal(schedulePatches.at(-1).expected, `eq.${openedToken}`);
    assert.equal(t1.title, "동료가 먼저 고친 제목", "A stale edit must not overwrite the teammate.");
    assert.equal(await editDialog.isVisible(), true, "The dialog stays open after a conflict.");
    assert.equal(await editTitle.inputValue(), "내가 고친 일정 제목", "My input stays after a conflict.");
    await saveButton.click();
    await editDialog.waitFor({ state: "hidden" });
    assert.equal(t1.title, "내가 고친 일정 제목", "Saving again after the conflict succeeds.");

    // A row without updated_at (column not yet in the DB) saves with no condition.
    await todayCell.getByRole("button", { name: "오늘 일정 3", exact: true }).click();
    await editTitle.fill("칼럼 없는 일정 수정");
    await saveButton.click();
    await editDialog.waitFor({ state: "hidden" });
    assert.equal(schedulePatches.at(-1).id, "t3");
    assert.equal(schedulePatches.at(-1).expected, null, "No updated_at means no condition in the PATCH URL.");
    assert.equal(t3.title, "칼럼 없는 일정 수정");

    // A teammate deleted the row while we edited: the dialog closes with a notice.
    await todayCell.getByRole("button", { name: "완료 후 바로 고친 제목", exact: true }).click();
    await editTitle.fill("삭제된 일정에 쓴 제목");
    t2.deleted_at = new Date().toISOString();
    t2.updated_at = stamp();
    await saveButton.click();
    await page.getByText("삭제된 일정입니다", { exact: true }).waitFor();
    await editDialog.waitFor({ state: "hidden" });
    assert.equal(t2.title, "완료 후 바로 고친 제목");
    // Put it back so the trash test below sees only its own row.
    t2.deleted_at = null;
    await fireFocus();
    await todayCell.getByRole("button", { name: "완료 후 바로 고친 제목", exact: true }).waitFor();

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
    assert.equal(memos.get(month).content, "월 전환 직전 메모");

    // An older slow save must finish before the newest change is sent.
    const slowSave = deferred();
    holdSave = slowSave;
    const beforeSerial = memoWrites.length;
    await memo.fill("느린 첫 저장");
    const firstRequest = page.waitForRequest((request) => request.method() === "PATCH" && request.url().includes("/project_memos"));
    await memo.blur();
    await firstRequest;
    await memo.fill("마지막 저장 내용");
    await memo.blur();
    assert.equal(memoWrites.length, beforeSerial + 1, "The second write waits for the first.");
    slowSave.resolve();
    await page.getByText("저장됨", { exact: true }).waitFor();
    assert.equal(memos.get(month).content, "마지막 저장 내용");
    assert.equal(memoWrites.length, beforeSerial + 2);

    failSave = true;
    await memo.fill("실패 후 재시도 메모");
    await memo.blur();
    await page.getByText("저장 실패", { exact: true }).waitFor();
    assert.equal(await memo.inputValue(), "실패 후 재시도 메모");
    failSave = false;
    await page.getByRole("button", { name: "다시 시도", exact: true }).click();
    await page.getByText("저장됨", { exact: true }).waitFor();
    assert.equal(memos.get(month).content, "실패 후 재시도 메모");

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

    // Idle refresh: memo not focused and nothing pending, a teammate's text arrives on focus.
    await memo.evaluate((el) => el.blur());
    memos.set(month, { content: "동료가 새로 쓴 메모", updated_at: stamp() });
    await fireFocus();
    await page.waitForFunction((label) => document.querySelector(`[aria-label="${label}"]`)?.value === "동료가 새로 쓴 메모", `${month} 주요사항`);

    // Conflict: a teammate saved after we read. Our text stays, theirs is shown read-only.
    const conflictText = page.getByText("다른 팀원이 먼저 수정했습니다", { exact: true });
    const peerBox = page.getByTestId("memo-peer");
    const keepMine = page.getByRole("button", { name: "내 글로 저장", exact: true });
    const usePeer = page.getByRole("button", { name: "동료 내용 사용", exact: true });
    assert.equal(await keepMine.count(), 0, "Conflict buttons appear only during a conflict.");
    memos.set(month, { content: "동료 글", updated_at: stamp() });
    await memo.fill("내가 쓰던 글");
    await memo.blur();
    await conflictText.waitFor();
    assert.equal(await memo.inputValue(), "내가 쓰던 글");
    await peerBox.getByText("동료가 저장한 내용", { exact: true }).waitFor();
    await peerBox.getByText("동료 글", { exact: true }).waitFor();
    assert.equal(memos.get(month).content, "동료 글", "A stale save must not overwrite the teammate.");
    await keepMine.click();
    await page.getByText("저장됨", { exact: true }).waitFor();
    assert.equal(memos.get(month).content, "내가 쓰던 글");
    assert.equal(await peerBox.count(), 0);
    assert.equal(await keepMine.count(), 0);
    // Second conflict, this time take the teammate's text.
    memos.set(month, { content: "동료 글 두 번째", updated_at: stamp() });
    await memo.fill("버릴 내 글");
    await memo.blur();
    await conflictText.waitFor();
    const writesBeforeUsePeer = memoWrites.length;
    await usePeer.click();
    await page.waitForFunction((label) => document.querySelector(`[aria-label="${label}"]`)?.value === "동료 글 두 번째", `${month} 주요사항`);
    await usePeer.waitFor({ state: "hidden" });
    assert.equal(memos.get(month).content, "동료 글 두 번째");
    assert.equal(memoWrites.length, writesBeforeUsePeer, "Taking the teammate's text writes nothing.");
    // Switching month during a conflict must not drop my unsaved text.
    memos.set(month, { content: "동료 글 세 번째", updated_at: stamp() });
    await memo.fill("월 전환해도 남을 내 글");
    await memo.blur();
    await conflictText.waitFor();
    await page.locator("button:has(svg.lucide-chevron-right)").click();
    await page.waitForFunction((label) => document.querySelector(`[aria-label="${label}"]`)?.value === "다음 달 원래 메모", `${nextMonth} 주요사항`);
    await page.locator("button:has(svg.lucide-chevron-left)").click();
    await page.waitForFunction((label) => document.querySelector(`[aria-label="${label}"]`)?.value === "월 전환해도 남을 내 글", `${month} 주요사항`);
    await conflictText.waitFor();
    await peerBox.getByText("동료 글 세 번째", { exact: true }).waitFor();
    assert.equal(memos.get(month).content, "동료 글 세 번째", "Returning to the month must not save over the teammate.");
    await keepMine.click();
    await page.getByText("저장됨", { exact: true }).waitFor();
    assert.equal(memos.get(month).content, "월 전환해도 남을 내 글");

    // Height: a long memo scrolls inside a capped textarea and the header counts lines.
    await memo.fill(Array.from({ length: 100 }, (_, i) => `${i + 1}번째 줄`).join("\n"));
    await memo.blur();
    await page.getByText("저장됨", { exact: true }).waitFor();
    await page.getByText("100줄", { exact: true }).waitFor();
    const box = await memo.boundingBox();
    assert.ok(box && box.height <= 242, `Memo textarea must stay short, got ${box && box.height}px.`);
    assert.equal(memos.get(month).content.split("\n").length, 100);
    assert.ok(memoSelects.length > 0 && memoSelects.every((select) => select.includes("content") && select.includes("updated_at")), `Memo reads must select content and updated_at: ${memoSelects.join(" | ")}`);
    await page.getByRole("button", { name: "설계보고서.hwp", exact: true }).click();
    await actor.waitFor();
    assert.equal(await actor.inputValue(), "", "A reloaded log keeps the cleared actor.");

    // D7: with project_memo_items present the month notes become items with authors.
    itemsMissing = false;
    for (let i = 1; i <= 8; i++) {
      const at = stamp();
      memoItems.push({ id: `old${i}`, project_id: "p1", month, content: `주요사항 ${i}`, created_by: null, creator_name: i % 2 ? "김민수" : "이지은", created_at: at, updated_at: at, deleted_at: null });
    }
    await page.goto(`${baseURL}/projects/p1`);
    await openSchedule();
    const itemsBox = page.getByTestId("memo-items");
    const itemRows = itemsBox.locator("li");
    const itemRow = (content) => itemsBox.getByTitle(content, { exact: true });
    await itemRow("주요사항 8").waitFor();
    assert.equal(await page.getByRole("textbox", { name: `${month} 주요사항`, exact: true }).count(), 0, "No single memo textarea when items exist.");
    assert.equal(await itemRows.count(), 5);
    await itemsBox.getByRole("button", { name: "3건 더 보기", exact: true }).waitFor();
    await itemsBox.getByText("8건", { exact: true }).waitFor();
    const rowTexts = await itemRows.allInnerTexts();
    assert.ok(rowTexts[0].includes("주요사항 8"), `Newest first: ${rowTexts[0]}`);
    assert.ok(rowTexts.every((text) => /김민수|이지은/.test(text)), `Every row shows its author: ${rowTexts.join(" | ")}`);
    await itemsBox.getByRole("button", { name: "3건 더 보기", exact: true }).click();
    assert.equal(await itemRows.count(), 8);
    await itemsBox.getByRole("button", { name: "접기", exact: true }).click();
    assert.equal(await itemRows.count(), 5);

    // Add with Enter: only project, month and text go to the server; the new item is on top.
    const addInput = page.getByRole("textbox", { name: `${month} 주요사항 추가`, exact: true });
    await addInput.fill("새로 적은 주요사항");
    await addInput.press("Enter");
    await itemRow("새로 적은 주요사항").waitFor();
    const posted = Array.isArray(itemPosts.at(-1)) ? itemPosts.at(-1)[0] : itemPosts.at(-1);
    assert.deepEqual(Object.keys(posted).sort(), ["content", "month", "project_id"], "POST must not carry author fields.");
    assert.ok((await itemRows.first().innerText()).includes("새로 적은 주요사항"));
    assert.ok((await itemRows.first().innerText()).includes("김담당"));
    assert.equal(await addInput.inputValue(), "");
    await itemsBox.getByText("9건", { exact: true }).waitFor();

    // Esc cancels an edit without writing.
    const editInput = page.getByRole("textbox", { name: `${month} 주요사항 고치기`, exact: true });
    await itemRow("주요사항 6").click();
    await editInput.fill("취소할 글");
    await editInput.press("Escape");
    await itemRow("주요사항 6").waitFor();
    assert.equal(memoItems.find((r) => r.id === "old6").content, "주요사항 6");

    // Edit conflict: a teammate changed the item after we read it. My text stays.
    const old8 = memoItems.find((r) => r.id === "old8");
    await itemRow("주요사항 8").click();
    await editInput.fill("내가 고친 주요사항");
    old8.content = "동료가 고친 주요사항";
    old8.updated_at = stamp();
    await editInput.press("Enter");
    await itemsBox.getByText("다른 팀원이 이 항목을 먼저 고쳤습니다", { exact: true }).waitFor();
    assert.equal(await editInput.inputValue(), "내가 고친 주요사항");
    assert.equal(old8.content, "동료가 고친 주요사항", "A stale edit must not overwrite the teammate.");
    await editInput.press("Enter");
    await itemRow("내가 고친 주요사항").waitFor();
    assert.equal(old8.content, "내가 고친 주요사항", "Saving again after the conflict succeeds.");

    // Delete, then undo from the toast.
    const old7 = memoItems.find((r) => r.id === "old7");
    await itemRow("주요사항 7").hover();
    await itemsBox.getByRole("button", { name: "주요사항 7 지우기", exact: true }).click();
    await itemRow("주요사항 7").waitFor({ state: "hidden" });
    assert.ok(old7.deleted_at, "Delete is a soft delete.");
    await page.getByRole("button", { name: "되돌리기", exact: true }).click();
    await itemRow("주요사항 7").waitFor();
    assert.equal(old7.deleted_at, null);

    // A teammate's new item arrives on focus.
    const peerAt = stamp();
    memoItems.push({ id: "peer-item", project_id: "p1", month, content: "동료가 방금 올린 주요사항", created_by: null, creator_name: "이지은", created_at: peerAt, updated_at: peerAt, deleted_at: null });
    await addInput.evaluate((el) => el.blur());
    await fireFocus();
    await itemRow("동료가 방금 올린 주요사항").waitFor();
    assert.ok((await itemRows.first().innerText()).includes("동료가 방금 올린 주요사항"));

    // D8: [월|주] toggle in the header row and the week board (to-dos only, no DB change).
    const addDaysKey = (key, n) => new Date(Date.parse(`${key}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
    const monday = addDaysKey(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7));
    const wed = addDaysKey(monday, 2);
    const thu = addDaysKey(monday, 3);
    const nextWed = addDaysKey(monday, 9);
    const weekRow = (id, title, due_date, extra = {}) => ({ id, project_id: "p1", title, due_date, assignee: null, note: null, color: "green", done: false, created_at: stamp(), updated_at: stamp(), deleted_at: null, ...extra });
    const w1 = weekRow("w1", "주간 할 일 A", wed, { assignee: "이지은" });
    const w2 = weekRow("w2", "주간 할 일 B", wed);
    const w3 = weekRow("w3", "주간 완료 일", wed, { done: true });
    schedules.push(w1, w2, w3, weekRow("w4", "다음 주 할 일", nextWed));
    await page.goto(`${baseURL}/projects/p1`);
    await openSchedule();
    const viewToggle = page.getByRole("group", { name: "달력 보기", exact: true });
    const board = page.getByTestId("week-board");
    const dayCells = board.locator("[data-week-day]");
    await page.locator(`[data-day="${today}"]`).waitFor();
    assert.equal(await board.count(), 0, "Month view is the default.");
    await viewToggle.getByRole("button", { name: "주", exact: true }).click();
    await dayCells.first().waitFor();
    assert.equal(await dayCells.count(), 7);
    assert.equal(await dayCells.first().getAttribute("data-week-day"), monday, "The week starts on Monday.");
    assert.equal(await board.locator('[data-today="true"]').getAttribute("data-week-day"), today);
    assert.equal(await page.locator(`[data-day="${today}"]`).count(), 0, "The month grid is replaced by the board.");
    assert.equal(await page.getByTestId("month-todo").count(), 0, "Month todo list is hidden in week mode.");
    // The choice survives a reload (localStorage).
    await page.goto(`${baseURL}/projects/p1`);
    await openSchedule();
    await dayCells.first().waitFor();
    assert.equal(await dayCells.count(), 7);

    // Wednesday: open rows with the assignee name; the done one behind the week fold.
    const wedCell = board.locator(`[data-week-day="${wed}"]`);
    const rowOf = (cell, title) => cell.locator("[data-week-row]").filter({ hasText: title });
    await rowOf(wedCell, "주간 할 일 A").waitFor();
    await rowOf(wedCell, "주간 할 일 B").waitFor();
    assert.ok((await rowOf(wedCell, "주간 할 일 A").innerText()).includes("이지은"), "The assignee name is shown.");
    assert.equal(await rowOf(wedCell, "주간 완료 일").count(), 0, "Done rows start folded.");
    await board.getByRole("button", { name: /^완료 \d+건 보기$/ }).click();
    await rowOf(wedCell, "주간 완료 일").waitFor();
    await board.getByRole("button", { name: /^완료 \d+건 숨기기$/ }).click();
    await rowOf(wedCell, "주간 완료 일").waitFor({ state: "hidden" });

    // Quick add on Thursday: Enter posts once, no dialog, input cleared and still focused.
    const thuCell = board.locator(`[data-week-day="${thu}"]`);
    const thuAdd = board.getByRole("textbox", { name: `${thu} 할 일 추가`, exact: true });
    await thuAdd.fill("측량 준비");
    await thuAdd.press("Enter");
    await rowOf(thuCell, "측량 준비").waitFor();
    assert.equal(schedulePosts.length, 1);
    const quick = Array.isArray(schedulePosts[0]) ? schedulePosts[0][0] : schedulePosts[0];
    assert.equal(quick.due_date, thu);
    assert.equal(quick.title, "측량 준비");
    assert.ok(!("kind" in quick) && !("sort_order" in quick), `D8 posts no block columns: ${Object.keys(quick).join(",")}`);
    assert.equal(await page.getByRole("dialog").count(), 0, "Quick add opens no dialog.");
    assert.equal(await thuAdd.inputValue(), "");
    assert.equal(await thuAdd.evaluate((el) => el === document.activeElement), true, "Focus stays in the add input.");
    await thuAdd.press("Enter");
    await page.waitForTimeout(300);
    assert.equal(schedulePosts.length, 1, "Enter on an empty add input posts nothing.");

    // Checkbox: unconditional PATCH {done:true}.
    const doneResponse = page.waitForResponse((response) => response.url().includes("/schedules") && response.request().method() === "PATCH");
    await rowOf(wedCell, "주간 할 일 B").getByRole("checkbox").click();
    await doneResponse;
    assert.deepEqual(schedulePatches.at(-1).body, { done: true });
    assert.equal(w2.done, true);
    await board.getByRole("button", { name: /^완료 \d+건 보기$/ }).click();

    // Inline rename: click the text, Enter saves with the D6 updated_at condition.
    const rowEdit = board.getByRole("textbox", { name: "할 일 고치기", exact: true });
    await rowOf(wedCell, "주간 할 일 A").getByRole("button", { name: "주간 할 일 A", exact: true }).click();
    await rowEdit.fill("주간 할 일 A 수정");
    await rowEdit.press("Enter");
    await rowOf(wedCell, "주간 할 일 A 수정").getByRole("button", { name: "주간 할 일 A 수정", exact: true }).waitFor();
    assert.equal(schedulePatches.at(-1).body.title, "주간 할 일 A 수정");
    assert.ok(String(schedulePatches.at(-1).expected).startsWith("eq."), "A rename sends the updated_at it read.");
    assert.equal(w1.title, "주간 할 일 A 수정");
    // Conflict: a teammate saved first. Toast, my text stays, the teammate's row is kept.
    await rowOf(wedCell, "주간 할 일 A 수정").getByRole("button", { name: "주간 할 일 A 수정", exact: true }).click();
    await rowEdit.fill("내 주간 수정");
    w1.title = "동료 주간 수정";
    w1.updated_at = stamp();
    await rowEdit.press("Enter");
    await conflictToast.first().waitFor();
    assert.equal(await rowEdit.inputValue(), "내 주간 수정", "My input stays after a conflict.");
    assert.equal(w1.title, "동료 주간 수정", "A stale rename must not overwrite the teammate.");
    await rowEdit.press("Escape");
    await rowOf(wedCell, "동료 주간 수정").waitFor();

    // Emptied row + Backspace deletes (soft) with an undo toast.
    await rowOf(wedCell, "주간 완료 일").getByRole("button", { name: "주간 완료 일", exact: true }).click();
    await rowEdit.fill("");
    await rowEdit.press("Backspace");
    await rowOf(wedCell, "주간 완료 일").waitFor({ state: "hidden" });
    assert.ok(w3.deleted_at, "Delete is a soft delete.");
    await page.getByRole("button", { name: "되돌리기", exact: true }).last().click();
    await rowOf(wedCell, "주간 완료 일").waitFor();
    assert.equal(w3.deleted_at, null);

    // Week navigation.
    await page.getByRole("button", { name: "다음 주", exact: true }).click();
    await rowOf(board.locator(`[data-week-day="${nextWed}"]`), "다음 주 할 일").waitFor();
    assert.equal(await dayCells.first().getAttribute("data-week-day"), addDaysKey(monday, 7));
    await page.getByRole("button", { name: "이번 주", exact: true }).click();
    await board.locator(`[data-week-day="${monday}"]`).waitFor();

    // Focus refresh: a teammate's row arrives while I type; my add text stays.
    await thuAdd.fill("치는 중");
    schedules.push(weekRow("w5", "동료 주간 줄", thu));
    await fireFocus();
    await rowOf(thuCell, "동료 주간 줄").waitFor();
    assert.equal(await thuAdd.inputValue(), "치는 중");
    await thuAdd.fill("");

    // Phone width: days stack vertically, no sideways scroll inside the board.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    const xs = await dayCells.evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().x)));
    assert.equal(new Set(xs).size, 1, `Stacked days share one x: ${xs.join(",")}`);
    assert.ok(await board.evaluate((el) => el.scrollWidth <= el.clientWidth), "No sideways scroll in the board.");
    await page.setViewportSize({ width: 1440, height: 1080 });

    // Back to the month grid: the quick-added row is on its date.
    await viewToggle.getByRole("button", { name: "월", exact: true }).click();
    const thuMonthCell = page.locator(`[data-day="${thu}"]`);
    if (await thuMonthCell.count()) {
      const more = thuMonthCell.getByRole("button", { name: /건 더 보기$/ });
      if (await more.count()) await more.click();
      await thuMonthCell.getByRole("button", { name: "측량 준비", exact: true }).waitFor();
    }
    assert.equal(await board.count(), 0);
    assert.deepEqual(errors, []);
    console.log("PASS: cleared log actor, failed log drafts/retry and checkbox rollback, memo month switching/loading, ordered saves/retry, restored schedule refresh, day cell 3-cap fold, month todo open/done fold, focus refresh adds a peer schedule and skips while editing, schedule toggle-then-edit/conflict/no-column/deleted, memo idle refresh, memo conflict keep-mine/use-peer/kept across month switch, capped memo height (all on the fallback editor); D7 memo items fold/author/add without author fields/esc/edit conflict/delete undo/peer refresh; D8 week toggle/remembered view/done fold/quick add/toggle/rename conflict/delete undo/week nav/peer refresh/phone stack.");
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
