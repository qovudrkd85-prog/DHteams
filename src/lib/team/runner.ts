// "방파제 달리기" runner mini-game: pure rules (physics, course generator, coins, score, best score).
// Zero imports on purpose: tests transpile this single file into a bare vm sandbox.
// Every function returns new objects and never mutates its inputs.

export const RUNNER = {
  STEP: 1 / 60, GRAVITY: 40, JUMP_V: 13, CUT_V: 5, COYOTE: 0.10, BUFFER: 0.12,
  V0: 6, V_MAX: 12, RAMP_M: 1500, WATER_Y: -2.5, FOOT_HALF: 0.25, LEDGE: 0.35, COIN_R: 0.8,
  COIN_SCORE: 10, RESTART_LOCK: 0.5, START_RUNWAY: 20, TUTORIAL_M: 150,
} as const;

export type RunnerPhase = "ready" | "running" | "paused" | "over";
export type RunnerZone = "breakwater" | "pier" | "levee";
export interface RunnerPlatform { index: number; x: number; length: number; top: number; zone: RunnerZone }
/** kind 는 나중에 "anchor"(와이어 고리) 등을 더할 자리. */
export interface RunnerItem { id: number; kind: "coin"; x: number; y: number }
export interface RunnerLevel { seed: number; rng: number; platforms: readonly RunnerPlatform[]; items: readonly RunnerItem[]; nextId: number }
export interface RunnerState {
  phase: RunnerPhase; level: RunnerLevel; x: number; y: number; vy: number; grounded: boolean;
  coyote: number; buffer: number; held: boolean; coins: number; taken: readonly number[];
  time: number; overFor: number;
}
export interface RunnerInput { held: boolean }
export interface RunnerResult { version: 1; seed: number; dateKey: string; distance: number; coins: number; score: number; durationMs: number }
/** The part of Storage the best-score helpers use (window.localStorage fits). */
export interface RunnerStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }

const { STEP, GRAVITY, JUMP_V, CUT_V, COYOTE, BUFFER, V0, V_MAX, RAMP_M, WATER_Y, FOOT_HALF, LEDGE, COIN_R } = RUNNER;

/** Platform length range per zone, in seconds of running (section 3.4). */
const ZONE_SECONDS: Readonly<Record<RunnerZone, readonly [number, number]>> = {
  breakwater: [0.9, 1.4], pier: [1.0, 1.8], levee: [1.4, 2.2],
};
const PIER_FROM_M = 300;
const LEVEE_FROM_M = 800;
const MAX_TOP = 3;
const MAX_RISE = 1;
const DH_STEPS: readonly number[] = [-1.5, -1, -0.5, 0, 0.5, 1];
const GAP_MIN_RATIO = 0.30;
const GAP_MAX_RATIO = 0.45;
const GAP_MAX_EXTRA = 0.25;
/** Body centre above the feet; coins are picked up around it. */
const BODY_Y = 0.85;
const ROW_COIN_Y = 1.0;
const ROW_COIN_GAP = 1.2;
const ROW_MIN_LENGTH = 8;
const ROW_CHANCE = 0.6;
const ARC_CHANCE = 0.35;
const ARC_FRACTIONS: readonly number[] = [0.25, 0.5, 0.75];
/** Course is built this far ahead of the runner, and dropped this far behind. */
const BUILD_WHEN_M = 80;
const BUILD_TO_M = 160;
const KEEP_BEHIND_M = 30;
const INITIAL_BUILD_M = 200;
const MAX_FLIGHT_STEPS = 600;
const WALL_GAP = 1e-4;
const BEST_KEY = "teams:runner";
/** Visible height of the play field (m) and the runner's spot from the left edge. */
const VIEW_HEIGHT_M = 9;
const RUNNER_SCREEN_X = 0.25;
const LOOK_AHEAD_S = 1.2;

// ---------------------------------------------------------------------------
// Physics
// ---------------------------------------------------------------------------

/** One airborne step: cut the rise when released, then `vy -= g·dt; y += vy·dt`. */
function airStep(y: number, vy: number, held: boolean): { y: number; vy: number } {
  const cut = !held && vy > CUT_V ? CUT_V : vy;
  const next = cut - GRAVITY * STEP;
  return { y: y + next * STEP, vy: next };
}

/** Heights after each step of a jump from y=0; held for the first `holdSteps` steps. */
function jumpPath(dh: number, holdSteps: number): readonly number[] {
  const ys: number[] = [];
  let y = 0;
  let vy: number = JUMP_V;
  for (let n = 1; n <= MAX_FLIGHT_STEPS; n += 1) {
    const next = airStep(y, vy, n <= holdSteps);
    y = next.y;
    vy = next.vy;
    ys.push(y);
    if (vy <= 0 && y <= dh) break;
  }
  return ys;
}

