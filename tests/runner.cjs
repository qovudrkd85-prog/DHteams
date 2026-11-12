/* eslint-disable @typescript-eslint/no-require-imports -- Pure runner rules, no network. */
// "방파제 달리기" rules engine (src/lib/team/runner.ts): physics, level generator, coins, score, best score.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const load = (rel) => {
  const src = fs.readFileSync(path.resolve(__dirname, rel), "utf8");
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const box = { exports: {}, module: { exports: {} } };
  box.exports = box.module.exports;
  vm.runInNewContext(js, box);
  return box.module.exports;
};
const plain = (value) => JSON.parse(JSON.stringify(value));
const same = (actual, expected, message) => assert.deepEqual(plain(actual), plain(expected), message);
const near = (actual, expected, tol, message) => assert.ok(Math.abs(actual - expected) <= tol, `${message}: expected ${expected}±${tol}, got ${actual}`);
const deepFreeze = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
};

const r = load("../src/lib/team/runner.ts");
const { RUNNER } = r;
const STEP = RUNNER.STEP;
const DOWN = Object.freeze({ held: true });
const UP = Object.freeze({ held: false });

/** Ready -> running with one press, then the button is released. */
const started = (seed) => r.stepRunner(r.stepRunner(r.initialRunnerState(seed), DOWN), UP);
const platformUnder = (state) => state.level.platforms.find((p) => state.x + RUNNER.FOOT_HALF >= p.x && state.x - RUNNER.FOOT_HALF <= p.x + p.length);

// 1. Jump numbers (section 4.1), counted with the same steps as the game.
near(r.airTime(0), 0.65, 0.02, "flat long jump air time");
near(r.airTime(1.0), 0.55, 0.02, "+1.0 m long jump air time");
near(r.airTime(-1.5), 0.75, 0.02, "-1.5 m long jump air time");
near(r.airTime(0, 1), 0.30, 0.02, "1-step tap air time");
{
  // Peak height of a held jump, measured through stepRunner on the start runway.
  let s = started(1);
  s = r.stepRunner(s, DOWN);
  assert.equal(s.grounded, false, "pressing on the ground jumps");
  let peak = s.y;
  let airSteps = 1;
  while (!s.grounded) { s = r.stepRunner(s, DOWN); peak = Math.max(peak, s.y); airSteps += 1; }
  near(peak, 2.0, 0.05, "held jump peak height");
  near(airSteps * STEP, r.airTime(0), 1e-9, "game air time equals airTime(0)");
}

// 2. Speed curve.
assert.equal(r.speedAt(0), 6);
assert.equal(r.speedAt(750), 9);
assert.equal(r.speedAt(1500), 12);
assert.equal(r.speedAt(5000), 12);
assert.equal(r.speedAt(-10), 6);
assert.equal(r.speedAt(Number.NaN), 6);
assert.equal(r.difficultyAt(750), 0.5);
assert.equal(r.zoneAt(10), "breakwater");
assert.equal(r.zoneAt(500), "pier");
assert.equal(r.zoneAt(900), "levee");

// 3. Every gap is jumpable: seeds 1..200, 0..3000 m.
const ZONE_MIN = { breakwater: 0.9, pier: 1.0, levee: 1.4 };
const EPS = 1e-9;
for (let seed = 1; seed <= 200; seed += 1) {
  const level = r.extendLevel(r.createLevel(seed), 3000, -Infinity);
  const ps = level.platforms;
  assert.equal(ps[0].x, 0, "first platform starts at 0");
  assert.equal(ps[0].length, RUNNER.START_RUNWAY, "first platform is the 20 m runway");
  assert.ok(ps[ps.length - 1].x + ps[ps.length - 1].length >= 3000, `seed ${seed} reaches 3000 m`);
  for (let i = 0; i < ps.length; i += 1) {
    const p = ps[i];
    assert.ok(p.top >= 0 && p.top <= 3 && Number.isInteger(p.top * 2), `seed ${seed} #${i} top ${p.top}`);
    if (i === 0) continue;
    assert.ok(p.length >= 0.9 * r.speedAt(p.x) - EPS, `seed ${seed} #${i} length ${p.length} >= 0.9 s`);
    assert.ok(p.length >= ZONE_MIN[p.zone] * r.speedAt(p.x) - EPS, `seed ${seed} #${i} zone length`);
    const prev = ps[i - 1];
    const end = prev.x + prev.length;
    const dh = p.top - prev.top;
    const gap = p.x - end;
    const reach = r.reachAt(end, dh);
    assert.ok(Math.abs(dh) <= 1.5 + EPS && dh <= 1.0 + EPS, `seed ${seed} #${i} dh ${dh}`);
    assert.ok(gap <= 0.70 * reach + EPS, `seed ${seed} #${i} gap ${gap} <= 0.70 x reach ${reach}`);
    assert.ok(gap >= 0.30 * reach - EPS, `seed ${seed} #${i} gap ${gap} >= 0.30 x reach ${reach}`);
    if (end < RUNNER.TUTORIAL_M) {
      assert.equal(dh, 0, `seed ${seed} #${i} tutorial is flat`);
      assert.ok(gap <= 0.45 * reach + EPS, `seed ${seed} #${i} tutorial gap ratio`);
    }
    assert.equal(p.index, prev.index + 1, "platform indexes are consecutive");
  }
}

