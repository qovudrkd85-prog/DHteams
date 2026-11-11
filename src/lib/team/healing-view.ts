// Healing trail view math: pseudo-3D projection, path bends, roadside props, colours.
// Pure functions. Tests load this in a bare vm sandbox: type-only imports only.

import type { WeatherEffect } from "./healing";
import type { BiomeId } from "./healing-trail";

/** Horizon line as a share of the canvas height. */
export const HORIZON = 0.42;
/** Character feet as a share of the canvas height. */
export const FEET = 0.78;
/** Metres from the camera to the character. */
export const CHARACTER_Z = 4;
export const CAMERA_HEIGHT = 1.5;
export const NEAR = 0.5;
/** Path half width (m) as drawn. */
export const ROAD_HALF = 1.3;
export const DRAW_DISTANCE = 120;
/** Bends repeat once per loop so the walk wraps seamlessly (= TRAIL_LENGTH). */
export const CURVE_PERIOD = 1050;
export const CHUNK = 8;
export const MAX_PROPS_PER_CHUNK = 5;
const LOOK_SPAN = Math.tan((25 * Math.PI) / 180);

export interface Viewport { width: number; height: number }
/** x = sideways camera offset (m); look = -1..1 glance left/right. */
export interface Camera { x: number; look: number }
export interface Projected { x: number; y: number; scale: number }

export function focalLength(viewport: Viewport): number {
  return ((FEET - HORIZON) * viewport.height * CHARACTER_Z) / CAMERA_HEIGHT;
}

/** Ground point (worldX m sideways, z m ahead of the camera) to canvas pixels; null behind the near plane. */
export function project(worldX: number, z: number, cam: Camera, viewport: Viewport): Projected | null {
  if (!(z > NEAR)) return null;
  const f = focalLength(viewport);
  const scale = f / z;
  return {
    x: viewport.width / 2 + (worldX - cam.x) * scale - cam.look * LOOK_SPAN * f,
    y: viewport.height * HORIZON + CAMERA_HEIGHT * scale,
    scale,
  };
}

const TAU = Math.PI * 2;
const C1 = { amp: 0.006, period: 150, phase: 0.6 };
const C2 = { amp: 0.0026, period: 350, phase: 1.3 };

/** Path curvature (1/m) at a loop distance. Periodic over CURVE_PERIOD. */
export function curveAt(distance: number): number {
  return C1.amp * Math.sin((TAU * distance) / C1.period + C1.phase) + C2.amp * Math.sin((TAU * distance) / C2.period + C2.phase);
}

/** Integral of curveAt: which way the path is heading (rad), drives the far parallax. */
export function headingAt(distance: number): number {
  return -(C1.amp * C1.period / TAU) * Math.cos((TAU * distance) / C1.period + C1.phase)
    - (C2.amp * C2.period / TAU) * Math.cos((TAU * distance) / C2.period + C2.phase);
}

export interface RoadStrip {
  /** Metres ahead of the camera. */
  z: number;
  /** Loop distance of this strip. */
  worldZ: number;
  /** Sideways offset of the path centre (m). */
  offset: number;
  x: number;
  y: number;
  scale: number;
  halfWidth: number;
}

/** Path cross-sections from near to far, bending with curveAt. `distance` is the camera's loop distance. */
export function roadStrips(distance: number, viewport: Viewport, cam: Camera, count = 40, drawDistance = DRAW_DISTANCE): RoadStrip[] {
  const strips: RoadStrip[] = [];
  const first = 0.8;
  let prevZ = 0;
  let slope = 0;
  let offset = 0;
  for (let i = 0; i < count; i += 1) {
    const z = first * Math.pow(drawDistance / first, i / (count - 1));
    const dz = z - prevZ;
    slope += curveAt(distance + z) * dz;
    offset += slope * dz;
    prevZ = z;
    const p = project(offset, z, cam, viewport);
    if (p) strips.push({ z, worldZ: distance + z, offset, x: p.x, y: p.y, scale: p.scale, halfWidth: ROAD_HALF * p.scale });
  }
  return strips;
}