const airTimeCache = new Map<string, number>();

/** 물리와 같은 스텝으로 센 체공 시간. holdSteps 생략 = 끝까지 누름. Infinity when the jump cannot land at dh. */
export function airTime(dh: number, holdSteps: number = Infinity): number {
  const key = `${dh}|${holdSteps}`;
  const cached = airTimeCache.get(key);
  if (cached !== undefined) return cached;
  const ys = jumpPath(dh, holdSteps);
  const landed = ys.length < MAX_FLIGHT_STEPS || ys[ys.length - 1] <= dh;
  const value = landed ? ys.length * STEP : Infinity;
  airTimeCache.set(key, value);
  return value;
}

function safeDistance(distance: number): number {
  return Number.isNaN(distance) ? 0 : Math.max(0, distance);
}

export function difficultyAt(distance: number): number {
  return Math.min(1, safeDistance(distance) / RAMP_M);
}

export function speedAt(distance: number): number {
  return V0 + (V_MAX - V0) * difficultyAt(distance);
}

export function zoneAt(distance: number): RunnerZone {
  const d = safeDistance(distance);
  if (d < PIER_FROM_M) return "breakwater";
  return d < LEVEE_FROM_M ? "pier" : "levee";
}

/** Horizontal distance of a full jump from the edge at `distance` onto a platform `dh` higher. */
export function reachAt(distance: number, dh: number): number {
  return speedAt(distance) * airTime(dh);
}

// ---------------------------------------------------------------------------
// Seeds and random numbers (mulberry32, copied so this file keeps zero imports)
// ---------------------------------------------------------------------------

/** FNV-1a of the date key ("YYYY-MM-DD", Seoul time): everyone gets the same course per day. */
export function dailySeed(dateKey: string): number {
  let hash = 0x811c9dc5;
  for (const ch of String(dateKey)) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash === 0 ? 1 : hash;
}

/** Returns [value in 0..1, next rng state]. */
function nextRandom(state: number): [number, number] {
  const a = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, a];
}

function normalizeSeed(seed: number): number {
  return Number.isFinite(seed) ? Math.trunc(seed) >>> 0 : 1;
}

// ---------------------------------------------------------------------------
// Course generator
// ---------------------------------------------------------------------------

interface Built { platform: RunnerPlatform; items: RunnerItem[]; rng: number; nextId: number }

function pickDh(top: number, roll: number): number {
  const raw = DH_STEPS[Math.min(DH_STEPS.length - 1, Math.floor(roll * DH_STEPS.length))];
  if (top + raw > MAX_TOP) return -Math.abs(raw);
  if (top + raw < 0) return Math.min(Math.abs(raw), MAX_RISE);
  return raw;
}

/** Coins along the full-jump path from the edge, at 25/50/75% of the air time. */
function arcCoins(end: number, top: number, dh: number, firstId: number): RunnerItem[] {
  const speed = speedAt(end);
  const path = jumpPath(dh, Infinity);
  const launchX = end + FOOT_HALF - (speed * STEP) / 2;
  return ARC_FRACTIONS.map((fraction, i) => {
    const k = Math.max(1, Math.round(path.length * fraction));
    return { id: firstId + i, kind: "coin" as const, x: launchX + k * speed * STEP, y: top + path[k - 1] + BODY_Y };
  });
}

function rowCoins(platform: RunnerPlatform, count: number, firstId: number): RunnerItem[] {
  const span = (count - 1) * ROW_COIN_GAP;
  const start = platform.x + (platform.length - span) / 2;
  return Array.from({ length: count }, (_, i) => ({ id: firstId + i, kind: "coin" as const, x: start + i * ROW_COIN_GAP, y: platform.top + ROW_COIN_Y }));
}

/** Next platform after `prev` plus its coins. Always draws the same number of randoms. */
function buildNext(prev: RunnerPlatform, rngIn: number, nextIdIn: number): Built {
  const rolls: number[] = [];
  let rng = rngIn;
  for (let i = 0; i < 6; i += 1) {
    const [value, state] = nextRandom(rng);
    rolls.push(value);
    rng = state;
  }
  const [dhRoll, gapRoll, lengthRoll, arcRoll, rowRoll, countRoll] = rolls;
  const end = prev.x + prev.length;
  const tutorial = end < RUNNER.TUTORIAL_M;
  const dh = tutorial ? 0 : pickDh(prev.top, dhRoll);
  const maxRatio = tutorial ? GAP_MAX_RATIO : GAP_MAX_RATIO + GAP_MAX_EXTRA * difficultyAt(end);
  const gap = reachAt(end, dh) * (GAP_MIN_RATIO + gapRoll * (maxRatio - GAP_MIN_RATIO));
  const x = end + gap;
  const zone = zoneAt(x);
  const [minS, maxS] = ZONE_SECONDS[zone];
  const platform: RunnerPlatform = {
    index: prev.index + 1, x, length: speedAt(x) * (minS + lengthRoll * (maxS - minS)),
    top: Math.round((prev.top + dh) * 2) / 2, zone,
  };
  let nextId = nextIdIn;
  const items: RunnerItem[] = [];
  if (arcRoll < ARC_CHANCE) {
    items.push(...arcCoins(end, prev.top, platform.top - prev.top, nextId));
    nextId += ARC_FRACTIONS.length;
  }
  if (platform.length >= ROW_MIN_LENGTH && rowRoll < ROW_CHANCE) {
    const count = 3 + Math.min(2, Math.floor(countRoll * 3));
    items.push(...rowCoins(platform, count, nextId));
    nextId += count;
  }
  return { platform, items, rng, nextId };
}