// 4. Bots finish 3000 m. A jumps on the last grounded step; B jumps 0.12 s before the edge.
const botA = (s) => {
  const p = platformUnder(s);
  return Boolean(p) && s.x + r.speedAt(s.x) * STEP - RUNNER.FOOT_HALF > p.x + p.length;
};
const botB = (s) => {
  const p = platformUnder(s);
  return Boolean(p) && p.x + p.length - s.x <= 0.12 * r.speedAt(s.x);
};
const runBot = (seed, decide) => {
  let s = started(seed);
  const items = new Map();
  const platforms = new Map();
  let seenLevel = null;
  let steps = 0;
  while (s.x < 3000) {
    if (s.level !== seenLevel) {
      seenLevel = s.level;
      for (const it of s.level.items) items.set(it.id, it);
      for (const p of s.level.platforms) platforms.set(p.index, p);
    }
    const held = s.grounded ? decide(s) : s.held;
    s = r.stepRunner(s, held ? DOWN : UP);
    assert.notEqual(s.phase, "over", `seed ${seed} bot fell at x=${s.x.toFixed(2)}`);
    steps += 1;
    assert.ok(steps < 60 * 400, "bot run is bounded");
  }
  return { s, items, platforms };
};
for (let seed = 1; seed <= 100; seed += 1) {
  const a = runBot(seed, botA);
  // Arc coins sit over gaps; bot A (full jump from the edge) must collect every one it passed.
  const ps = [...a.platforms.values()].sort((p, q) => p.index - q.index);
  const taken = new Set(a.s.taken);
  let arcCoins = 0;
  for (const it of a.items.values()) {
    if (it.x > a.s.x - 5) continue;
    const overGap = ps.some((p, i) => i > 0 && it.x > ps[i - 1].x + ps[i - 1].length && it.x < p.x);
    if (!overGap) continue;
    arcCoins += 1;
    assert.ok(taken.has(it.id), `seed ${seed} bot A missed arc coin ${it.id} at x=${it.x.toFixed(2)}`);
  }
  if (seed === 1) assert.ok(arcCoins > 0, "seed 1 has arc coins");
  assert.equal(a.s.coins, a.s.taken.length, "coin count equals taken ids");
  runBot(seed, botB);
}

// 5. No input: run off the 20 m runway and fall into the water.
{
  let s = started(7);
  let steps = 0;
  while (s.phase === "running" && steps < 600) { s = r.stepRunner(s, UP); steps += 1; }
  assert.equal(s.phase, "over");
  assert.ok(s.x >= 20 && s.x <= 24, `fell at ${s.x}`);
  assert.ok(s.y < RUNNER.WATER_Y);
}

// 6. Determinism.
{
  const script = (i) => (i % 47 < 12 ? DOWN : UP);
  const play = (seed) => { let s = r.initialRunnerState(seed); for (let i = 0; i < 900; i += 1) s = r.stepRunner(s, script(i)); return s; };
  same(play(42), play(42), "same seed + same inputs -> same state");
  const once = r.extendLevel(r.createLevel(9), 2000, -Infinity);
  let pieces = r.createLevel(9);
  for (const until of [300, 301, 750, 1200, 1999, 2000]) pieces = r.extendLevel(pieces, until, -Infinity);
  same(pieces.platforms, once.platforms, "extendLevel in one go or in pieces -> same platforms");
  same(pieces.items, once.items, "extendLevel in pieces -> same items");
  const other = r.extendLevel(r.createLevel(10), 2000, -Infinity);
  assert.notDeepEqual(plain(other.platforms), plain(once.platforms), "different seed -> different course");
  // Discarding behind keeps the platforms ahead identical.
  const trimmed = r.extendLevel(once, 2000, 1000);
  assert.ok(trimmed.platforms.every((p) => p.x + p.length >= 1000), "behindX drops old platforms");
  same(trimmed.platforms, once.platforms.filter((p) => p.x + p.length >= 1000), "trim keeps the rest as is");
  assert.ok(once.platforms.length > trimmed.platforms.length, "something was dropped");
}

