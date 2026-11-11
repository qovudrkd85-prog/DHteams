/* eslint-disable @typescript-eslint/no-require-imports -- Pure schedule view helpers, no network. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const source = fs.readFileSync(path.resolve(__dirname, "../src/lib/schedule-view.ts"), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
const sandbox = {
  exports: {},
  module: { exports: {} },
  require: (name) => {
    throw new Error(`unexpected import ${name}`);
  },
};
sandbox.exports = sandbox.module.exports;
vm.runInNewContext(outputText, sandbox);
const sv = sandbox.module.exports;
// vm objects come from another realm; compare as plain JSON.
const plain = (value) => JSON.parse(JSON.stringify(value));

const item = (id, due_date, done = false) => ({ id, due_date, done });
const today = "2026-11-11";

// capCell keeps input order and reports the rest as hidden.
const five = [1, 2, 3, 4, 5].map((n) => item(`a${n}`, today, n === 2));
const capped = sv.capCell(five, 3);
assert.deepEqual(plain(capped.shown.map((s) => s.id)), ["a1", "a2", "a3"]);
assert.equal(capped.hidden, 2);
const all = sv.capCell(five, Infinity);
assert.equal(all.shown.length, 5);
assert.equal(all.hidden, 0);
const few = sv.capCell(five.slice(0, 2), 3);
assert.equal(few.shown.length, 2);
assert.equal(few.hidden, 0);
assert.deepEqual(plain(sv.capCell([], 3)), { shown: [], hidden: 0 });
assert.equal(five.length, 5, "capCell must not mutate its input.");

// splitMonthItems: open items by date ascending (stable for same date), done apart.
const mixed = [
  item("m1", "2026-11-20"),
  item("m2", "2026-11-03", true),
  item("m3", "2026-11-05"),
  item("m4", "2026-11-20"),
  item("m5", "2026-11-01"),
];
const split = sv.splitMonthItems(mixed, today);
assert.deepEqual(plain(split.open.map((s) => s.id)), ["m5", "m3", "m1", "m4"]);
assert.deepEqual(plain(split.done.map((s) => s.id)), ["m2"]);
assert.deepEqual(plain(mixed.map((s) => s.id)), ["m1", "m2", "m3", "m4", "m5"], "splitMonthItems must not reorder its input.");

// isOverdue: only not-done items dated before today.
assert.equal(sv.isOverdue(item("o1", "2026-11-10"), today), true);
assert.equal(sv.isOverdue(item("o2", "2026-11-10", true), today), false);
assert.equal(sv.isOverdue(item("o3", today), today), false);
assert.equal(sv.isOverdue(item("o4", "2026-11-12"), today), false);
assert.equal(sv.isOverdue(item("o5", "2025-12-31"), today), true);

// shouldRefreshSchedules: visible page, no open dialog, no write in flight.
assert.equal(sv.shouldRefreshSchedules({ visible: true, editing: false, mutating: 0 }), true);
assert.equal(sv.shouldRefreshSchedules({ visible: false, editing: false, mutating: 0 }), false);
assert.equal(sv.shouldRefreshSchedules({ visible: true, editing: true, mutating: 0 }), false);
assert.equal(sv.shouldRefreshSchedules({ visible: true, editing: false, mutating: 1 }), false);

// sameSchedules: equal shown fields in the same order; any change or reorder differs.
const row = (id, extra = {}) => ({ id, title: "t", due_date: today, assignee: null, note: null, color: "yellow", done: false, created_at: "x", ...extra });
assert.equal(sv.sameSchedules([row("a"), row("b")], [row("a"), row("b", { created_at: "y" })]), true);
assert.equal(sv.sameSchedules([], []), true);
assert.equal(sv.sameSchedules([row("a")], [row("a"), row("b")]), false);
assert.equal(sv.sameSchedules([row("a"), row("b")], [row("b"), row("a")]), false);
for (const [key, value] of [["title", "u"], ["due_date", "2026-11-12"], ["assignee", "김"], ["note", "n"], ["color", "pink"], ["done", true]]) {
  assert.equal(sv.sameSchedules([row("a")], [row("a", { [key]: value })]), false, `${key} change must count.`);
}
// updated_at is the edit lock token: a newer token must replace the stale row.
assert.equal(sv.sameSchedules([row("a", { updated_at: "1" })], [row("a", { updated_at: "2" })]), false, "updated_at change must count.");
assert.equal(sv.sameSchedules([row("a")], [row("a")]), true, "Rows without updated_at still compare equal.");
// D10: kind and sort_order change how the week board draws a row, so they count too
// (also when the column disappears, e.g. a rolled-back DB).
assert.equal(sv.sameSchedules([row("a", { kind: "todo" })], [row("a", { kind: "h1" })]), false, "kind change must count.");
assert.equal(sv.sameSchedules([row("a", { kind: "h1" })], [row("a")]), false, "A dropped kind column must count.");
assert.equal(sv.sameSchedules([row("a", { sort_order: 1 })], [row("a", { sort_order: 2 })]), false, "sort_order change must count.");
assert.equal(sv.sameSchedules([row("a", { kind: "h2", sort_order: 1 })], [row("a", { kind: "h2", sort_order: 1 })]), true);

// shouldRefreshMemo: visible page, nothing waiting to save, calm status, textarea not focused.
const calm = { visible: true, pending: false, status: "idle", focused: false };
assert.equal(sv.shouldRefreshMemo(calm), true);
assert.equal(sv.shouldRefreshMemo({ ...calm, status: "saved" }), true);
assert.equal(sv.shouldRefreshMemo({ ...calm, visible: false }), false);
assert.equal(sv.shouldRefreshMemo({ ...calm, pending: true }), false);
assert.equal(sv.shouldRefreshMemo({ ...calm, focused: true }), false);
for (const status of ["saving", "conflict", "error"]) {
  assert.equal(sv.shouldRefreshMemo({ ...calm, status }), false, `${status} must block the refresh.`);
}

// memoLineCount: empty text has no lines; a trailing newline starts a new line.
assert.equal(sv.memoLineCount(""), 0);
assert.equal(sv.memoLineCount("한 줄"), 1);
assert.equal(sv.memoLineCount("가\n나"), 2);
assert.equal(sv.memoLineCount("가\r\n나\n"), 3);
assert.equal(sv.memoLineCount(Array(100).fill("x").join("\n")), 100);

console.log("PASS: capCell cap/hidden count, splitMonthItems open-by-date and done, isOverdue only for past not-done items, shouldRefreshSchedules gate, sameSchedules field/order/updated_at compare, shouldRefreshMemo gate, memoLineCount.");