export function createLevel(seed: number): RunnerLevel {
  const s = normalizeSeed(seed);
  const first: RunnerPlatform = { index: 0, x: 0, length: RUNNER.START_RUNWAY, top: 0, zone: "breakwater" };
  return extendLevel({ seed: s, rng: s | 0, platforms: [first], items: [], nextId: 1 }, INITIAL_BUILD_M, -Infinity);
}

/** untilX 까지 발판·동전을 이어 붙이고 behindX 뒤는 버린 새 level 을 돌려준다(원본 불변). */
export function extendLevel(level: RunnerLevel, untilX: number, behindX: number): RunnerLevel {
  const platforms = [...level.platforms];
  const items = [...level.items];
  let rng = level.rng;
  let nextId = level.nextId;
  let last = platforms[platforms.length - 1];
  const until = Number.isFinite(untilX) ? untilX : last.x + last.length;
  while (last.x + last.length < until) {
    const built = buildNext(last, rng, nextId);
    platforms.push(built.platform);
    items.push(...built.items);
    rng = built.rng;
    nextId = built.nextId;
    last = built.platform;
  }
  const behind = Number.isNaN(behindX) ? -Infinity : behindX;
  return {
    seed: level.seed, rng, nextId,
    platforms: platforms.filter((p) => p === last || p.x + p.length >= behind),
    items: items.filter((it) => it.x >= behind),
  };
}

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

export function initialRunnerState(seed: number): RunnerState {
  return {
    phase: "ready", level: createLevel(seed), x: 0, y: 0, vy: 0, grounded: true,
    coyote: COYOTE, buffer: 0, held: false, coins: 0, taken: [], time: 0, overFor: 0,
  };
}

const overlaps = (x: number, p: RunnerPlatform) => x + FOOT_HALF >= p.x && x - FOOT_HALF <= p.x + p.length;

// Side faces use the body centre, not the feet: with foot width the smallest tutorial gap
// would let a runner who just walks off get snapped up by the ledge help.

/** Blocks the runner (centre) at a platform's side face hit lower than the ledge help. */
function blockAtWalls(platforms: readonly RunnerPlatform[], fromX: number, toX: number, y: number): number {
  let x = toX;
  for (const p of platforms) {
    if (fromX < p.x && x >= p.x && y < p.top - LEDGE) x = p.x - WALL_GAP;
  }
  return x;
}

/**
 * Highest top landed on this step, or null. From above any foot overlap counts;
 * the ledge help (snap up from up to LEDGE below the top) needs the centre over the platform.
 */
function landingTop(platforms: readonly RunnerPlatform[], x: number, fromY: number, y: number, vy: number): number | null {
  if (vy > 0) return null;
  let top: number | null = null;
  for (const p of platforms) {
    if (y > p.top || (top !== null && p.top <= top)) continue;
    const fromAbove = fromY >= p.top && overlaps(x, p);
    const ledgeHelp = fromY >= p.top - LEDGE && x >= p.x && x <= p.x + p.length;
    if (fromAbove || ledgeHelp) top = p.top;
  }
  return top;
}

function collectCoins(state: RunnerState, items: readonly RunnerItem[], x: number, y: number): { coins: number; taken: readonly number[] } {
  const bodyY = y + BODY_Y;
  const fresh = items.filter((it) => (it.x - x) ** 2 + (it.y - bodyY) ** 2 <= COIN_R * COIN_R && !state.taken.includes(it.id));
  if (fresh.length === 0) return { coins: state.coins, taken: state.taken };
  return { coins: state.coins + fresh.length, taken: [...state.taken, ...fresh.map((it) => it.id)] };
}

