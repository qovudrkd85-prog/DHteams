/* eslint-disable @typescript-eslint/no-require-imports -- Memo item helpers against a fake Supabase client, no network. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const source = fs.readFileSync(path.resolve(__dirname, "../src/lib/memo-items.ts"), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});

// Fake client: records every builder call; each await resolves to the next queued result.
const calls = [];
const results = [];
function builder(table) {
  const record = { table, ops: [] };
  calls.push(record);
  const chain = new Proxy({}, {
    get(_, name) {
      if (name === "then") {
        const result = results.shift() ?? { data: null, error: null };
        return (resolve, reject) => Promise.resolve(result).then(resolve, reject);
      }
      return (...args) => {
        record.ops.push([name, ...args]);
        return chain;
      };
    },
  });
  return chain;
}
const sandbox = {
  exports: {},
  module: { exports: {} },
  require: (name) => {
    if (name === "@/lib/supabase/client") return { createClient: () => ({ from: builder }) };
    throw new Error(`unexpected import ${name}`);
  },
};
sandbox.exports = sandbox.module.exports;
vm.runInNewContext(outputText, sandbox);
const mi = sandbox.module.exports;
const op = (record, name) => record.ops.filter((o) => o[0] === name);

const item = { id: "i1", project_id: "p1", month: "2026-11", content: "가", created_by: null, creator_name: "김", created_at: "t0", updated_at: "u1", deleted_at: null };

(async () => {
  // foldItems
  const eight = Array.from({ length: 8 }, (_, i) => i);
  assert.deepEqual(JSON.parse(JSON.stringify(mi.foldItems(eight, 5, false))), { shown: [0, 1, 2, 3, 4], hiddenCount: 3 });
  assert.deepEqual(JSON.parse(JSON.stringify(mi.foldItems(eight, 5, true))), { shown: eight, hiddenCount: 0 });
  assert.deepEqual(JSON.parse(JSON.stringify(mi.foldItems([1, 2], 5, false))), { shown: [1, 2], hiddenCount: 0 });
  assert.deepEqual(JSON.parse(JSON.stringify(mi.foldItems(eight.slice(0, 5), 5, false))), { shown: [0, 1, 2, 3, 4], hiddenCount: 0 });

  // listMemoItems: live rows, newest first.
  results.push({ data: [item], error: null });
  const rows = await mi.listMemoItems("p1", "2026-11");
  assert.equal(rows.length, 1);
  let rec = calls.at(-1);
  assert.equal(rec.table, "project_memo_items");
  assert.deepEqual(op(rec, "eq").map((o) => o.slice(1)), [["project_id", "p1"], ["month", "2026-11"]]);
  assert.deepEqual(op(rec, "is")[0].slice(1), ["deleted_at", null]);
  assert.deepEqual(JSON.parse(JSON.stringify(op(rec, "order")[0].slice(1))), ["created_at", { ascending: false }]);

  // Missing table (PostgREST or Postgres code) means unavailable; other errors stay plain.
  for (const code of ["PGRST205", "42P01"]) {
    results.push({ data: null, error: { code, message: "missing" } });
    await assert.rejects(mi.listMemoItems("p1", "2026-11"), (e) => e instanceof mi.MemoItemsUnavailableError);
  }
  results.push({ data: null, error: { code: "42501", message: "permission denied" } });
  await assert.rejects(mi.listMemoItems("p1", "2026-11"), (e) => !(e instanceof mi.MemoItemsUnavailableError) && e.message === "permission denied");

  // addMemoItem sends only project, month and trimmed text, even if extra fields are passed.
  results.push({ data: { ...item, id: "i2" }, error: null });
  await mi.addMemoItem({ project_id: "p1", month: "2026-11", content: "  새 항목 ", created_by: "x", creator_name: "위조" });
  rec = calls.at(-1);
  assert.deepEqual(JSON.parse(JSON.stringify(op(rec, "insert")[0][1])), { project_id: "p1", month: "2026-11", content: "새 항목" });
  await assert.rejects(mi.addMemoItem({ project_id: "p1", month: "2026-11", content: "   " }), /내용을 입력/);

  // updateMemoItem: conditional on updated_at; no row back = conflict.
  results.push({ data: { ...item, content: "나", updated_at: "u2" }, error: null });
  const saved = await mi.updateMemoItem(item, "나");
  assert.equal(saved.updated_at, "u2");
  rec = calls.at(-1);
  assert.deepEqual(op(rec, "eq").map((o) => o.slice(1)), [["id", "i1"], ["updated_at", "u1"]]);
  assert.deepEqual(JSON.parse(JSON.stringify(op(rec, "update")[0][1])), { content: "나" });
  results.push({ data: null, error: null });
  await assert.rejects(mi.updateMemoItem(item, "다"), (e) => e instanceof mi.MemoItemConflictError && e.message === "다른 팀원이 이 항목을 먼저 고쳤습니다");

  // setMemoItemDeleted: same condition, soft delete and restore.
  results.push({ data: { ...item, deleted_at: "d", updated_at: "u3" }, error: null });
  await mi.setMemoItemDeleted(item, true);
  rec = calls.at(-1);
  assert.ok(typeof op(rec, "update")[0][1].deleted_at === "string");
  assert.deepEqual(op(rec, "eq").map((o) => o.slice(1)), [["id", "i1"], ["updated_at", "u1"]]);
  results.push({ data: { ...item, updated_at: "u4" }, error: null });
  await mi.setMemoItemDeleted({ ...item, updated_at: "u3" }, false);
  rec = calls.at(-1);
  assert.equal(op(rec, "update")[0][1].deleted_at, null);
  assert.deepEqual(op(rec, "eq").map((o) => o.slice(1)), [["id", "i1"], ["updated_at", "u3"]]);
  results.push({ data: null, error: null });
  await assert.rejects(mi.setMemoItemDeleted(item, true), (e) => e instanceof mi.MemoItemConflictError);

  console.log("PASS: memo items foldItems, list filter/order, unavailable detection (PGRST205/42P01), add sends no author fields, conditional update/delete/restore and conflict.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