// 7. Coyote time and jump buffer.
{
  const walkOff = () => {
    let s = started(3);
    while (s.grounded) s = r.stepRunner(s, UP);
    return s; // first airborne state after leaving the runway
  };
  const pressAfter = (airSteps) => {
    let s = walkOff();
    for (let i = 1; i < airSteps; i += 1) s = r.stepRunner(s, UP);
    return r.stepRunner(s, DOWN);
  };
  const coyoteYes = pressAfter(Math.round(0.08 / STEP));
  assert.equal(coyoteYes.vy > 0, true, "press 0.08 s after leaving still jumps");
  const coyoteNo = pressAfter(Math.round(0.15 / STEP));
  assert.equal(coyoteNo.vy > 0, false, "press 0.15 s after leaving does not jump");

  // Tap jump on the runway (lands after airTime(0, 1)), then press again before landing.
  const tapLandSteps = Math.round(r.airTime(0, 1) / STEP);
  const buffered = (earlySteps) => {
    let s = r.stepRunner(started(3), DOWN); // jump, held 1 step
    for (let i = 1; i < tapLandSteps - earlySteps; i += 1) s = r.stepRunner(s, UP);
    s = r.stepRunner(s, DOWN); // early press, held 1 step
    for (let i = 0; i < earlySteps - 1; i += 1) s = r.stepRunner(s, UP);
    assert.equal(s.grounded, true, "landed on schedule");
    return r.stepRunner(s, UP);
  };
  const bufYes = buffered(Math.round(0.10 / STEP));
  assert.equal(bufYes.grounded === false && bufYes.vy > 0, true, "press 0.10 s before landing jumps on landing");
  const bufNo = buffered(Math.round(0.20 / STEP));
  assert.equal(bufNo.grounded, true, "press 0.20 s before landing is forgotten");
}

// 8. Variable jump: holding longer never lowers the peak.
{
  let last = -Infinity;
  for (let hold = 1; hold <= 40; hold += 1) {
    let s = r.stepRunner(started(5), DOWN);
    let peak = s.y;
    let i = 1;
    while (!s.grounded) { s = r.stepRunner(s, i < hold ? DOWN : UP); peak = Math.max(peak, s.y); i += 1; }
    assert.ok(peak >= last - EPS, `hold ${hold}: peak ${peak} >= ${last}`);
    last = peak;
  }
  near(last, 2.0, 0.05, "longest hold reaches the full peak");
}

// 9. Immutability: frozen state and input in every phase.
{
  const states = [];
  states.push(r.initialRunnerState(11));
  states.push(started(11));
  states.push(r.stepRunner(started(11), DOWN)); // airborne
  states.push(r.pauseRunner(started(11)));
  let over = started(11);
  while (over.phase !== "over") over = r.stepRunner(over, UP);
  states.push(over);
  for (const st of states) {
    const frozen = deepFreeze(plain(st));
    const before = JSON.stringify(frozen);
    for (const input of [DOWN, UP]) {
      assert.doesNotThrow(() => r.stepRunner(frozen, input), `phase ${st.phase}`);
    }
    assert.doesNotThrow(() => r.pauseRunner(frozen));
    assert.doesNotThrow(() => r.extendLevel(frozen.level, frozen.x + 500, frozen.x - 10));
    assert.equal(JSON.stringify(frozen), before, `phase ${st.phase} unchanged`);
  }
}

// 10. Phase transitions.
{
  const ready = r.initialRunnerState(21);
  assert.equal(ready.phase, "ready");
  assert.equal(r.stepRunner(ready, UP).phase, "ready", "no press stays ready");
  const run = r.stepRunner(ready, DOWN);
  assert.equal(run.phase, "running", "ready + press -> running");
  assert.equal(run.grounded, true, "the start press is not a jump");

  let over = started(21);
  while (over.phase !== "over") over = r.stepRunner(over, UP);
  const early = r.stepRunner(over, DOWN);
  assert.equal(early.phase, "over", "press before 0.5 s is ignored");
  let wait = r.stepRunner(early, UP);
  while (wait.overFor < RUNNER.RESTART_LOCK) wait = r.stepRunner(wait, UP);
  const again = r.stepRunner(wait, DOWN);
  assert.equal(again.phase, "running", "press after 0.5 s restarts running (not ready)");
  assert.equal(again.x, 0);
  assert.equal(again.coins, 0);
  assert.equal(again.level.seed, over.level.seed, "same seed");
  same(again.level.platforms.slice(0, 5), r.initialRunnerState(21).level.platforms.slice(0, 5), "same course");

  const paused = r.pauseRunner(r.stepRunner(started(21), UP));
  assert.equal(paused.phase, "paused");
  assert.equal(r.stepRunner(paused, UP).phase, "paused", "paused waits");
  const resumed = r.stepRunner(paused, DOWN);
  assert.equal(resumed.phase, "running", "paused + press -> running");
  assert.equal(resumed.grounded, true, "the resume press does not jump");
  assert.equal(resumed.x, paused.x, "the resume step does not move");
  const next = r.stepRunner(resumed, DOWN);
  assert.equal(next.grounded, true, "still holding the resume press does not jump");
  assert.equal(r.pauseRunner(ready).phase, "ready", "pause only affects running");
}

