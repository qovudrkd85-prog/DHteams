/* eslint-disable @typescript-eslint/no-require-imports -- Pure project deadline helpers, no network. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const source = fs.readFileSync(path.resolve(__dirname, "../src/lib/project-deadlines.ts"), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
// Fake Supabase client: records each query's filters and answers from `responses` in order.
const calls = [];
let responses = [];
function fakeClient() {
  return {
    from(table) {
      const call = { table, eq: [] };
      calls.push(call);
      const builder = {
        select: () => builder,
        gte: () => builder,
        lte: () => builder,
        is: () => builder,
        order: () => builder,
        limit: () => builder,
        eq: (column, value) => { call.eq.push(`${column}=${value}`); return builder; },
        then: (resolve, reject) => Promise.resolve(responses.shift() ?? { data: [], error: null }).then(resolve, reject),
      };
      return builder;
    },
  };
}
function loadWeekBlocks() {
  const wbSource = fs.readFileSync(path.resolve(__dirname, "../src/lib/week-blocks.ts"), "utf8");
  const box = { exports: {}, module: { exports: {} }, require: (name) => { throw new Error(`unexpected import ${name}`); } };
  box.exports = box.module.exports;
  vm.runInNewContext(ts.transpileModule(wbSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, box);
  return box.module.exports;
}
const sandbox = {
  exports: {},
  module: { exports: {} },
  // The Supabase client is never called by the pure helpers under test.
  require: (name) => {
    if (name === "@/lib/supabase/client") return { createClient: () => fakeClient() };
    if (name === "@/lib/week-blocks") return loadWeekBlocks();
    throw new Error(`unexpected import ${name}`);
  },
};
sandbox.exports = sandbox.module.exports;
vm.runInNewContext(outputText, sandbox);
const pd = sandbox.module.exports;

// Find two ids whose plain hash lands on the same colour.
const ids = Array.from({ length: 40 }, (_, i) => `project-${i}`);
const byTone = new Map();
let clash = null;
for (const id of ids) {
  const tone = pd.projectTone(id);
  if (byTone.has(tone)) {
    clash = [byTone.get(tone), id];
    break;
  }
  byTone.set(tone, id);
}
assert.ok(clash, "fixture needs two ids whose hash colours clash");

const map = pd.projectToneMap(clash);
assert.notEqual(map.get(clash[0]), map.get(clash[1]), "clashing projects get different colours");
assert.equal(map.size, 2);

// Same input, same result; input order does not matter.
const again = pd.projectToneMap([clash[1], clash[0]]);
assert.equal(again.get(clash[0]), map.get(clash[0]));
assert.equal(again.get(clash[1]), map.get(clash[1]));

// Up to eight projects all get distinct colours; duplicates are ignored.
const eight = pd.projectToneMap([...ids.slice(0, 8), ids[0]]);
assert.equal(eight.size, 8);
assert.equal(new Set(eight.values()).size, 8, "eight projects, eight colours");
// More than eight wraps around but still gives every id a colour.
const many = pd.projectToneMap(ids);
assert.equal(many.size, ids.length);
assert.ok([...many.values()].every((tone) => pd.PROJECT_TONES.includes(tone)));

// toneFor falls back to the hash colour for ids outside the map.
assert.equal(pd.toneFor(map, clash[1]), map.get(clash[1]));
assert.equal(pd.toneFor(map, "unknown"), pd.projectTone("unknown"));

// Grouping: one group per project, deadlines in date order, groups ordered by their first date.
const d = (id, project, due, done = false) => ({
  id, project_id: project, project_name: `name-${project}`, project_code: null,
  title: id, due_date: due, assignee: null, done, color: "yellow",
});
const groups = pd.groupDeadlinesByProject([
  d("b2", "B", "2026-11-20"),
  d("a1", "A", "2026-11-05", true),
  d("b1", "B", "2026-11-03"),
  d("a2", "A", "2026-11-25"),
]);
assert.deepEqual(Array.from(groups, (g) => g.project_id), ["B", "A"]);
assert.deepEqual(Array.from(groups[0].deadlines, (x) => x.id), ["b1", "b2"]);
assert.deepEqual(Array.from(groups[1].deadlines, (x) => x.id), ["a1", "a2"]);
assert.equal(groups[1].project_name, "name-A");
assert.equal(pd.groupDeadlinesByProject([]).length, 0);

// The hub keeps its project array when a background refresh returns the same rows.
const listSource = fs.readFileSync(path.resolve(__dirname, "../src/lib/project-list.ts"), "utf8");
const listBox = { exports: {}, module: { exports: {} }, require: (name) => { throw new Error(`unexpected import ${name}`); } };
listBox.exports = listBox.module.exports;
vm.runInNewContext(ts.transpileModule(listSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, listBox);
const { sameProjects } = listBox.module.exports;
const row = (id, extra = {}) => ({ id, name: `n-${id}`, code: null, description: "", owner_id: "o", created_at: "t", ...extra });
assert.equal(sameProjects([row("a"), row("b")], [row("a", { created_at: "later" }), row("b")]), true, "Only shown fields count.");
assert.equal(sameProjects([row("a")], [row("a"), row("b")]), false, "A new project changes the list.");
assert.equal(sameProjects([row("a"), row("b")], [row("b"), row("a")]), false, "Order matters.");
assert.equal(sameProjects([row("a")], [row("a", { name: "renamed" })]), false);
assert.equal(sameProjects([row("a")], [row("a", { code: "C-1" })]), false);
assert.equal(sameProjects([row("a")], [row("a", { description: "new" })]), false);
assert.equal(sameProjects([], []), true);

// D9: deadlines ask for to-do rows only; without the kind column, refetch once unfiltered and filter here.
(async () => {
  const live = { name: "P", code: null, deleted_at: null };
  const sched = (id, extra = {}) => ({ id, project_id: "p1", title: id, due_date: "2026-11-12", assignee: null, note: null, color: "yellow", done: false, created_at: "t", deleted_at: null, projects: live, ...extra });
  responses = [
    { data: null, error: { code: "42703", message: "column schedules.kind does not exist" } },
    { data: [sched("todo-a"), sched("head", { kind: "h1" }), sched("todo-b", { kind: "todo" })], error: null },
  ];
  const first = await pd.listProjectDeadlines("2026-11-01", "2026-11-30");
  assert.equal(calls.length, 2, "One refetch after a missing kind column.");
  assert.ok(calls[0].eq.includes("kind=todo"), "The first query filters kind = todo.");
  assert.ok(!calls[1].eq.includes("kind=todo"), "The refetch has no kind filter.");
  assert.deepEqual(Array.from(first, (x) => x.id), ["todo-a", "todo-b"], "Block rows are dropped on the client.");
  // The module remembers the column is missing: no more kind filter, no extra request.
  responses = [{ data: [sched("todo-c"), sched("text", { kind: "text" })], error: null }];
  const second = await pd.listProjectDeadlines("2026-11-01", "2026-11-30");
  assert.equal(calls.length, 3);
  assert.ok(!calls[2].eq.includes("kind=todo"));
  assert.deepEqual(Array.from(second, (x) => x.id), ["todo-c"]);
  // Other errors still throw.
  responses = [{ data: null, error: { code: "500", message: "boom" } }];
  await assert.rejects(pd.listProjectDeadlines("2026-11-01", "2026-11-30"), /boom/);
  console.log("PASS: project tone map avoids clashes and is stable, deadline groups by project, same-list check, kind=todo filter with missing-column refetch.");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
