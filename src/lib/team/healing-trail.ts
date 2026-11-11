// Healing "walk along" trail: a looping path through the healing places, walked with the arrow keys.
// Pure data + state machine. Tests load this in a bare vm sandbox: type-only imports only.

import type { HealingActivityId, HealingSceneId } from "./healing";

/** A stretch of the loop. "yard" is the rest yard between the fishing pier and the camp. */
export type BiomeId = HealingSceneId | "yard";

export const SEGMENT_LENGTH = 150;
/** Loop order; the rooftop garden path leads back down to the beach. */
export const TRAIL: readonly BiomeId[] = ["beach", "fishing", "yard", "camp", "mountain", "snow-forest", "rooftop"];
export const TRAIL_LENGTH = SEGMENT_LENGTH * TRAIL.length;
/** Metres on each side of a seam where colours and props blend. */
export const BLEND_RANGE = 30;

export const WALK_SPEED = 1.2;
export const SIDE_SPEED = 1.1;
/** How far left/right of the centre line you can walk on the path (m). */
export const WALK_HALF = 1;
/** Where you sit at a spot, measured from the centre line (m). */
export const SPOT_OFFSET = 3;
/** A spot's entrance (signpost) is usable this far before/after it (m). */
export const ENTRANCE_HALF = 1.6;
const MAX_DT = 0.25;

export type SpotKind = "sunbed" | "bench" | "pier" | "picnic" | "campfire" | "log" | "flag" | "lookout" | "snowman" | "rail" | "desk" | "telescope";

export interface TrailSpot {
  id: string;
  biome: BiomeId;
  /** Distance along the loop (m). */
  at: number;
  /** -1 = left of the path, 1 = right. */
  side: -1 | 1;
  activity: HealingActivityId;
  kind: SpotKind;
  /** Signpost text. */
  label: string;
  summit?: boolean;
  /** Only open after dark. */
  night?: boolean;
}

const spot = (id: string, segment: number, offset: number, side: -1 | 1, activity: HealingActivityId, kind: SpotKind, label: string, extra: Partial<TrailSpot> = {}): TrailSpot =>
  ({ id, biome: TRAIL[segment], at: segment * SEGMENT_LENGTH + offset, side, activity, kind, label, ...extra });

/** Sorted by distance. Every place's own spot is 18 m in, so picking a place reaches it in ~15 s. */
export const TRAIL_SPOTS: readonly TrailSpot[] = [
  spot("beach-sunbed", 0, 18, 1, "rest", "sunbed", "☀️ 선베드"),
  spot("beach-bench", 0, 110, 1, "rest", "bench", "🪑 벤치"),
  spot("fishing-pier", 1, 18, -1, "fishing", "pier", "🎣 낚시터"),
  spot("fishing-bench", 1, 95, 1, "rest", "bench", "🪑 벤치"),
  spot("yard-bench", 2, 18, 1, "rest", "bench", "🪑 쉼터 벤치"),
  spot("yard-picnic", 2, 105, -1, "rest", "picnic", "🧺 피크닉"),
  spot("camp-fire", 3, 18, 1, "campfire", "campfire", "🔥 캠핑장"),
  spot("camp-log", 3, 105, -1, "rest", "log", "🪵 통나무"),
  spot("mountain-flag-1", 4, 18, 1, "hike", "flag", "🚩 쉼터"),
  spot("mountain-flag-2", 4, 68, -1, "hike", "flag", "🚩 쉼터"),
  spot("mountain-lookout", 4, 125, 1, "hike", "lookout", "⛰️ 전망대", { summit: true }),
  spot("snow-snowman", 5, 18, -1, "snowman", "snowman", "⛄ 눈사람"),
  spot("snow-bench", 5, 100, 1, "rest", "bench", "🪑 벤치"),
  spot("rooftop-rail", 6, 18, -1, "smoke", "rail", "🌿 난간"),
  spot("rooftop-desk", 6, 65, 1, "laptop", "desk", "💻 책상"),
  spot("rooftop-scope", 6, 110, -1, "stargaze", "telescope", "🔭 망원경", { night: true }),
];

export function wrapDistance(distance: number): number {
  const d = distance % TRAIL_LENGTH;
  return d < 0 ? d + TRAIL_LENGTH : d;
}

/** Shortest signed gap from `from` to `to` around the loop. */
export function loopGap(from: number, to: number): number {
  const d = wrapDistance(to - from);
  return d > TRAIL_LENGTH / 2 ? d - TRAIL_LENGTH : d;
}

export function trailStart(sceneId: unknown): number {
  const index = TRAIL.indexOf(sceneId as BiomeId);
  return index < 0 ? 0 : index * SEGMENT_LENGTH;
}

export interface BiomeInfo {
  id: BiomeId;
  /** The neighbour being blended toward (equals id away from seams). */
  next: BiomeId;
  /** 0 = pure id, 0.5 = right on the seam. */
  blend: number;
}

export function biomeAt(distance: number): BiomeInfo {
  const d = wrapDistance(distance);
  const index = Math.min(TRAIL.length - 1, Math.floor(d / SEGMENT_LENGTH));
  const local = d - index * SEGMENT_LENGTH;
  const id = TRAIL[index];
  if (local > SEGMENT_LENGTH - BLEND_RANGE) {
    return { id, next: TRAIL[(index + 1) % TRAIL.length], blend: (local - (SEGMENT_LENGTH - BLEND_RANGE)) / (2 * BLEND_RANGE) };
  }
  if (local < BLEND_RANGE) {
    return { id, next: TRAIL[(index + TRAIL.length - 1) % TRAIL.length], blend: (BLEND_RANGE - local) / (2 * BLEND_RANGE) };
  }
  return { id, next: id, blend: 0 };
}

