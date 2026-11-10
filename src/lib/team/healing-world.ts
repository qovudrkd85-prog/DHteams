// Healing world: walkable floors, props and portals of each healing zone,
// plus the pure movement helpers. Client-only data, no network, no state.
// Coordinates: every zone is 1600x900 logical units; a character position is
// its foot point. Rects are top-left corner + size. All functions are pure and
// return new objects; inputs are never mutated.
// The zones are laid side by side into one continuous WORLD (see WORLD_ZONES)
// so the character can simply keep walking from one place to the next.
import type { HealingSceneId } from "./healing";

export interface Rect { x: number; y: number; w: number; h: number }
export interface Vec { x: number; y: number }

export type SceneArtId = HealingSceneId | "yard";
export type HealingPropKind = "fishing" | "smoke" | "hike" | "bench" | "laptop" | "stargaze" | "snowman" | "campfire" | "portal";
export type WorldActivityId = "laptop" | "fishing" | "walk" | "rest" | "smoke" | "hike" | "stargaze" | "snowman" | "campfire";

export interface HealingProp extends Rect {
  id: string;
  kind: HealingPropKind;
  label: string;
  /** Portals only: the scene this entrance leads to. */
  to?: SceneArtId;
}

/** Anything the movement helpers need: floors and props in one coordinate space. */
export interface WorldMap {
  spawn: Vec;
  /** Union of floor rects the foot point may stand on. */
  walkable: readonly Rect[];
  props: readonly HealingProp[];
}

export interface HealingWorldScene extends WorldMap {
  id: SceneArtId;
}

export const WORLD_WIDTH = 1600;
export const WORLD_HEIGHT = 900;
/** Walking speed in logical units per second (brisker than the office so one zone takes ~7 s). */
export const WALK_SPEED = 240;

/** Delay before a portal fires once the character stands on it (ms). */
export const PORTAL_DELAY_MS = 300;

const rect = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });
const prop = (id: string, kind: HealingPropKind, x: number, y: number, w: number, h: number, label: string, to?: SceneArtId): HealingProp =>
  to === undefined ? { id, kind, x, y, w, h, label } : { id, kind, x, y, w, h, label, to };
const backToYard = (x: number, y: number): HealingProp => prop("to-yard", "portal", x, y, 140, 90, "마당으로", "yard");

/** Scene geometry per the shared coordinate table (plan 2026-11-10). */
export const HEALING_WORLD: Record<SceneArtId, HealingWorldScene> = {
  yard: {
    id: "yard",
    spawn: { x: 800, y: 780 },
    walkable: [rect(80, 560, 1440, 300)],
    props: [
      prop("to-beach", "portal", 130, 560, 140, 90, "바닷가", "beach"),
      prop("to-fishing", "portal", 370, 560, 140, 90, "낚시터", "fishing"),
      prop("to-mountain", "portal", 610, 560, 140, 90, "산", "mountain"),
      prop("to-rooftop", "portal", 850, 560, 140, 90, "옥상", "rooftop"),
      prop("to-camp", "portal", 1090, 560, 140, 90, "캠핑장", "camp"),
      prop("to-snow-forest", "portal", 1330, 560, 140, 90, "눈 숲", "snow-forest"),
      prop("bench", "bench", 720, 760, 160, 80, "벤치"),
    ],
  },
  beach: {
    id: "beach",
    spawn: { x: 300, y: 760 },
    walkable: [rect(0, 520, 1600, 360)],
    props: [prop("bench", "bench", 1020, 720, 160, 80, "파라솔 의자"), backToYard(50, 780)],
  },
  fishing: {
    id: "fishing",
    spawn: { x: 320, y: 720 },
    walkable: [rect(200, 600, 1200, 200)],
    props: [
      prop("fishing", "fishing", 1190, 650, 120, 100, "낚싯대"),
      prop("bench", "bench", 620, 700, 160, 80, "잔교 의자"),
      backToYard(170, 735),
    ],
  },
  mountain: {
    id: "mountain",
    spawn: { x: 300, y: 820 },
    walkable: [rect(100, 740, 1400, 140), rect(700, 560, 800, 200), rect(300, 380, 800, 200), rect(500, 220, 500, 180)],
    props: [
      prop("hike-1", "hike", 1140, 605, 120, 90, "쉼터 1"),
      prop("hike-2", "hike", 540, 425, 120, 90, "쉼터 2"),
      prop("hike-3", "hike", 690, 250, 140, 100, "정상 깃발"),
      backToYard(90, 795),
    ],
  },
  // Day and night share one rooftop (the world clock is global); the telescope is simply there.
  rooftop: {
    id: "rooftop",
    spawn: { x: 800, y: 760 },
    walkable: [rect(80, 520, 1440, 340)],
    props: [
      prop("smoke", "smoke", 1320, 550, 120, 100, "난간 재떨이"),
      prop("laptop", "laptop", 420, 570, 160, 100, "옥상 책상"),
      prop("bench", "bench", 820, 760, 160, 80, "벤치"),
      prop("stargaze", "stargaze", 1040, 545, 140, 110, "망원경"),
      backToYard(90, 775),
    ],
  },
  camp: {
    id: "camp",
    spawn: { x: 300, y: 780 },
    walkable: [rect(100, 540, 1400, 340)],
    props: [
      prop("campfire", "campfire", 720, 640, 160, 120, "모닥불"),
      prop("bench", "bench", 1100, 740, 160, 80, "통나무 의자"),
      backToYard(90, 795),
    ],
  },
  "snow-forest": {
    id: "snow-forest",
    spawn: { x: 300, y: 780 },
    walkable: [rect(100, 540, 1400, 340)],
    props: [
      prop("snowman", "snowman", 1130, 620, 140, 120, "눈사람"),
      prop("bench", "bench", 620, 760, 160, 80, "통나무 의자"),
      backToYard(90, 795),
    ],
  },
};

