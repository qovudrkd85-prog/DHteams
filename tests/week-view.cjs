/* eslint-disable @typescript-eslint/no-require-imports -- Pure week board helpers, no network. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const source = fs.readFileSync(path.resolve(__dirname, "../src/lib/week-view.ts"), "utf8");
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
const wv = sandbox.module.exports;
// vm objects come from another realm; compare as plain JSON.
const plain = (value) => JSON.parse(JSON.stringify(value));

// weekStart: the Monday of the week (Monday-first weeks).
assert.equal(wv.weekStart("2026-11-11"), "2026-11-09", "Wednesday -> Monday");
assert.equal(wv.weekStart("2026-11-15"), "2026-11-09", "Sunday belongs to the week before it");
assert.equal(wv.weekStart("2026-11-09"), "2026-11-09", "Monday is its own start");
assert.equal(wv.weekStart("2026-11-14"), "2026-11-09", "Saturday");
assert.equal(wv.weekStart("2027-01-01"), "2026-12-28", "Across the year end");
assert.equal(wv.weekStart("2026-03-01"), "2026-02-23", "Across a month end");

// weekDays: seven consecutive keys, across month and year ends.
assert.deepEqual(plain(wv.weekDays("2026-11-09")), [
  "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15",
]);
assert.deepEqual(plain(wv.weekDays("2026-11-30")), [
  "2026-11-30", "2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04", "2026-12-05", "2026-12-06",
]);
assert.deepEqual(plain(wv.weekDays("2026-12-28")).slice(-3), ["2027-01-01", "2027-01-02", "2027-01-03"]);

// shiftWeek: plus or minus seven days.
assert.equal(wv.shiftWeek("2026-11-09", 1), "2026-11-16");
assert.equal(wv.shiftWeek("2026-11-09", -1), "2026-11-02");
assert.equal(wv.shiftWeek("2026-12-28", 1), "2027-01-04");
assert.equal(wv.shiftWeek("2026-03-02", -1), "2026-02-23");

// weekLabel: "11월 9일~15일", with the month repeated when the week spans two.
assert.equal(wv.weekLabel("2026-11-09"), "11월 9일~15일");
assert.equal(wv.weekLabel("2026-11-30"), "11월 30일~12월 6일");
assert.equal(wv.weekLabel("2026-12-28"), "12월 28일~1월 3일");

// groupWeek: seven day keys in order, items outside the week dropped, input untouched.
const item = (id, due_date) => ({ id, due_date, done: false });
const items = [
  item("a", "2026-11-11"),
  item("out-before", "2026-11-08"),
  item("b", "2026-11-09"),
  item("c", "2026-11-11"),
  item("out-after", "2026-11-16"),
  item("d", "2026-11-15"),
];
const snapshot = plain(items);
const grouped = wv.groupWeek(items, "2026-11-09");
assert.deepEqual(plain([...grouped.keys()]), plain(wv.weekDays("2026-11-09")));
assert.deepEqual(plain(grouped.get("2026-11-11").map((s) => s.id)), ["a", "c"], "Same-day order is kept.");
assert.deepEqual(plain(grouped.get("2026-11-09").map((s) => s.id)), ["b"]);
assert.deepEqual(plain(grouped.get("2026-11-15").map((s) => s.id)), ["d"]);
assert.deepEqual(plain(grouped.get("2026-11-10")), [], "Empty days still have a list.");
const total = [...grouped.values()].reduce((sum, list) => sum + list.length, 0);
assert.equal(total, 4, "Items outside the week are left out.");
assert.deepEqual(plain(items), snapshot, "groupWeek must not mutate its input.");

// shouldHandleKey: Enter/arrows during Hangul composition are ignored.
assert.equal(wv.shouldHandleKey({ isComposing: false, keyCode: 13 }), true);
assert.equal(wv.shouldHandleKey({ isComposing: true, keyCode: 13 }), false);
assert.equal(wv.shouldHandleKey({ isComposing: false, keyCode: 229 }), false, "keyCode 229 = IME still busy");

console.log("PASS: week-view weekStart/weekDays/shiftWeek/weekLabel/groupWeek/shouldHandleKey");
