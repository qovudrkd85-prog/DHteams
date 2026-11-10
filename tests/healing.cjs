/* eslint-disable @typescript-eslint/no-require-imports -- Pure healing helpers, no network. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const source = fs.readFileSync(path.resolve(__dirname, "../src/lib/team/healing.ts"), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
const storage = new Map();
const sandbox = { exports: {}, module: { exports: {} }, window: { localStorage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) } } };
sandbox.exports = sandbox.module.exports;
vm.runInNewContext(outputText, sandbox);
const h = sandbox.module.exports;

assert.equal(h.weatherEffect(0), "clear");
assert.equal(h.weatherEffect(3), "cloudy");
assert.equal(h.weatherEffect(45), "fog");
assert.equal(h.weatherEffect(61), "rain");
assert.equal(h.weatherEffect(81), "rain");
assert.equal(h.weatherEffect(95), "rain");
assert.equal(h.weatherEffect(73), "snow");
assert.equal(h.weatherEffect(86), "snow");
assert.equal(h.sceneForWeather({ effect: "clear", isDay: true }), "beach");
assert.equal(h.sceneForWeather({ effect: "rain", isDay: true }), "rooftop");
assert.equal(h.sceneForWeather({ effect: "snow", isDay: true }), "snow-forest");
assert.equal(h.sceneForWeather({ effect: "clear", isDay: false }), "camp");
assert.equal(h.formatRemaining(600_000), "10:00");
assert.equal(h.formatRemaining(61_001), "1:02");
assert.equal(h.formatRemaining(-5), "0:00");
assert.deepEqual({ ...h.parseWeather({ current: { weather_code: 61, is_day: 1, temperature_2m: 12.6 } }) }, { effect: "rain", isDay: true, temperature: 12.6, label: "비" });
assert.equal(h.parseWeather({ current: { weather_code: 0, is_day: 0 } }).temperature, null);
assert.throws(() => h.parseWeather({}), /날씨 응답/);
assert.throws(() => h.parseWeather(null), /날씨 응답/);
assert.equal(h.findScene("nope").id, "beach");
assert.ok(h.HEALING_SCENES.some((scene) => scene.id === "camp"), "campground is a place");
assert.ok(!h.HEALING_SCENES.some((scene) => scene.id === "rooftop-night"), "night is the world clock, not a place");

assert.deepEqual({ ...h.loadHealingPrefs() }, { sceneId: "auto", cityId: "seoul", minutes: 10 });
h.saveHealingPrefs({ sceneId: "fishing", cityId: "busan", minutes: 15 });
assert.deepEqual({ ...h.loadHealingPrefs() }, { sceneId: "fishing", cityId: "busan", minutes: 15 });
storage.set("teams:healing", JSON.stringify({ sceneId: "<script>", cityId: "mars", minutes: 999 }));
assert.deepEqual({ ...h.loadHealingPrefs() }, { sceneId: "beach", cityId: "seoul", minutes: 10 });
storage.set("teams:healing", "{broken");
assert.equal(h.loadHealingPrefs().sceneId, "auto");
sandbox.window.localStorage.setItem = () => { throw new Error("quota"); };
assert.doesNotThrow(() => h.saveHealingPrefs({ sceneId: "auto", cityId: "seoul", minutes: 5 }));
// Activities: display meta only; which zone offers what is decided by healing-world.ts props.
assert.deepEqual([...h.HEALING_ACTIVITIES.map((a) => a.id)], ["laptop", "fishing", "walk", "rest", "smoke", "hike", "stargaze", "snowman", "campfire"]);
assert.equal(h.findActivity("campfire").name, "불멍");
assert.equal(h.findActivity("nope").id, "rest", "unknown activity falls back to resting");
console.log("PASS: healing weather mapping, scene suggestion, timer text, weather parsing, safe preferences, activities.");

// Status session: closing then reopening fast must keep the real original message.
(async () => {
  const tick = () => new Promise((r) => setTimeout(r, 0));
  let server = "회의 중";
  let failNext = false;
  const write = (msg) => new Promise((resolve, reject) => setTimeout(() => {
    if (failNext) { failNext = false; reject(new Error("이전 요청이 끝난 후 다시 시도해 주세요.")); return; }
    server = msg; resolve({ status_message: msg });
  }, 5));
  const s1 = h.startHealingStatus(server, write);
  assert.equal(await s1.applied, true);
  assert.equal(server, h.HEALING_STATUS);
  const end1 = s1.end(); // restore still in flight
  const s2 = h.startHealingStatus(server, write); // stale view still says HEALING_STATUS
  assert.equal(s2.original, "회의 중");
  await end1;
  assert.equal(await s2.applied, true);
  assert.equal(server, h.HEALING_STATUS, "reopen must apply after the old restore, not before");
  await s2.end(); await tick();
  assert.equal(server, "회의 중");
  // Leftover message from a crashed session is cleared, not restored.
  const s3 = h.startHealingStatus(h.HEALING_STATUS, write);
  await s3.applied; await s3.end(); await tick();
  assert.equal(server, "");
  // A failed write is never undone.
  server = "외근";
  failNext = true;
  const s4 = h.startHealingStatus(server, write);
  assert.equal(await s4.applied, false);
  assert.equal(s4.isApplied(), false);
  assert.equal(await s4.end(), false);
  assert.equal(server, "외근");
  // A failed restore keeps its target: the next session must not lose "외근".
  const s5 = h.startHealingStatus(server, write);
  assert.equal(await s5.applied, true);
  failNext = true;
  await assert.rejects(s5.end());
  assert.equal(server, h.HEALING_STATUS);
  const s6 = h.startHealingStatus(server, write);
  assert.equal(s6.original, "외근", "reopen after a failed restore inherits its target");
  await s6.applied; await s6.end(); await tick();
  assert.equal(server, "외근");
  // ...but a status the user changed since then wins over the stale target.
  const s7 = h.startHealingStatus(server, write);
  await s7.applied; failNext = true; await assert.rejects(s7.end());
  server = "출장";
  const s8 = h.startHealingStatus(server, write);
  assert.equal(s8.original, "출장");
  await s8.applied; await s8.end(); await tick();
  assert.equal(server, "출장");
  // Page unload while the apply still waits: never send it, and restore the original.
  const s9 = h.startHealingStatus(server, write);
  await s9.applied;
  const end9 = s9.end();
  const s10 = h.startHealingStatus(h.HEALING_STATUS, write);
  assert.equal(s10.unload(), "출장");
  await end9;
  assert.equal(await s10.applied, false, "no apply after unload");
  await tick(); await new Promise((r) => setTimeout(r, 20));
  assert.equal(server, "출장");
  // Unload after a failed apply sends nothing.
  failNext = true;
  const s11 = h.startHealingStatus(server, write);
  await s11.applied;
  assert.equal(s11.unload(), null);
  console.log("PASS: healing status session survives quick reopen, clears leftovers, never undoes failed writes, keeps failed restore target, cancels apply on unload.");
})().catch((error) => { console.error(error); process.exit(1); });

// ---------------------------------------------------------------------------
// Healing world (healing-world.ts): walkable floor, props, portals, hiking.
// Loaded in its own sandbox; the module must have no runtime imports.
// ---------------------------------------------------------------------------
{
  const worldSource = fs.readFileSync(path.resolve(__dirname, "../src/lib/team/healing-world.ts"), "utf8");
  const worldJs = ts.transpileModule(worldSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const worldSandbox = { exports: {}, module: { exports: {} } };
  worldSandbox.exports = worldSandbox.module.exports;
  vm.runInNewContext(worldJs, worldSandbox);
  const w = worldSandbox.module.exports;
  const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
  // Sandbox objects live in another realm (different Object.prototype): compare plain copies.
  const same = (actual, expected, message) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), JSON.parse(JSON.stringify(expected)), message);
  const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

  assert.equal(w.WORLD_WIDTH, 1600);
  assert.equal(w.WORLD_HEIGHT, 900);
  assert.ok(w.WALK_SPEED > 0);
  same(Object.keys(w.HEALING_WORLD).sort(), ["beach", "camp", "fishing", "mountain", "rooftop", "snow-forest", "yard"]);

  for (const scene of Object.values(w.HEALING_WORLD)) {
    assert.ok(w.isWalkable(scene, scene.spawn), `${scene.id}: spawn walkable`);
    assert.ok(scene.walkable.length > 0, `${scene.id}: has floor`);
    assert.ok(scene.props.length > 0, `${scene.id}: has props`);
    assert.equal(new Set(scene.props.map((p) => p.id)).size, scene.props.length, `${scene.id}: unique prop ids`);
    for (const prop of scene.props) {
      assert.ok(scene.walkable.some((r) => overlaps(r, prop)), `${scene.id}/${prop.id}: rect touches the floor`);
      assert.match(prop.label, /[가-힣]/, `${scene.id}/${prop.id}: Korean label`);
      assert.doesNotMatch(prop.label, /todo|placeholder|label|lorem/i, `${scene.id}/${prop.id}: no placeholder label`);
      if (prop.kind === "portal") assert.ok(prop.to in w.HEALING_WORLD, `${scene.id}/${prop.id}: portal target exists`);
      else assert.equal(prop.to, undefined, `${scene.id}/${prop.id}: only portals have "to"`);
    }
  }
  // Every non-hub scene has a way back to the yard; the yard reaches every scene.
  for (const scene of Object.values(w.HEALING_WORLD)) {
    if (scene.id === "yard") continue;
    assert.ok(scene.props.some((p) => p.kind === "portal" && p.to === "yard"), `${scene.id}: portal back to yard`);
    assert.ok(w.HEALING_WORLD.yard.props.some((p) => p.kind === "portal" && p.to === scene.id), `yard: portal to ${scene.id}`);
  }

  const yard = w.HEALING_WORLD.yard;
  // inRect: edges inclusive.
  assert.ok(w.inRect({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 10 }));
  assert.ok(!w.inRect({ x: 0, y: 0, w: 10, h: 10 }, { x: 10.1, y: 5 }));
  assert.ok(!w.isWalkable(yard, { x: 800, y: 100 }), "sky is not floor");

  // stepCharacter: WALK_SPEED units per second, inputs untouched, new object returned.
  const start = { x: 800, y: 780 };
  const right = w.stepCharacter(yard, start, { x: 1, y: 0 }, 1);
  same(right, { x: 800 + w.WALK_SPEED, y: 780 });
  same(start, { x: 800, y: 780 }, "pos not mutated");
  assert.notEqual(w.stepCharacter(yard, start, { x: 0, y: 0 }, 1), start, "new object even when idle");
  same(w.stepCharacter(yard, start, { x: 0, y: 0 }, 1), start);
  same(w.stepCharacter(yard, start, { x: 1, y: 1 }, 0), start);
  same(w.stepCharacter(yard, start, { x: 1, y: 1 }, -0.5), start);
  // Diagonal is normalized: total step is WALK_SPEED * dt.
  const diag = w.stepCharacter(yard, start, { x: 1, y: 1 }, 0.1);
  assert.ok(near(Math.hypot(diag.x - start.x, diag.y - start.y), w.WALK_SPEED * 0.1), `diagonal step length ${Math.hypot(diag.x - start.x, diag.y - start.y)}`);
  // Wall: x blocked at the right edge (1520), y still slides.
  const nearWall = { x: 1510, y: 700 };
  const slid = w.stepCharacter(yard, nearWall, { x: 1, y: 1 }, 0.1);
  assert.equal(slid.x, 1510, "x stays at wall");
  assert.ok(near(slid.y, 700 + (w.WALK_SPEED * 0.1) / Math.SQRT2), `y slides: ${slid.y}`);
  // Both axes blocked: same position, new object.
  const corner = { x: 1520, y: 860 };
  const stuck = w.stepCharacter(yard, corner, { x: 1, y: 1 }, 0.1);
  same(stuck, corner);
  assert.notEqual(stuck, corner);
  // A big step cannot jump the wall either.
  assert.equal(w.stepCharacter(yard, nearWall, { x: 1, y: 0 }, 5).x, 1510);

  // walkToward: reaches and snaps onto the target in finite steps.
  const fishingScene = w.HEALING_WORLD.fishing;
  const rod = fishingScene.props.find((p) => p.id === "fishing");
  const target = { x: rod.x + rod.w / 2, y: rod.y + rod.h / 2 };
  let pos = fishingScene.spawn;
  let steps = 0;
  while ((pos.x !== target.x || pos.y !== target.y) && steps < 2000) { pos = w.walkToward(fishingScene, pos, target, 1 / 60); steps += 1; }
  same(pos, target, `walkToward reaches target (steps=${steps})`);
  assert.ok(steps > 10 && steps < 2000, `finite steps: ${steps}`);
  same(w.walkToward(fishingScene, target, target, 1 / 60), target, "already there stays");
  same(fishingScene.spawn, { x: 320, y: 720 }, "spawn not mutated");
  // One step moves exactly WALK_SPEED * dt when the target is far.
  const one = w.walkToward(fishingScene, fishingScene.spawn, target, 0.5);
  assert.ok(near(Math.hypot(one.x - 320, one.y - 720), w.WALK_SPEED * 0.5), "single step length = half a second");
  // Unwalkable target: walks as far as the floor allows, then stops.
  let clamp = yard.spawn;
  for (let i = 0; i < 600; i += 1) clamp = w.walkToward(yard, clamp, { x: 800, y: 100 }, 1 / 30);
  assert.ok(w.isWalkable(yard, clamp), "never leaves the floor");
  assert.ok(clamp.y >= 560 && clamp.y < 560 + w.WALK_SPEED / 30, `stops within one step of the top edge: ${clamp.y}`);
  same(w.walkToward(yard, clamp, { x: 800, y: 100 }, 1 / 30), clamp, "then stays put");
  assert.equal(w.walkToward(yard, yard.spawn, yard.spawn, 0).x, 800);

  // propAt / portalAt / activityForProp.
  assert.equal(w.propAt(fishingScene, target).kind, "fishing");
  assert.equal(w.activityForProp(w.propAt(fishingScene, target).kind), "fishing");
  assert.equal(w.propAt(fishingScene, fishingScene.spawn), null, "spawn is open floor");
  assert.equal(w.portalAt(fishingScene, target), null, "rod is not a portal");
  const toBeach = yard.props.find((p) => p.id === "to-beach");
  const insideBeachPortal = { x: toBeach.x + 10, y: toBeach.y + 10 };
  assert.equal(w.portalAt(yard, insideBeachPortal).to, "beach");
  assert.equal(w.propAt(yard, insideBeachPortal).kind, "portal");
  assert.equal(w.activityForProp("portal"), null);
  assert.equal(w.activityForProp("bench"), "rest");
  assert.equal(w.activityForProp("laptop"), "laptop");
  assert.equal(w.activityForProp("smoke"), "smoke");
  assert.equal(w.activityForProp("hike"), "hike");
  assert.equal(w.activityForProp("stargaze"), "stargaze");
  assert.equal(w.activityForProp("snowman"), "snowman");
  assert.equal(w.activityForProp("campfire"), "campfire");

  // hikeProgress: checkpoints count only in order; 3 = summit.
  const mountain = w.HEALING_WORLD.mountain;
  assert.equal(w.hikeProgress(mountain, []), 0);
  assert.equal(w.hikeProgress(mountain, ["hike-1"]), 1);
  assert.equal(w.hikeProgress(mountain, ["hike-1", "hike-2"]), 2);
  assert.equal(w.hikeProgress(mountain, ["hike-1", "hike-2", "hike-3"]), 3);
  assert.equal(w.hikeProgress(mountain, ["hike-2", "hike-1"]), 1, "out-of-order hike-2 ignored, hike-1 counted");
  assert.equal(w.hikeProgress(mountain, ["hike-2", "hike-1", "hike-2", "hike-3"]), 3, "a detour can be made good by revisiting");
  assert.equal(w.hikeProgress(mountain, ["hike-3"]), 0);
  assert.equal(w.hikeProgress(mountain, ["hike-1", "bench", "hike-2"]), 2, "non-hike visits ignored");
  assert.equal(w.hikeProgress(yard, ["hike-1"]), 0, "no trail outside the mountain");
  // The trail goes upward (smaller y) toward the summit.
  const hikes = mountain.props.filter((p) => p.kind === "hike");
  same(hikes.map((p) => p.id), ["hike-1", "hike-2", "hike-3"]);
  assert.ok(hikes[0].y > hikes[1].y && hikes[1].y > hikes[2].y, "checkpoints climb");

  // activitiesInScene: derived from props, distinct, "walk" last.
  const mountainActs = w.activitiesInScene("mountain");
  assert.ok(mountainActs.includes("hike"));
  assert.ok(mountainActs.includes("walk"));
  assert.ok(!mountainActs.includes("fishing"));
  assert.equal(mountainActs[mountainActs.length - 1], "walk");
  assert.equal(new Set(mountainActs).size, mountainActs.length, "distinct");
  same(w.activitiesInScene("rooftop"), ["smoke", "laptop", "rest", "stargaze", "walk"]);
  same(w.activitiesInScene("yard"), ["rest", "walk"]);
  same(w.activitiesInScene("camp"), ["campfire", "rest", "walk"]);

  // One continuous world: zones side by side, props offset, ids prefixed, bridges where floors meet.
  same(w.WORLD_ZONES.map((z) => z.id), ["beach", "fishing", "yard", "camp", "mountain", "snow-forest", "rooftop"]);
  assert.equal(w.WORLD_SIZE.x, 6 * w.WORLD_WIDTH);
  assert.equal(w.WORLD_SIZE.y, 2 * w.WORLD_HEIGHT);
  same(w.WORLD.spawn, w.zoneSpawn("yard"));
  same(w.zoneSpawn("yard"), { x: 2 * w.WORLD_WIDTH + 800, y: 780 });
  assert.equal(w.zoneAt(w.WORLD.spawn).id, "yard");
  assert.equal(w.zoneAt(w.zoneSpawn("rooftop")).id, "rooftop");
  assert.equal(w.zoneAt({ x: -5, y: 0 }).id, "beach", "outside falls back to the first zone");
  const worldRod = w.WORLD.props.find((p) => p.id === "fishing:fishing");
  same({ x: worldRod.x, y: worldRod.y, w: worldRod.w, h: worldRod.h }, { x: w.WORLD_WIDTH + 1190, y: 650, w: 120, h: 100 });
  assert.equal(w.worldPropId("camp", "campfire"), "camp:campfire");
  assert.ok(w.WORLD.props.some((p) => p.id === "camp:campfire" && p.kind === "campfire"));
  // The whole floor is one space: every zone spawn is walkable, and the sky still is not.
  for (const zone of w.WORLD_ZONES) assert.ok(w.isWalkable(w.WORLD, w.zoneSpawn(zone.id)), `${zone.id} spawn is floor`);
  assert.ok(!w.isWalkable(w.WORLD, { x: w.WORLD_WIDTH + 800, y: 100 }));
  // Walk from the fishing pier straight into the beach: no portal, just the bridge.
  let walker = w.zoneSpawn("fishing");
  for (let i = 0; i < 600 && w.zoneAt(walker).id === "fishing"; i += 1) walker = w.stepCharacter(w.WORLD, walker, { x: -1, y: 0 }, 1 / 60);
  assert.equal(w.zoneAt(walker).id, "beach", "walked across the seam");
  assert.ok(walker.x < w.WORLD_WIDTH, "really on the beach side");
  // ... and from the yard into the camp on the right.
  walker = w.zoneSpawn("yard");
  for (let i = 0; i < 600 && w.zoneAt(walker).id === "yard"; i += 1) walker = w.stepCharacter(w.WORLD, walker, { x: 1, y: 0 }, 1 / 60);
  assert.equal(w.zoneAt(walker).id, "camp", "walked into the camp");
  // The rooftop row is not joined to the ground row: walking up from the yard stays in the yard.
  walker = w.zoneSpawn("yard");
  for (let i = 0; i < 600; i += 1) walker = w.stepCharacter(w.WORLD, walker, { x: 0, y: 1 }, 1 / 60);
  assert.equal(w.zoneAt(walker).id, "yard");
  // Portals still work in world space (the yard's camp gate lands on the camp spawn).
  const gate = w.WORLD.props.find((p) => p.id === "yard:to-camp");
  assert.equal(w.portalAt(w.WORLD, { x: gate.x + 5, y: gate.y + 5 }).to, "camp");
  // hikeProgress over the whole world uses the prefixed ids.
  assert.equal(w.hikeProgress(w.WORLD, ["mountain:hike-1", "mountain:hike-2", "mountain:hike-3"]), 3);
  console.log("PASS: healing world floor, props, portals, walking, hiking, activities, continuous world.");
}
