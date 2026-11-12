/* eslint-disable @typescript-eslint/no-require-imports -- Pure week block helpers, no network. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const source = fs.readFileSync(path.resolve(__dirname, "../src/lib/week-blocks.ts"), "utf8");
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
const wb = sandbox.module.exports;
// vm objects come from another realm; compare as plain JSON.
const plain = (value) => JSON.parse(JSON.stringify(value));

// isTodo: missing kind or 'todo' counts as a to-do; block kinds do not.
assert.equal(wb.isTodo({}), true);
assert.equal(wb.isTodo({ kind: undefined }), true);
assert.equal(wb.isTodo({ kind: null }), true);
assert.equal(wb.isTodo({ kind: "todo" }), true);
for (const kind of ["text", "h1", "h2", "h3", "bullet", "number"]) assert.equal(wb.isTodo({ kind }), false, kind);

// orderDay: sort_order then created_at, missing sort_order = 0, input untouched.
const rows = [
  { id: "c", sort_order: 2, created_at: "2026-11-11T00:00:01Z" },
  { id: "a", created_at: "2026-11-11T00:00:05Z" },
  { id: "b", sort_order: 0, created_at: "2026-11-11T00:00:02Z" },
  { id: "d", sort_order: 1.5, created_at: "2026-11-11T00:00:00Z" },
  { id: "e", sort_order: -1, created_at: "2026-11-11T00:00:09Z" },
];
const before = plain(rows);
const ordered = wb.orderDay(rows);
assert.deepEqual(plain(ordered.map((r) => r.id)), ["e", "b", "a", "d", "c"]);
assert.notEqual(ordered, rows, "orderDay returns a new array");
assert.deepEqual(plain(rows), before, "orderDay must not mutate its input");
assert.deepEqual(plain(wb.orderDay([])), []);

// nextOrder: empty day -> 1, else max + 1 (missing sort_order = 0).
assert.equal(wb.nextOrder([]), 1);
assert.equal(wb.nextOrder([{ sort_order: 3 }, { sort_order: 1 }]), 4);
assert.equal(wb.nextOrder([{}, {}]), 1);
assert.equal(wb.nextOrder([{ sort_order: -5 }]), -4);
assert.equal(wb.nextOrder([{ sort_order: 2.5 }, {}]), 3.5);

// orderBetween: midpoint; without b -> a + 1.
assert.equal(wb.orderBetween(1, 2), 1.5);
assert.equal(wb.orderBetween(0, 1), 0.5);
assert.equal(wb.orderBetween(-1, 1), 0);
assert.equal(wb.orderBetween(3), 4);
assert.equal(wb.orderBetween(3, undefined), 4);
assert.equal(wb.orderBetween(3, null), 4);
const mid = wb.orderBetween(1, 1.0001);
assert.ok(mid > 1 && mid < 1.0001, "midpoint strictly between");

// parseShortcut (D10): a Markdown prefix at the very start switches the line kind.
assert.deepEqual(plain(wb.parseShortcut("# 가")), { kind: "h1", text: "가" });
assert.deepEqual(plain(wb.parseShortcut("## 현장조사")), { kind: "h2", text: "현장조사" });
assert.deepEqual(plain(wb.parseShortcut("### 소제목")), { kind: "h3", text: "소제목" });
assert.deepEqual(plain(wb.parseShortcut("- 목차")), { kind: "bullet", text: "목차" });
assert.deepEqual(plain(wb.parseShortcut("* 목차")), { kind: "bullet", text: "목차" });
assert.deepEqual(plain(wb.parseShortcut("1. 초안")), { kind: "number", text: "초안" });
assert.deepEqual(plain(wb.parseShortcut("[] 할 일")), { kind: "todo", text: "할 일" });
assert.deepEqual(plain(wb.parseShortcut("[ ] 할 일")), { kind: "todo", text: "할 일" });
// The prefix alone (space just typed) converts with empty text.
assert.deepEqual(plain(wb.parseShortcut("## ")), { kind: "h2", text: "" });
assert.deepEqual(plain(wb.parseShortcut("- ")), { kind: "bullet", text: "" });
// No space after the mark, or not at the start: plain text.
for (const value of ["#가", "가 # ", " # 가", "##가", "-가", "1.가", "[]가", "", "가나다"]) {
  assert.equal(wb.parseShortcut(value), null, JSON.stringify(value));
}

// numberLabels: consecutive number rows count from 1; anything else breaks the run.
assert.deepEqual(
  plain(wb.numberLabels([{ kind: "number" }, { kind: "number" }, { kind: "text" }, { kind: "number" }])),
  [1, 2, null, 1],
);
assert.deepEqual(plain(wb.numberLabels([{}, { kind: "number" }, { kind: "todo" }, { kind: "number" }, { kind: "number" }, { kind: "number" }])), [null, 1, null, 1, 2, 3]);
assert.deepEqual(plain(wb.numberLabels([])), []);

// stickyKind: to-do, bullet and number carry on to the next line; headings and text fall back to to-do.
assert.equal(wb.stickyKind("todo"), "todo");
assert.equal(wb.stickyKind("bullet"), "bullet");
assert.equal(wb.stickyKind("number"), "number");
for (const kind of ["h1", "h2", "h3", "text"]) assert.equal(wb.stickyKind(kind), "todo", kind);

// D11 "/" block menu: seven kinds in a fixed order, filtered by the text typed after "/".
assert.deepEqual(plain(wb.BLOCK_MENU.map((item) => item.kind)), ["todo", "text", "h1", "h2", "h3", "bullet", "number"]);
assert.deepEqual(
  plain(wb.BLOCK_MENU.map((item) => item.label)),
  ["할 일 목록", "텍스트", "제목1", "제목2", "제목3", "글머리 기호 목록", "번호 매기기 목록"],
);
const menuKinds = (query) => plain(wb.filterMenu(query).map((item) => item.kind));
assert.equal(wb.filterMenu("").length, 7);
assert.deepEqual(menuKinds("제목"), ["h1", "h2", "h3"]);
assert.deepEqual(menuKinds("h2"), ["h2"]);
assert.deepEqual(menuKinds("H2"), ["h2"], "Aliases ignore case.");
assert.deepEqual(menuKinds("할"), ["todo"]);
assert.deepEqual(menuKinds("todo"), ["todo"]);
assert.deepEqual(menuKinds("text"), ["text"]);
assert.deepEqual(menuKinds("bullet"), ["bullet"]);
assert.deepEqual(menuKinds("num"), ["number"]);
assert.deepEqual(menuKinds("h1"), ["h1"]);
assert.deepEqual(menuKinds("zz"), []);
assert.notEqual(wb.filterMenu(""), wb.BLOCK_MENU, "filterMenu returns a new array.");

// moveIndex: ↑↓ wrap around at both ends.
assert.equal(wb.moveIndex(0, -1, 7), 6);
assert.equal(wb.moveIndex(6, 1, 7), 0);
assert.equal(wb.moveIndex(2, 1, 7), 3);
assert.equal(wb.moveIndex(0, 1, 3), 1);
assert.equal(wb.moveIndex(0, 1, 0), 0, "No items: stays at 0.");

// slashQuery: only a "/" at the very start opens the menu; the rest is the filter.
assert.equal(wb.slashQuery("/"), "");
assert.equal(wb.slashQuery("/제목"), "제목");
assert.equal(wb.slashQuery("가/"), null);
assert.equal(wb.slashQuery(""), null);
assert.equal(wb.slashQuery(" /제목"), null);

console.log("PASS: week-blocks (isTodo, orderDay stable/immutable, nextOrder, orderBetween, parseShortcut, numberLabels, stickyKind, BLOCK_MENU/filterMenu/moveIndex/slashQuery).");