const PROP_ACTIVITY: Record<HealingPropKind, WorldActivityId | null> = {
  fishing: "fishing",
  smoke: "smoke",
  hike: "hike",
  bench: "rest",
  laptop: "laptop",
  stargaze: "stargaze",
  snowman: "snowman",
  campfire: "campfire",
  portal: null,
};

// ---------------------------------------------------------------------------
// One continuous world: the outdoor zones sit side by side on row 0 and are
// bridged where their floors meet, so walking off the right edge of the beach
// lands on the fishing pier. The rooftop sits on its own row (reached by the
// yard's stair gate and its own stairwell), since a roof has no outdoor edge.
// ---------------------------------------------------------------------------

export interface WorldZone {
  id: SceneArtId;
  /** Top-left corner of this zone's 1600x900 art in world units. */
  origin: Vec;
}

/** Left to right: beach, fishing, yard (start), camp, mountain, snow forest; rooftop below the yard. */
export const WORLD_ZONES: readonly WorldZone[] = [
  { id: "beach", origin: { x: 0, y: 0 } },
  { id: "fishing", origin: { x: WORLD_WIDTH, y: 0 } },
  { id: "yard", origin: { x: WORLD_WIDTH * 2, y: 0 } },
  { id: "camp", origin: { x: WORLD_WIDTH * 3, y: 0 } },
  { id: "mountain", origin: { x: WORLD_WIDTH * 4, y: 0 } },
  { id: "snow-forest", origin: { x: WORLD_WIDTH * 5, y: 0 } },
  { id: "rooftop", origin: { x: WORLD_WIDTH * 2, y: WORLD_HEIGHT } },
];

/** Total world size in logical units. */
export const WORLD_SIZE: Readonly<Vec> = {
  x: Math.max(...WORLD_ZONES.map((z) => z.origin.x)) + WORLD_WIDTH,
  y: Math.max(...WORLD_ZONES.map((z) => z.origin.y)) + WORLD_HEIGHT,
};

/** How far a floor may stop short of the zone edge and still be bridged to the neighbour. */
const BRIDGE_REACH = 200;
/** Each bridge pokes this far into both zones so the seam is never a gap. */
const BRIDGE_OVERLAP = 40;
/** Floors must share at least this much height to be bridged. */
const BRIDGE_MIN_HEIGHT = 80;

const offsetRect = (r: Rect, o: Vec): Rect => rect(r.x + o.x, r.y + o.y, r.w, r.h);

/** Zone-local prop id -> world id ("yard:bench"). */
export const worldPropId = (zoneId: SceneArtId, propId: string): string => `${zoneId}:${propId}`;

/** Floor strips joining the right edge of `left` to the left edge of `right` where their floors line up. */
function bridges(left: WorldZone, right: WorldZone): Rect[] {
  const out: Rect[] = [];
  for (const a of HEALING_WORLD[left.id].walkable) {
    if (a.x + a.w < WORLD_WIDTH - BRIDGE_REACH) continue;
    for (const b of HEALING_WORLD[right.id].walkable) {
      if (b.x > BRIDGE_REACH) continue;
      const top = Math.max(a.y, b.y);
      const bottom = Math.min(a.y + a.h, b.y + b.h);
      if (bottom - top < BRIDGE_MIN_HEIGHT) continue;
      const x0 = left.origin.x + a.x + a.w - BRIDGE_OVERLAP;
      const x1 = right.origin.x + b.x + BRIDGE_OVERLAP;
      out.push(rect(x0, left.origin.y + top, x1 - x0, bottom - top));
    }
  }
  return out;
}

/** Zone whose 1600x900 frame contains the point (bridges belong to both; the left one wins). */
export function zoneAt(p: Vec): WorldZone {
  const hit = WORLD_ZONES.find((z) => p.x >= z.origin.x && p.x < z.origin.x + WORLD_WIDTH && p.y >= z.origin.y && p.y < z.origin.y + WORLD_HEIGHT);
  return hit ?? WORLD_ZONES[0];
}

