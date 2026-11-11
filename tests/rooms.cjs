/* eslint-disable @typescript-eslint/no-require-imports -- Pure hub room helpers, no network. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const source = fs.readFileSync(path.resolve(__dirname, "../src/lib/team/rooms.ts"), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
const storage = new Map();
let uuid = 0;
const sandbox = {
  exports: {}, module: { exports: {} },
  crypto: { randomUUID: () => `00000000-0000-4000-8000-${String(++uuid).padStart(12, "0")}` },
  window: { localStorage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) } },
};
sandbox.exports = sandbox.module.exports;
vm.runInNewContext(outputText, sandbox);
const r = sandbox.module.exports;

// Hub view memory.
assert.equal(r.loadHubView(), "team");
r.saveHubView("garage");
assert.equal(r.loadHubView(), "garage");
storage.set("teams-hub-view", "outdoor");
assert.equal(r.loadHubView(), "team");
const blocked = { exports: {}, module: { exports: {} }, crypto: sandbox.crypto, window: { localStorage: { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } } } };
blocked.exports = blocked.module.exports;
vm.runInNewContext(outputText, blocked);
blocked.module.exports.saveHubView("garage");
assert.equal(blocked.module.exports.loadHubView(), "garage", "memory fallback");

// Team room pick.
const room = (id, kind, key, extra = {}) => ({ id, name: id, theme: "sage", items: [], updated_at: "t", canvas_width: 1000, canvas_height: 560, room_kind: kind, room_key: key, ...extra });
assert.equal(r.pickTeamRoom([]), null);
assert.equal(r.pickTeamRoom([room("y", "outdoor", "outdoor"), room("c", "cafe", "cafe"), room("o2", "office", "office-2"), room("o1", "office", "office-1")]).id, "o1");
assert.equal(r.pickTeamRoom([room("y", "outdoor", "outdoor"), room("a", "office", null), room("b", "office", null)]).id, "a");
assert.equal(r.pickTeamRoom([room("y", "outdoor", "outdoor")]), null);

// Desk grid.
const slots = r.deskSlots(1000, 560);
assert.ok(slots.length >= 8, `slots ${slots.length}`);
for (const s of slots) assert.ok(s.x >= 90 && s.x <= 910 && s.y >= 100 && s.y <= 470, JSON.stringify(s));
for (let i = 0; i < slots.length; i++) for (let j = i + 1; j < slots.length; j++) assert.ok(Math.hypot(slots[i].x - slots[j].x, slots[i].y - slots[j].y) >= 150);
assert.ok(r.deskSlots(2400, 1200).length >= 20);

// Own desk.
const desk = (id, x, y, member_id = null) => ({ id, kind: "desk", x, y, rotation: 0, label: "", member_id });
const mine = room("o1", "office", "office-1", { items: [desk("d1", 100, 130, "m1")] });
assert.deepEqual({ ...r.withOwnDesk(mine, "m1") }, { draft: null, deskId: "d1" });
const free = room("o1", "office", "office-1", { items: [desk("d1", 100, 130, "m2"), desk("d2", 280, 130)] });
assert.deepEqual({ ...r.withOwnDesk(free, "m1") }, { draft: null, deskId: "d2" });
const full = room("o1", "office", "office-1", { items: [desk("d1", 100, 130, "m2"), { id: "t1", kind: "table", x: 280, y: 130, rotation: 0, label: "", member_id: null }] });
const added = r.withOwnDesk(full, "m1");
assert.ok(added.draft, "draft expected");
assert.equal(added.draft.items.length, 3);
const fresh = added.draft.items.find((item) => item.id === added.deskId);
assert.equal(fresh.kind, "desk");
assert.equal(fresh.member_id, null);
for (const other of full.items) assert.ok(Math.hypot(fresh.x - other.x, fresh.y - other.y) >= 150, "new desk overlaps");
assert.equal(full.items.length, 2, "input not mutated");

// Grow canvas when the grid is full.
const packed = room("o1", "office", "office-1", { items: r.deskSlots(1000, 560).map((s, i) => desk(`p${i}`, s.x, s.y, `m${i + 10}`)) });
const grown = r.withOwnDesk(packed, "m1");
assert.ok(grown.draft.canvas_width > 1000 || grown.draft.canvas_height > 560);
const huge = room("o1", "office", "office-1", { canvas_width: 2400, canvas_height: 1200, items: r.deskSlots(2400, 1200).map((s, i) => desk(`h${i}`, s.x, s.y, `m${i + 100}`)) });
assert.throws(() => r.withOwnDesk(huge, "m1"), /책상 자리가 없어요/);

// Garage door on the lounge rug.
const empty = room("o1", "office", "office-1", { canvas_width: 1600, canvas_height: 900 });
assert.deepEqual({ ...r.garageDoor(empty) }, { x: 1350, y: 715 });
const rugDesk = room("o1", "office", "office-1", { canvas_width: 1600, canvas_height: 900, items: [desk("d9", 1360, 700)] });
const moved = r.garageDoor(rugDesk);
assert.notDeepEqual({ ...moved }, { x: 1350, y: 715 });
for (const item of rugDesk.items) assert.ok(Math.hypot(moved.x - item.x, moved.y - item.y) >= 120, "door on furniture");
for (const sized of [empty, room("s", "office", "office-1"), room("b", "office", "office-1", { canvas_width: 2400, canvas_height: 1200 })]) {
  const door = r.garageDoor(sized);
  const w = sized.canvas_width ?? 1000, h = sized.canvas_height ?? 560;
  assert.ok(door.x >= 24 && door.x <= w - 24 && door.y >= 80 && door.y <= h - 30, `door out of walk bounds ${JSON.stringify(door)}`);
}
assert.equal(r.DOOR_REACH, 150);
assert.equal(r.nearGarageDoor({ x: 1350 + 149, y: 715 }, { x: 1350, y: 715 }), true);
assert.equal(r.nearGarageDoor({ x: 1350, y: 715 - 151 }, { x: 1350, y: 715 }), false);

console.log("rooms ok");
