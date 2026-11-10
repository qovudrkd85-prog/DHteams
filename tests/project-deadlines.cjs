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
const sandbox = {
  exports: {},
  module: { exports: {} },
  // The Supabase client is never called by the pure helpers under test.
  require: (name) => {
    if (name === "@/lib/supabase/client") return { createClient: () => { throw new Error("no network in this test"); } };
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

console.log("PASS: project tone map avoids clashes and is stable, deadline groups by project.");