/** Where the character appears after entering a zone, in world units. */
export function zoneSpawn(zoneId: SceneArtId): Vec {
  const zone = WORLD_ZONES.find((z) => z.id === zoneId) ?? WORLD_ZONES[0];
  const spawn = HEALING_WORLD[zone.id].spawn;
  return { x: zone.origin.x + spawn.x, y: zone.origin.y + spawn.y };
}

function buildWorld(): WorldMap {
  const walkable: Rect[] = [];
  const props: HealingProp[] = [];
  for (const zone of WORLD_ZONES) {
    const scene = HEALING_WORLD[zone.id];
    walkable.push(...scene.walkable.map((r) => offsetRect(r, zone.origin)));
    props.push(...scene.props.map((p) => ({ ...p, ...offsetRect(p, zone.origin), id: worldPropId(zone.id, p.id) })));
  }
  for (const left of WORLD_ZONES) {
    const right = WORLD_ZONES.find((z) => z.origin.y === left.origin.y && z.origin.x === left.origin.x + WORLD_WIDTH);
    if (right) walkable.push(...bridges(left, right));
  }
  return { spawn: zoneSpawn("yard"), walkable, props };
}

/** The whole walkable world in one coordinate space; feed it to the movement helpers. */
export const WORLD: WorldMap = buildWorld();

/** Point inside the rect, edges inclusive. */
export function inRect(r: Rect, p: Vec): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

/** The foot point may stand here (inside any floor rect). */
export function isWalkable(scene: WorldMap, p: Vec): boolean {
  return scene.walkable.some((r) => inRect(r, p));
}

/**
 * Move by (dx, dy) trying each axis on its own, so a blocked axis does not
 * stop the other one (slides along walls). Always returns a new object.
 */
function slide(scene: WorldMap, pos: Vec, dx: number, dy: number): Vec {
  const x = dx !== 0 && isWalkable(scene, { x: pos.x + dx, y: pos.y }) ? pos.x + dx : pos.x;
  const y = dy !== 0 && isWalkable(scene, { x, y: pos.y + dy }) ? pos.y + dy : pos.y;
  return { x, y };
}

/**
 * Keyboard step: `dir` is -1/0/1 per axis, `dt` in seconds. Diagonals are
 * normalized so the speed stays WALK_SPEED. Walls are never crossed.
 */
export function stepCharacter(scene: WorldMap, pos: Vec, dir: { x: -1 | 0 | 1; y: -1 | 0 | 1 }, dt: number): Vec {
  if (dt <= 0 || (dir.x === 0 && dir.y === 0)) return { x: pos.x, y: pos.y };
  const scale = dir.x !== 0 && dir.y !== 0 ? Math.SQRT1_2 : 1;
  const step = WALK_SPEED * dt * scale;
  return slide(scene, pos, dir.x * step, dir.y * step);
}

/**
 * Tap-to-move: walk toward `target` at WALK_SPEED, snapping onto it within the
 * last step. Uses the same axis-slide rule, so an unreachable target just
 * leaves the character at the closest floor it could reach.
 */
export function walkToward(scene: WorldMap, pos: Vec, target: Vec, dt: number): Vec {
  const dx = target.x - pos.x;
  const dy = target.y - pos.y;
  const dist = Math.hypot(dx, dy);
  if (dt <= 0 || dist === 0) return { x: pos.x, y: pos.y };
  const step = WALK_SPEED * dt;
  if (dist <= step) return slide(scene, pos, dx, dy);
  return slide(scene, pos, (dx / dist) * step, (dy / dist) * step);
}

/** First prop whose rect contains the foot point, or null. */
export function propAt(scene: WorldMap, pos: Vec): HealingProp | null {
  return scene.props.find((p) => inRect(p, pos)) ?? null;
}

/** Portal under the foot point, or null. */
export function portalAt(scene: WorldMap, pos: Vec): HealingProp | null {
  return scene.props.find((p) => p.kind === "portal" && inRect(p, pos)) ?? null;
}

/** Activity a prop starts when reached; portals start none (they switch scenes). */
export function activityForProp(kind: HealingPropKind): WorldActivityId | null {
  return PROP_ACTIVITY[kind];
}

/**
 * How many hike checkpoints were reached in trail order (0..3, 3 = summit).
 * A checkpoint visited before its predecessor is not counted.
 */
export function hikeProgress(scene: WorldMap, visited: readonly string[]): number {
  const trail = scene.props.filter((p) => p.kind === "hike").map((p) => p.id);
  let reached = 0;
  for (const id of visited) {
    if (reached < trail.length && id === trail[reached]) reached += 1;
  }
  return reached;
}

/** Distinct activities the zone's props offer (prop order), then "walk". */
export function activitiesInScene(sceneId: SceneArtId): WorldActivityId[] {
  const fromProps = HEALING_WORLD[sceneId].props
    .map((p) => activityForProp(p.kind))
    .filter((a): a is WorldActivityId => a !== null);
  return [...new Set(fromProps), "walk"];
}