function runStep(state: RunnerState, held: boolean, pressed: boolean): RunnerState {
  const buffer = pressed ? BUFFER : Math.max(0, state.buffer - STEP);
  const coyote = state.grounded ? COYOTE : Math.max(0, state.coyote - STEP);
  const jump = buffer > 0 && (state.grounded || coyote > 0);
  let y = state.y;
  let vy = jump ? JUMP_V : state.vy;
  if (state.grounded && !jump) {
    vy = 0;
  } else {
    const next = airStep(y, vy, held);
    y = next.y;
    vy = next.vy;
  }
  const movedX = state.x + speedAt(state.x) * STEP;
  const last = state.level.platforms[state.level.platforms.length - 1];
  const level = last.x + last.length < movedX + BUILD_WHEN_M
    ? extendLevel(state.level, movedX + BUILD_TO_M, movedX - KEEP_BEHIND_M)
    : state.level;
  const x = blockAtWalls(level.platforms, state.x, movedX, y);
  const top = landingTop(level.platforms, x, state.y, y, vy);
  const grounded = top !== null;
  if (grounded) { y = top; vy = 0; }
  const { coins, taken } = collectCoins(state, level.items, x, y);
  return {
    ...state, level, x, y, vy, grounded, held, coins, taken,
    phase: y < WATER_Y ? "over" : "running",
    coyote: jump ? 0 : grounded ? COYOTE : coyote,
    buffer: jump ? 0 : buffer,
    time: state.time + STEP, overFor: 0,
  };
}

/** 한 스텝(1/60초). 입력·상태를 바꾸지 않고 새 상태를 돌려준다. */
export function stepRunner(state: RunnerState, input: RunnerInput): RunnerState {
  const held = Boolean(input && input.held);
  const pressed = held && !state.held;
  switch (state.phase) {
    case "ready":
    case "paused":
      // The start / resume press only starts; it never jumps.
      return pressed ? { ...state, phase: "running", held, buffer: 0 } : { ...state, held };
    case "over":
      if (pressed && state.overFor + 1e-9 >= RUNNER.RESTART_LOCK) return { ...initialRunnerState(state.level.seed), phase: "running", held };
      return { ...state, held, overFor: state.overFor + STEP };
    default:
      return runStep(state, held, pressed);
  }
}

export function pauseRunner(state: RunnerState): RunnerState {
  return state.phase === "running" ? { ...state, phase: "paused" } : { ...state };
}

// ---------------------------------------------------------------------------
// Score, result, view
// ---------------------------------------------------------------------------

export function runnerScore(state: Pick<RunnerState, "x" | "coins">): number {
  return Math.floor(safeDistance(state.x)) + RUNNER.COIN_SCORE * state.coins;
}

export function runnerResult(state: RunnerState, dateKey: string): RunnerResult {
  return {
    version: 1, seed: state.level.seed, dateKey, distance: Math.floor(safeDistance(state.x)),
    coins: state.coins, score: runnerScore(state), durationMs: Math.round(state.time * 1000),
  };
}

/** 보이는 세로 높이(m)와 px/m. 앞쪽 시야 ≥ 1초를 보장. cameraLeftM = metres shown behind the runner. */
export function runnerView(speed: number, cssWidth: number, cssHeight: number): { pxPerM: number; lookAheadM: number; cameraLeftM: number } {
  const width = Math.max(1, Number.isFinite(cssWidth) ? cssWidth : 1);
  const height = Math.max(1, Number.isFinite(cssHeight) ? cssHeight : 1);
  const v = Number.isFinite(speed) && speed > 0 ? speed : V0;
  const pxPerM = Math.min(height / VIEW_HEIGHT_M, ((1 - RUNNER_SCREEN_X) * width) / (v * LOOK_AHEAD_S));
  const widthM = width / pxPerM;
  return { pxPerM, lookAheadM: widthM * (1 - RUNNER_SCREEN_X), cameraLeftM: widthM * RUNNER_SCREEN_X };
}

// ---------------------------------------------------------------------------
// Best score (localStorage "teams:runner"); a convenience only, never throws.
// ---------------------------------------------------------------------------

function defaultStorage(): RunnerStorage | null {
  try {
    const store = (globalThis as { localStorage?: RunnerStorage }).localStorage;
    return store ?? null;
  } catch {
    return null;
  }
}

function parseBest(raw: string | null): number {
  if (raw === null || raw.trim() === "") return 0;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

export function loadRunnerBest(storage: RunnerStorage | null = defaultStorage()): number {
  if (!storage) return 0;
  try {
    return parseBest(storage.getItem(BEST_KEY));
  } catch {
    return 0;
  }
}

/** Saves only when higher. Returns the best score (also when saving failed). */
export function saveRunnerBest(score: number, storage: RunnerStorage | null = defaultStorage()): number {
  const best = loadRunnerBest(storage);
  const next = Number.isFinite(score) && score > 0 ? Math.floor(score) : 0;
  if (next <= best) return best;
  try {
    storage?.setItem(BEST_KEY, String(next));
  } catch {
    /* Storage full or blocked: the best is still returned for this session. */
  }
  return next;
}