/** Path centre offset (m) at z, read from strips (linear between neighbours). */
export function offsetAt(strips: readonly RoadStrip[], z: number): number {
  if (strips.length === 0) return 0;
  if (z <= strips[0].z) return strips[0].offset * (z / strips[0].z);
  for (let i = 1; i < strips.length; i += 1) {
    if (z <= strips[i].z) {
      const a = strips[i - 1];
      const b = strips[i];
      return a.offset + ((b.offset - a.offset) * (z - a.z)) / (b.z - a.z);
    }
  }
  return strips[strips.length - 1].offset;
}

export type PropKind = "tree" | "pine" | "bush" | "rock" | "reed" | "palm" | "grass" | "flower" | "lamp" | "tent" | "snowpine" | "stump" | "planter";

export interface TrailProp {
  kind: PropKind;
  /** Sideways from the path centre (m). */
  x: number;
  /** Metres into the chunk. */
  dz: number;
  size: number;
  variant: number;
}

/** Which side has open water (-1 left, 1 right, 0 none). */
export const WATER_SIDE: Record<BiomeId, -1 | 0 | 1> = { beach: -1, fishing: -1, yard: 0, camp: 0, mountain: 0, "snow-forest": 0, rooftop: 0 };
/** Dry bank between the path edge and the water (m). */
export const SHORE = 2.2;

const PROP_TABLE: Record<BiomeId, readonly PropKind[]> = {
  beach: ["palm", "grass", "rock", "palm", "grass"],
  fishing: ["tree", "bush", "tree", "rock", "flower", "reed"],
  yard: ["tree", "bush", "flower", "lamp", "bush"],
  camp: ["pine", "pine", "tent", "rock", "stump"],
  mountain: ["pine", "rock", "grass", "pine", "rock"],
  "snow-forest": ["snowpine", "snowpine", "rock", "stump"],
  rooftop: ["planter", "flower", "lamp", "planter", "bush"],
};