// 11. Score and coins.
assert.equal(r.runnerScore({ x: 412.9, coins: 7 }), 482);
assert.equal(r.runnerScore({ x: -3, coins: 0 }), 0);
{
  const s0 = started(31);
  const coin = { id: 999999, kind: "coin", x: s0.x + 0.3, y: s0.y + 0.85 };
  let s = { ...s0, level: { ...s0.level, items: [coin] } };
  for (let i = 0; i < 20; i += 1) s = r.stepRunner(s, UP);
  assert.equal(s.coins, 1, "a coin is counted once");
  same(s.taken, [999999]);
  const result = r.runnerResult(s, "2026-11-12");
  assert.equal(result.version, 1);
  assert.equal(result.seed, s.level.seed);
  assert.equal(result.dateKey, "2026-11-12");
  assert.equal(result.distance, Math.floor(s.x));
  assert.equal(result.coins, 1);
  assert.equal(result.score, r.runnerScore(s));
  assert.equal(result.durationMs, Math.round(s.time * 1000));
}

// 12. Best score storage (key "teams:runner").
{
  const memory = () => {
    const map = new Map();
    return { map, getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => { map.set(k, String(v)); } };
  };
  const store = memory();
  assert.equal(r.loadRunnerBest(store), 0, "empty storage -> 0");
  assert.equal(r.saveRunnerBest(120, store), 120);
  assert.equal(r.loadRunnerBest(store), 120, "saved best is read back");
  assert.ok(store.map.has("teams:runner"));
  assert.equal(r.saveRunnerBest(80, store), 120, "a lower score keeps the best");
  assert.equal(r.loadRunnerBest(store), 120, "a lower score does not overwrite");
  assert.equal(r.saveRunnerBest(300, store), 300);
  for (const bad of ["{broken", "-5", "abc", "NaN", "Infinity"]) {
    store.map.set("teams:runner", bad);
    assert.equal(r.loadRunnerBest(store), 0, `bad value ${bad} -> 0`);
  }
  const throwing = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("quota"); } };
  assert.equal(r.loadRunnerBest(throwing), 0, "getItem throwing -> 0");
  assert.doesNotThrow(() => r.saveRunnerBest(50, throwing));
  assert.equal(r.saveRunnerBest(50, throwing), 50, "setItem throwing still returns the best");
  const setThrows = { getItem: () => "10", setItem: () => { throw new Error("quota"); } };
  assert.equal(r.saveRunnerBest(50, setThrows), 50);
  assert.equal(r.loadRunnerBest(null), 0, "no storage -> 0");
  assert.equal(r.loadRunnerBest(), 0, "no global localStorage -> 0");
  assert.doesNotThrow(() => r.saveRunnerBest(5));
}

// 13. View: at least 1 s of look-ahead.
for (const speed of [6, 12]) {
  for (const [w, h] of [[358, 201], [1280, 720]]) {
    const v = r.runnerView(speed, w, h);
    assert.ok(v.pxPerM > 0 && Number.isFinite(v.pxPerM), "px/m is positive");
    assert.ok(v.lookAheadM / speed >= 1.0, `${w}x${h} @${speed}: look-ahead ${v.lookAheadM} m`);
    assert.ok(v.cameraLeftM >= 0, "camera keeps some metres behind the runner");
    near(v.lookAheadM + v.cameraLeftM, w / v.pxPerM, 1e-6, "view width adds up");
  }
}

// 14. Daily seed: a fixed integer per Seoul date key.
{
  const seed = r.dailySeed("2026-11-12");
  assert.ok(Number.isInteger(seed) && seed > 0 && seed <= 0xffffffff);
  assert.equal(seed, r.dailySeed("2026-11-12"));
  assert.equal(seed, 1780209632, "pinned FNV-1a: changing the hash changes everyone's course");
  assert.notEqual(r.dailySeed("2026-11-13"), seed);
}

console.log("PASS: runner jump physics, speed, jumpable gaps, bots to 3000 m, coyote/buffer, determinism, immutability, phases, score, best, view, daily seed.");
