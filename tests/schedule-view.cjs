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

console.log("PASS: capCell cap/hidden count, splitMonthItems open-by-date and done, isOverdue only for past not-done items.");