function hashText(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Small deterministic PRNG (mulberry32). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Roadside props of one CHUNK-metre slice. Deterministic, never on the path. */
export function scatter(chunk: number, biome: BiomeId): TrailProp[] {
  const rand = seededRandom(Math.imul(chunk | 0, 2654435761) ^ hashText(biome));
  const table = PROP_TABLE[biome];
  const water = WATER_SIDE[biome];
  const count = 2 + Math.floor(rand() * (MAX_PROPS_PER_CHUNK - 1));
  const props: TrailProp[] = [];
  for (let i = 0; i < count; i += 1) {
    const side = rand() < 0.5 ? -1 : 1;
    const dz = rand() * CHUNK;
    const size = 0.8 + rand() * 0.5;
    const variant = Math.floor(rand() * 3);
    const spread = rand();
    if (side === water) {
      // Water side: only reeds on the bank (fishing) or nothing (beach sea).
      if (biome === "fishing") props.push({ kind: "reed", x: side * (ROAD_HALF + 0.4 + spread * (SHORE - 0.5)), dz, size, variant });
      continue;
    }
    const kind = table[Math.floor(rand() * table.length)];
    const reach = kind === "reed" || kind === "flower" || kind === "grass" || kind === "lamp" ? 2.5 : 11;
    props.push({ kind, x: side * (ROAD_HALF + 0.6 + spread * reach), dz, size, variant });
  }
  return props;
}

/** Which biome a chunk draws its props from inside a seam blend (deterministic). */
export function chunkBiome(chunk: number, id: BiomeId, next: BiomeId, blend: number): BiomeId {
  return seededRandom(chunk * 7919 + 17)() < blend ? next : id;
}

export interface Palette {
  skyTop: string; skyBottom: string; sun: string;
  far: string; near: string;
  ground: string; groundAlt: string; road: string; roadAlt: string; edge: string;
  water: string; waterFar: string; ripple: string;
  foliage: string; foliageDark: string; trunk: string; rock: string;
  wood: string; woodDark: string; accent: string; fog: string;
  /** 0..1 haze toward the horizon. */
  fogAmount: number;
}

type Colors = Omit<Palette, "fogAmount">;

// Fishing colours come from scenes/fishing.tsx tone(); the rest are first passes.
const DAY: Record<BiomeId, Colors> = {
  fishing: { skyTop: "#9fd0e6", skyBottom: "#dff1f6", sun: "#f7e4ae", far: "#a9c4cc", near: "#9dc0b4", ground: "#adc99c", groundAlt: "#a3c192", road: "#e4dcc1", roadAlt: "#d6ccad", edge: "#bfb08b", water: "#7fb3c4", waterFar: "#9fcbd6", ripple: "#c4e2e8", foliage: "#7aa86f", foliageDark: "#527f55", trunk: "#6e5340", rock: "#a2aaa2", wood: "#b48a62", woodDark: "#8a6647", accent: "#c96a5a", fog: "#e3eef0" },
  beach: { skyTop: "#8fcbe8", skyBottom: "#e2f3f8", sun: "#f9e6a8", far: "#9cc2cf", near: "#b9d4c4", ground: "#efe2bd", groundAlt: "#e8d9b0", road: "#d9c69a", roadAlt: "#cfbb8d", edge: "#c2ad7e", water: "#5fb2cc", waterFar: "#8fd0de", ripple: "#d6f0f4", foliage: "#6fae73", foliageDark: "#4b8a55", trunk: "#8a6a4a", rock: "#b0a99a", wood: "#c49a6c", woodDark: "#93704e", accent: "#e07b5f", fog: "#eef6f6" },
  yard: { skyTop: "#a8d8ea", skyBottom: "#e4f2ef", sun: "#f7e4ae", far: "#a8c3bf", near: "#94bb98", ground: "#9fca8c", groundAlt: "#95c083", road: "#d8cdb2", roadAlt: "#cdc1a4", edge: "#b3a585", foliage: "#6ea566", foliageDark: "#4d8250", trunk: "#6e5340", rock: "#a5ab9f", water: "#7fb3c4", waterFar: "#9fcbd6", ripple: "#c4e2e8", wood: "#b48a62", woodDark: "#8a6647", accent: "#d9785f", fog: "#e7f0ec" },
  camp: { skyTop: "#9ccbe0", skyBottom: "#e3eedf", sun: "#f7e0a2", far: "#97b3b0", near: "#7fa585", ground: "#8fb27a", groundAlt: "#86a972", road: "#c9b48e", roadAlt: "#bea983", edge: "#a49172", foliage: "#4f8558", foliageDark: "#36664a", trunk: "#5e4636", rock: "#9b9e94", water: "#6fa3b4", waterFar: "#8fbccb", ripple: "#b5d6de", wood: "#a07650", woodDark: "#76563c", accent: "#e0874f", fog: "#e2ebe2" },
  mountain: { skyTop: "#86bde0", skyBottom: "#dcedf4", sun: "#f7e4ae", far: "#8fa9bd", near: "#7f9f8a", ground: "#98ad7f", groundAlt: "#8ea476", road: "#c2b394", roadAlt: "#b7a888", edge: "#9d8f73", foliage: "#557f5a", foliageDark: "#3b6146", trunk: "#5e4636", rock: "#9a9a92", water: "#6fa3b4", waterFar: "#8fbccb", ripple: "#b5d6de", wood: "#a07650", woodDark: "#76563c", accent: "#d05a4a", fog: "#e4edf2" },
  "snow-forest": { skyTop: "#b6cfdf", skyBottom: "#eef3f6", sun: "#f3ecd4", far: "#b7c6d2", near: "#cfdbe3", ground: "#eef3f6", groundAlt: "#e4ebf0", road: "#d7dee3", roadAlt: "#ccd4da", edge: "#b8c2c9", foliage: "#4f7a68", foliageDark: "#3a5f52", trunk: "#5e4a3e", rock: "#a8b0b8", water: "#8db3c4", waterFar: "#aac8d4", ripple: "#d0e2ea", wood: "#9c7a5c", woodDark: "#735a44", accent: "#c95a5a", fog: "#eef3f6" },
  rooftop: { skyTop: "#9ccfe8", skyBottom: "#e3f0f4", sun: "#f7e4ae", far: "#a6b6c2", near: "#b9c3c8", ground: "#c9cbc4", groundAlt: "#c0c2bb", road: "#b9a58a", roadAlt: "#ae9a80", edge: "#8f8c84", foliage: "#6ea566", foliageDark: "#4d8250", trunk: "#6e5340", rock: "#a0a39e", water: "#7fb3c4", waterFar: "#9fcbd6", ripple: "#c4e2e8", wood: "#b48a62", woodDark: "#8a6647", accent: "#d9785f", fog: "#e6eef1" },
};

const FISHING_NIGHT: Colors = { skyTop: "#121a33", skyBottom: "#2c3d63", sun: "#f3f0dc", far: "#26354d", near: "#34485a", ground: "#2c423d", groundAlt: "#283d38", road: "#55554f", roadAlt: "#4d4d48", edge: "#403f39", water: "#26465a", waterFar: "#3b5f72", ripple: "#6f93a8", foliage: "#2c4a3c", foliageDark: "#1d362c", trunk: "#3a2e26", rock: "#47505c", wood: "#6a5240", woodDark: "#4e3c2f", accent: "#8a4a42", fog: "#1c2638" };

const NIGHT_INK = "#16203a";

function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Blend two #rrggbb colours; t = 0 gives a, 1 gives b. */
export function lerpColor(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return rgbToHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
}

function desaturate(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  const grey = Math.round(0.3 * r + 0.59 * g + 0.11 * b);
  return lerpColor(hex, rgbToHex(grey, grey, grey), amount);
}

const mapColors = (colors: Colors, fn: (key: keyof Colors, value: string) => string): Colors =>
  Object.fromEntries((Object.keys(colors) as (keyof Colors)[]).map((key) => [key, fn(key, colors[key])])) as Colors;

const FOG_AMOUNT: Record<WeatherEffect, number> = { clear: 0.12, cloudy: 0.25, rain: 0.35, snow: 0.3, fog: 0.78 };

/** Colours for one place at the given time and weather. */
export function palette(biome: BiomeId, isDay: boolean, effect: WeatherEffect): Palette {
  let colors: Colors = DAY[biome] ?? DAY.fishing;
  if (!isDay) {
    colors = biome === "fishing"
      ? FISHING_NIGHT
      : mapColors(colors, (key, value) => (key === "sun" ? "#f3f0dc" : lerpColor(value, NIGHT_INK, key === "skyTop" ? 0.85 : 0.66)));
  }
  if (effect === "cloudy" || effect === "rain" || effect === "fog") {
    const amount = effect === "cloudy" ? 0.35 : 0.5;
    colors = mapColors(colors, (key, value) => (key === "sun" ? value : desaturate(value, key.startsWith("sky") ? amount + 0.2 : amount)));
  }
  if (effect === "rain") colors = { ...colors, road: lerpColor(colors.road, "#4a5560", 0.35), roadAlt: lerpColor(colors.roadAlt, "#4a5560", 0.35) };
  if (effect === "snow") colors = { ...colors, ground: lerpColor(colors.ground, "#f1f5f7", 0.6), groundAlt: lerpColor(colors.groundAlt, "#e8eef2", 0.6), road: lerpColor(colors.road, "#e3e8ec", 0.45) };
  if (effect === "fog") colors = { ...colors, fog: isDay ? "#dfe5e6" : "#2a3342" };
  return { ...colors, fogAmount: FOG_AMOUNT[effect] };
}

/** Blend two palettes (colours and fog amount). */
export function mixPalette(a: Palette, b: Palette, t: number): Palette {
  if (t <= 0) return { ...a };
  if (t >= 1) return { ...b };
  const out = { ...a };
  for (const key of Object.keys(a) as (keyof Palette)[]) {
    if (key === "fogAmount") out.fogAmount = a.fogAmount + (b.fogAmount - a.fogAmount) * t;
    else out[key] = lerpColor(a[key], b[key], t);
  }
  return out;
}

export interface CharacterLook { skin: string; hair: string; glasses: boolean; hairStyle: number }

/** Same skin/hair/glasses as the office character (components/team/character.tsx seed rule). */
export function characterLook(avatar: string, name: string): CharacterLook {
  const seed = Array.from(avatar + name).reduce((sum, char) => sum + (char.codePointAt(0) ?? 0), 0);
  return {
    skin: ["#efc8a6", "#ddb18f", "#bc896b", "#f2d6bd"][seed % 4],
    hair: ["#4f4038", "#76604b", "#353d3b", "#916647"][Math.floor(seed / 3) % 4],
    glasses: seed % 4 === 1,
    hairStyle: seed % 2,
  };
}