/** The spot whose signpost you are standing next to, if any. */
export function entranceAt(distance: number, isDay = true): TrailSpot | null {
  return TRAIL_SPOTS.find((s) => (isDay ? !s.night : true) && Math.abs(loopGap(distance, s.at)) <= ENTRANCE_HALF) ?? null;
}

export function findSpot(id: string | null): TrailSpot | null {
  return id === null ? null : TRAIL_SPOTS.find((s) => s.id === id) ?? null;
}

export type TrailPhase = "standing" | "walking" | "entering" | "activity" | "leaving";

export interface TrailState {
  readonly distance: number;
  /** Metres from the path centre line; past ±WALK_HALF only while at a spot. */
  readonly lateral: number;
  readonly phase: TrailPhase;
  readonly spotId: string | null;
  readonly phaseTime: number;
  /** 1 = walking away from the camera, -1 = turned around toward it. */
  readonly facing: 1 | -1;
  /** Hands-free walking started by a tap (phone). */
  readonly auto: boolean;
}

export interface TrailInput {
  /** ↑ = 1, ↓ = -1. */
  forward: -1 | 0 | 1;
  /** ← = -1, → = 1. */
  side: -1 | 0 | 1;
  /** One tap/click this frame. */
  tap: boolean;
}

export interface TrailEnv {
  isDay?: boolean;
}

export function initialTrailState(sceneId: unknown): TrailState {
  return { distance: trailStart(sceneId), lateral: 0, phase: "standing", spotId: null, phaseTime: 0, facing: 1, auto: false };
}

const approach = (value: number, target: number, maxStep: number) =>
  Math.abs(target - value) <= maxStep ? target : value + Math.sign(target - value) * maxStep;

function stepPath(state: TrailState, input: TrailInput, dt: number, isDay: boolean): TrailState {
  const auto = input.tap ? !state.auto : input.forward !== 0 ? false : state.auto;
  const facing: 1 | -1 = input.forward !== 0 ? input.forward : state.facing;
  const move = input.forward !== 0 ? input.forward : auto ? facing : 0;
  const distance = move === 0 ? state.distance : wrapDistance(state.distance + move * WALK_SPEED * dt);
  const lateral = Math.max(-WALK_HALF, Math.min(WALK_HALF, state.lateral + input.side * SIDE_SPEED * dt));
  const entrance = input.side !== 0 ? entranceAt(distance, isDay) : null;
  if (entrance && entrance.side === input.side && Math.abs(lateral) >= WALK_HALF) {
    return { distance, lateral, phase: "entering", spotId: entrance.id, phaseTime: 0, facing: 1, auto: false };
  }
  const phase: TrailPhase = move !== 0 || input.side !== 0 ? "walking" : "standing";
  return { distance, lateral, phase, spotId: null, phaseTime: phase === state.phase ? state.phaseTime + dt : 0, facing, auto };
}

const wantsOut = (input: TrailInput, side: -1 | 1) => input.forward !== 0 || input.tap || input.side === -side;

/** One frame of the state machine. Returns a new state; never mutates `state`. */
export function stepTrail(state: TrailState, input: TrailInput, dt: number, env: TrailEnv = {}): TrailState {
  if (!Number.isFinite(dt) || dt <= 0) return state;
  const step = Math.min(dt, MAX_DT);
  const isDay = env.isDay ?? true;
  const at = findSpot(state.spotId);
  if (state.phase === "standing" || state.phase === "walking" || !at) return stepPath(state, input, step, isDay);
  const leaving = (): TrailState => ({ ...state, phase: "leaving", phaseTime: 0, auto: false });
  if (state.phase === "entering") {
    if (wantsOut(input, at.side)) return leaving();
    const target = at.side * SPOT_OFFSET;
    const lateral = approach(state.lateral, target, SIDE_SPEED * step);
    const distance = wrapDistance(state.distance + approach(0, loopGap(state.distance, at.at), WALK_SPEED * step));
    const arrived = lateral === target && Math.abs(loopGap(distance, at.at)) < 1e-9;
    return { ...state, distance: arrived ? at.at : distance, lateral, phase: arrived ? "activity" : "entering", phaseTime: arrived ? 0 : state.phaseTime + step };
  }
  if (state.phase === "activity") {
    if (wantsOut(input, at.side)) return leaving();
    return { ...state, phaseTime: state.phaseTime + step };
  }
  // Leaving: step back onto the path edge, then carry on with whatever key is held.
  const lateral = approach(state.lateral, at.side * WALK_HALF, SIDE_SPEED * step);
  if (lateral !== at.side * WALK_HALF) return { ...state, lateral, phaseTime: state.phaseTime + step };
  const back: TrailState = { ...state, lateral, phase: "standing", spotId: null, phaseTime: 0 };
  return input.forward !== 0 ? stepPath(back, { ...input, side: 0, tap: false }, step, isDay) : back;
}

/** What the character is doing, for the caption and data-activity. */
export function activityOf(state: TrailState): HealingActivityId {
  if (state.phase !== "activity") return "walk";
  return findSpot(state.spotId)?.activity ?? "walk";
}
