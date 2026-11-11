// Canvas painter for the healing trail: sky, far hills, bending path, roadside props, spots, haze.
// Block-pixel style like scenes/*.tsx. Fishing (lake + pier) is the polished stretch; other places use
// the same props recoloured by their palette for now.

import type { WeatherEffect } from "@/lib/team/healing";
import { biomeAt, loopGap, SPOT_OFFSET, TRAIL_SPOTS, wrapDistance, type BiomeId, type TrailSpot } from "@/lib/team/healing-trail";
import {
  CHARACTER_Z, CHUNK, DRAW_DISTANCE, HORIZON, NEAR, ROAD_HALF, SHORE, WATER_SIDE,
  chunkBiome, focalLength, headingAt, lerpColor, mixPalette, offsetAt, palette, project, roadStrips, scatter, seededRandom,
  type Camera, type Palette, type PropKind, type RoadStrip, type Viewport,
} from "@/lib/team/healing-view";

export interface TrailFrame {
  width: number;
  height: number;
  /** Character loop distance (m). */
  distance: number;
  /** Character metres from the path centre line. */
  lateral: number;
  isDay: boolean;
  effect: WeatherEffect;
  /** Seconds, drives ripples, twinkle and flames. */
  time: number;
  /** 1 walking, ~1.15 while sitting at a spot. */
  zoom?: number;
  /** Camera step bob in px. */
  bob?: number;
  /** Signpost to highlight (you are at its entrance). */
  entranceId?: string | null;
}

export interface CharacterAnchor { x: number; y: number; height: number }

const CHARACTER_SHARE = 0.3;
const PX_PER_M = 48;
const CACHE_LIMIT = 24;

type Canvas2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type SpriteKind = PropKind | "bench" | "sunbed" | "log" | "picnic" | "flag" | "lookout" | "snowman" | "rail" | "desk" | "telescope" | "campfire" | "bucket";
interface Sprite { canvas: HTMLCanvasElement | OffscreenCanvas; w: number; h: number }

/** Small LRU of pre-drawn sprites keyed by kind + variant + palette. */
export class SpriteCache {
  private readonly map = new Map<string, Sprite>();
  get size(): number { return this.map.size; }
  get(key: string, make: () => Sprite): Sprite {
    const hit = this.map.get(key);
    if (hit) { this.map.delete(key); this.map.set(key, hit); return hit; }
    const sprite = make();
    this.map.set(key, sprite);
    while (this.map.size > CACHE_LIMIT) this.map.delete(this.map.keys().next().value as string);
    return sprite;
  }
}

const defaultCache = new SpriteCache();

function makeCanvas(w: number, h: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  return canvas;
}

function camera(frame: TrailFrame): { camDistance: number; cam: Camera; strips: RoadStrip[]; vp: Viewport } {
  const vp = { width: frame.width, height: frame.height };
  const camDistance = frame.distance - CHARACTER_Z;
  const base = roadStrips(camDistance, vp, { x: 0, look: 0 });
  const cam = { x: offsetAt(base, CHARACTER_Z) + frame.lateral * 0.55, look: 0 };
  return { camDistance, cam, strips: roadStrips(camDistance, vp, cam), vp };
}

/** Where the character's feet go on the canvas (before zoom, which drawTrail applies around this point). */
export function characterAnchor(frame: TrailFrame): CharacterAnchor {
  const { cam, strips, vp } = camera(frame);
  const p = project(offsetAt(strips, CHARACTER_Z) + frame.lateral, CHARACTER_Z, cam, vp);
  return { x: p?.x ?? frame.width / 2, y: (p?.y ?? frame.height * 0.78) + (frame.bob ?? 0), height: frame.height * CHARACTER_SHARE };
}

const basePalettes = new Map<string, Palette>();
function paletteFor(biome: BiomeId, isDay: boolean, effect: WeatherEffect): Palette {
  const key = `${biome}|${isDay}|${effect}`;
  let pal = basePalettes.get(key);
  if (!pal) { pal = palette(biome, isDay, effect); basePalettes.set(key, pal); }
  return pal;
}

function paletteAt(distance: number, isDay: boolean, effect: WeatherEffect): Palette {
  const info = biomeAt(distance);
  const own = paletteFor(info.id, isDay, effect);
  return info.blend > 0 ? mixPalette(own, paletteFor(info.next, isDay, effect), info.blend) : own;
}

const haze = (color: string, pal: Palette, z: number, range: number) => lerpColor(color, pal.fog, Math.min(1, pal.fogAmount * Math.min(1, z / range) * 1.1));

function quad(ctx: Canvas2D, pts: readonly number[], color: string) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  ctx.closePath();
  ctx.fill();
}

/** Draws one full frame. Character is a separate SVG overlay placed at characterAnchor(). */
export function drawTrail(ctx: Canvas2D, frame: TrailFrame, cache: SpriteCache = defaultCache): void {
  const { camDistance, cam, strips, vp } = camera(frame);
  const anchor = characterAnchor(frame);
  const here = paletteAt(frame.distance, frame.isDay, frame.effect);
  const horizonY = vp.height * HORIZON;
  const range = frame.effect === "fog" ? 40 : DRAW_DISTANCE;
  const zoom = frame.zoom ?? 1;
  ctx.save();
  ctx.clearRect(0, 0, vp.width, vp.height);
  ctx.translate(anchor.x, anchor.y - anchor.height * 0.5);
  ctx.scale(zoom, zoom);
  ctx.translate(-anchor.x, -(anchor.y - anchor.height * 0.5) + (frame.bob ?? 0));
  const farPal = paletteAt(camDistance + 60, frame.isDay, frame.effect);
  drawSky(ctx, vp, farPal, frame, headingAt(camDistance));
  drawFar(ctx, vp, farPal, frame, headingAt(camDistance), biomeAt(camDistance + 60).id);
  drawGround(ctx, vp, strips, frame, range);
  const items = collectItems(ctx, frame, camDistance, cam, strips, vp, range, cache);
  items.sort((a, b) => b.z - a.z);
  for (const item of items) item.draw();
  // Weather veil: fog thickens toward the horizon; night gets a soft vignette.
  if (frame.effect === "fog" || frame.effect === "rain") {
    const g = ctx.createLinearGradient(0, horizonY - vp.height * 0.2, 0, vp.height);
    g.addColorStop(0, `${here.fog}${frame.effect === "fog" ? "d0" : "60"}`);
    g.addColorStop(0.35, `${here.fog}${frame.effect === "fog" ? "70" : "20"}`);
    g.addColorStop(1, `${here.fog}${frame.effect === "fog" ? "30" : "00"}`);
    ctx.fillStyle = g;
    ctx.fillRect(-vp.width, -vp.height, vp.width * 3, vp.height * 3);
  }
  ctx.restore();
  if (!frame.isDay) {
    const g = ctx.createRadialGradient(vp.width / 2, vp.height * 0.55, vp.height * 0.3, vp.width / 2, vp.height * 0.55, vp.width * 0.75);
    g.addColorStop(0, "#00000000");
    g.addColorStop(1, "#0a0f2080");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, vp.width, vp.height);
  }
}

function drawSky(ctx: Canvas2D, vp: Viewport, pal: Palette, frame: TrailFrame, heading: number) {
  const horizonY = vp.height * HORIZON;
  const f = focalLength(vp);
  const g = ctx.createLinearGradient(0, 0, 0, horizonY);
  g.addColorStop(0, pal.skyTop);
  g.addColorStop(1, pal.skyBottom);
  ctx.fillStyle = g;
  ctx.fillRect(-vp.width, -vp.height, vp.width * 3, horizonY + vp.height);
  const u = vp.height / 90;
  if (!frame.isDay) {
    const rand = seededRandom(42);
    for (let i = 0; i < 70; i += 1) {
      const x = rand() * vp.width * 1.6 - vp.width * 0.3 - heading * f * 0.3;
      const y = rand() * horizonY * 0.85;
      const tw = 0.55 + 0.45 * Math.sin(frame.time * (0.8 + rand() * 1.6) + i);
      ctx.fillStyle = `rgba(255,248,232,${(tw * (frame.effect === "clear" ? 0.95 : 0.35)).toFixed(2)})`;
      const s = rand() < 0.15 ? u * 0.9 : u * 0.5;
      ctx.fillRect(Math.round(x), Math.round(y), s, s);
    }
  }
  // Sun/moon sits at a fixed bearing; turning the path slides it.
  const sx = vp.width * 0.72 - heading * f * 0.9;
  const sy = horizonY * 0.3;
  const r = u * 4.5;
  if (frame.effect !== "fog") {
    const glow = ctx.createRadialGradient(sx, sy, r * 0.5, sx, sy, r * 5);
    glow.addColorStop(0, `${pal.sun}${frame.isDay ? "70" : "50"}`);
    glow.addColorStop(1, `${pal.sun}00`);
    ctx.fillStyle = glow;
    ctx.fillRect(sx - r * 5, sy - r * 5, r * 10, r * 10);
    ctx.fillStyle = pal.sun;
    ctx.fillRect(Math.round(sx - r), Math.round(sy - r), Math.round(r * 2), Math.round(r * 2));
    if (!frame.isDay) { ctx.fillStyle = pal.skyTop; ctx.fillRect(Math.round(sx - r * 0.2), Math.round(sy - r), Math.round(r * 1.2), Math.round(r * 1.1)); }
  }
  // Block clouds drifting slowly.
  const cloud = frame.isDay ? (frame.effect === "clear" ? "#ffffff" : lerpColor(pal.skyBottom, "#ffffff", 0.4)) : lerpColor(pal.skyTop, "#6a7aa0", 0.35);
  ctx.fillStyle = cloud;
  ctx.globalAlpha = frame.effect === "fog" ? 0.3 : 0.9;
  const count = frame.effect === "clear" ? 4 : 7;
  for (let i = 0; i < count; i += 1) {
    const span = vp.width * 1.6;
    const x = ((i * 0.37 * span + frame.time * u * 0.6 - heading * f * 0.5) % span + span) % span - vp.width * 0.3;
    const y = horizonY * (0.12 + ((i * 0.29) % 0.55));
    const w = u * (14 + (i % 3) * 5);
    ctx.fillRect(Math.round(x), Math.round(y + u * 2.5), Math.round(w), Math.round(u * 2.5));
    ctx.fillRect(Math.round(x + w * 0.18), Math.round(y + u * 0.5), Math.round(w * 0.5), Math.round(u * 2.2));
    ctx.fillRect(Math.round(x + w * 0.5), Math.round(y - u * 1.1), Math.round(w * 0.33), Math.round(u * 1.7));
  }
  ctx.globalAlpha = 1;
}

/** Stepped ridge height (0..1) for a far layer, tiling every `period` px. */
function ridge(x: number, seed: number): number {
  return 0.5 + 0.28 * Math.sin(x * 0.011 + seed) + 0.16 * Math.sin(x * 0.027 + seed * 2.3) + 0.06 * Math.sin(x * 0.071 + seed * 0.7);
}

function drawFar(ctx: Canvas2D, vp: Viewport, pal: Palette, frame: TrailFrame, heading: number, biome: BiomeId) {
  const horizonY = vp.height * HORIZON;
  const f = focalLength(vp);
  const step = Math.max(4, Math.round(vp.width / 90));
  const layers = [
    { color: lerpColor(pal.far, pal.skyBottom, 0.25 + pal.fogAmount * 0.4), height: 0.17, parallax: 0.6, seed: 1.7 },
    { color: lerpColor(pal.near, pal.fog, pal.fogAmount * 0.6), height: 0.075, parallax: 1, seed: 4.1 },
  ];
  for (const layer of layers) {
    ctx.fillStyle = layer.color;
    const shift = heading * f * layer.parallax;
    for (let x = -step; x < vp.width + step; x += step) {
      const h = Math.round((ridge((x + shift) / (vp.height / 360), layer.seed) * layer.height * vp.height) / step) * step;
      ctx.fillRect(x, horizonY - h, step + 1, h + 1);
    }
  }
  if (biome === "fishing") {
    // Lighthouse on the far point across the lake.
    const u = vp.height / 240;
    const lx = Math.round(vp.width * 0.16 - heading * f);
    ctx.globalAlpha = 1 - pal.fogAmount * 0.85;
    const by = horizonY - vp.height * 0.03;
    ctx.fillStyle = frame.isDay ? "#fff8e8" : "#c9c4b4"; ctx.fillRect(lx, by - u * 14, u * 4, u * 14);
    ctx.fillStyle = "#c96a5a"; ctx.fillRect(lx, by - u * 9, u * 4, u * 2); ctx.fillRect(lx - u * 0.5, by - u * 16, u * 5, u * 2);
    ctx.fillStyle = frame.isDay ? "#5b6b78" : "#f7e4ae"; ctx.fillRect(lx + u, by - u * 18, u * 2, u * 2);
    if (!frame.isDay) {
      const g = ctx.createRadialGradient(lx + u * 2, by - u * 17, 0, lx + u * 2, by - u * 17, u * 14);
      g.addColorStop(0, "#f7e4ae90"); g.addColorStop(1, "#f7e4ae00");
      ctx.fillStyle = g; ctx.fillRect(lx - u * 14, by - u * 31, u * 30, u * 30);
    }
    ctx.globalAlpha = 1;
  }
}

function drawGround(ctx: Canvas2D, vp: Viewport, strips: readonly RoadStrip[], frame: TrailFrame, range: number) {
  const horizonY = vp.height * HORIZON;
  const last = strips[strips.length - 1];
  const farPal = paletteAt(last.worldZ, frame.isDay, frame.effect);
  const farWater = WATER_SIDE[biomeAt(last.worldZ).id];
  // Beyond the last strip: a hazy ground (or open water) band up to the horizon.
  ctx.fillStyle = haze(farPal.ground, farPal, range, range);
  ctx.fillRect(-vp.width, horizonY, vp.width * 3, last.y - horizonY + 1);
  if (farWater !== 0) {
    ctx.fillStyle = haze(farPal.waterFar, farPal, range * 0.8, range);
    const shoreX = last.x + farWater * (ROAD_HALF + SHORE) * last.scale;
    if (farWater < 0) ctx.fillRect(-vp.width, horizonY, vp.width + shoreX, last.y - horizonY + 1);
    else ctx.fillRect(shoreX, horizonY, vp.width * 2, last.y - horizonY + 1);
  }
  for (let i = strips.length - 1; i > 0; i -= 1) {
    const far = strips[i];
    const near = strips[i - 1];
    const info = biomeAt(far.worldZ);
    const pal = paletteAt(far.worldZ, frame.isDay, frame.effect);
    const z = far.z;
    const band = Math.floor(wrapDistance(far.worldZ) / 3) % 2 === 0;
    const y0 = far.y;
    const y1 = near.y + 1;
    ctx.fillStyle = haze(band ? pal.ground : pal.groundAlt, pal, z, range);
    ctx.fillRect(-vp.width, y0, vp.width * 3, y1 - y0);
    const water = WATER_SIDE[info.id];
    if (water !== 0) {
      const sf = far.x + water * (ROAD_HALF + SHORE) * far.scale;
      const sn = near.x + water * (ROAD_HALF + SHORE) * near.scale;
      const edgeX = water < 0 ? -vp.width : vp.width * 2;
      const deep = haze(lerpColor(pal.water, pal.waterFar, Math.min(1, z / 60)), pal, z, range);
      quad(ctx, [edgeX, y0, sf, y0, sn, y1, edgeX, y1], deep);
      // Wet bank lip.
      const lip = 0.18;
      quad(ctx, [sf, y0, sf - water * lip * far.scale, y0, sn - water * lip * near.scale, y1, sn, y1], haze(lerpColor(pal.groundAlt, pal.trunk, 0.35), pal, z, range));
      drawRipples(ctx, frame, far, near, water, pal, z, range);
    }
    const stripe = Math.floor(wrapDistance(far.worldZ) / 1.6) % 2 === 0;
    quad(ctx, [far.x - far.halfWidth, y0, far.x + far.halfWidth, y0, near.x + near.halfWidth, y1, near.x - near.halfWidth, y1], haze(stripe ? pal.road : pal.roadAlt, pal, z, range));
    const e = 0.14;
    const edge = haze(pal.edge, pal, z, range);
    quad(ctx, [far.x - far.halfWidth, y0, far.x - far.halfWidth + e * far.scale, y0, near.x - near.halfWidth + e * near.scale, y1, near.x - near.halfWidth, y1], edge);
    quad(ctx, [far.x + far.halfWidth - e * far.scale, y0, far.x + far.halfWidth, y0, near.x + near.halfWidth, y1, near.x + near.halfWidth - e * near.scale, y1], edge);
    // Pebbles on the path, fixed to the world so walking reads as moving.
    if (z < 25) {
      const rand = seededRandom(Math.floor(far.worldZ * 4));
      if (rand() < 0.55) {
        const px = far.x + (rand() * 2 - 1) * far.halfWidth * 0.8;
        const s = Math.max(1, far.scale * 0.07);
        ctx.fillStyle = haze(pal.edge, pal, z, range);
        ctx.fillRect(Math.round(px), Math.round(y0 + (y1 - y0) * 0.4), Math.round(s * 1.6), Math.round(s));
      }
    }
  }
}

function drawRipples(ctx: Canvas2D, frame: TrailFrame, far: RoadStrip, near: RoadStrip, side: number, pal: Palette, z: number, range: number) {
  const rand = seededRandom(Math.floor(far.worldZ * 2) + 991);
  const y = (far.y + near.y) / 2;
  const count = z < 10 ? 3 : 2;
  for (let i = 0; i < count; i += 1) {
    const lateral = side * (ROAD_HALF + SHORE + 0.6 + rand() * 26);
    const x = far.x + lateral * far.scale;
    const phase = Math.sin(frame.time * 1.6 + rand() * 6.28);
    if (phase < 0.1) continue;
    ctx.globalAlpha = phase * 0.8;
    ctx.fillStyle = haze(pal.ripple, pal, z, range);
    ctx.fillRect(Math.round(x), Math.round(y), Math.max(2, Math.round(far.scale * 0.6)), Math.max(1, Math.round(far.scale * 0.07)));
  }
  ctx.globalAlpha = 1;
}

interface Item { z: number; draw: () => void }

function collectItems(ctx: Canvas2D, frame: TrailFrame, camDistance: number, cam: Camera, strips: readonly RoadStrip[], vp: Viewport, range: number, cache: SpriteCache): Item[] {
  const items: Item[] = [];
  const maxZ = Math.min(DRAW_DISTANCE, range * 1.3);
  const first = Math.floor((camDistance + NEAR) / CHUNK);
  const lastChunk = Math.floor((camDistance + maxZ) / CHUNK);
  for (let chunk = first; chunk <= lastChunk; chunk += 1) {
    const info = biomeAt(chunk * CHUNK + CHUNK / 2);
    const biome = chunkBiome(chunk, info.id, info.next, info.blend);
    const pal = paletteFor(biome, frame.isDay, frame.effect);
    for (const prop of scatter(chunk, biome)) {
      const z = chunk * CHUNK + prop.dz - camDistance;
      // Nothing nearer than the character: close-up props would fill the screen.
      if (z < CHARACTER_Z - 1 || z > maxZ) continue;
      const nearSpot = TRAIL_SPOTS.some((s) => Math.sign(prop.x) === s.side && Math.abs(loopGap(chunk * CHUNK + prop.dz, s.at)) < 3.2 && Math.abs(prop.x) < SPOT_OFFSET + 3);
      if (nearSpot) continue;
      const x = offsetAt(strips, z) + prop.x;
      items.push({ z, draw: () => drawSprite(ctx, cache, prop.kind, prop.variant, biome, pal, frame, x, z, prop.size, cam, vp, range) });
    }
  }
  for (const spot of TRAIL_SPOTS) {
    if (spot.night && frame.isDay) continue;
    const z = loopGap(camDistance, spot.at);
    if (z < NEAR + 0.3 || z > maxZ) continue;
    const pal = paletteFor(spot.biome, frame.isDay, frame.effect);
    const road = offsetAt(strips, z);
    items.push(...spotItems(ctx, frame, spot, z, road, pal, cam, vp, range, cache));
  }
  return items;
}

function drawSprite(ctx: Canvas2D, cache: SpriteCache, kind: SpriteKind, variant: number, biome: BiomeId, pal: Palette, frame: TrailFrame, x: number, z: number, size: number, cam: Camera, vp: Viewport, range: number) {
  const p = project(x, z, cam, vp);
  if (!p) return;
  const sprite = cache.get(`${kind}|${variant}|${biome}|${frame.isDay}|${frame.effect}`, () => renderSprite(kind, variant, pal));
  const w = sprite.w * p.scale * size;
  const h = sprite.h * p.scale * size;
  if (h < 1.5) return;
  ctx.globalAlpha = 1 - Math.min(0.92, pal.fogAmount * Math.min(1, z / range) * 1.1);
  ctx.drawImage(sprite.canvas, p.x - w / 2, p.y - h, w, h);
  ctx.globalAlpha = 1;
  if (!frame.isDay && kind === "lamp") glow(ctx, p.x, p.y - h * 0.92, p.scale * 1.6, "#f7d98a");
}

function glow(ctx: Canvas2D, x: number, y: number, r: number, color: string) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `${color}a0`);
  g.addColorStop(1, `${color}00`);
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

function spotItems(ctx: Canvas2D, frame: TrailFrame, spot: TrailSpot, z: number, road: number, pal: Palette, cam: Camera, vp: Viewport, range: number, cache: SpriteCache): Item[] {
  const out: Item[] = [];
  // Just past the entrance: seen ahead while arriving, never between the camera and a seated character.
  const signZ = z + 1.6;
  if (signZ > NEAR + 0.3) out.push({ z: signZ, draw: () => drawSign(ctx, spot, road + spot.side * (ROAD_HALF + 0.35), signZ, pal, cam, vp, frame.entranceId === spot.id) });
  const sx = road + spot.side * SPOT_OFFSET;
  if (spot.kind === "pier") {
    out.push({ z: z + 1.2, draw: () => drawPier(ctx, spot, z, road, pal, cam, vp, range) });
    out.push({ z: z + 0.9, draw: () => drawSprite(ctx, cache, "bucket", 0, spot.biome, pal, frame, sx + spot.side * 0.9, z + 0.7, 1, cam, vp, range) });
    return out;
  }
  const kind: SpriteKind = spot.kind;
  // Sprites are drawn just behind where the character sits.
  out.push({ z: z + 0.6, draw: () => drawSprite(ctx, cache, kind, 0, spot.biome, pal, frame, sx, z + 0.6, 1, cam, vp, range) });
  if (spot.kind === "campfire") out.push({ z: z + 0.55, draw: () => drawFlame(ctx, sx, z + 0.6, frame, cam, vp) });
  return out;
}

function drawSign(ctx: Canvas2D, spot: TrailSpot, x: number, z: number, pal: Palette, cam: Camera, vp: Viewport, active: boolean) {
  const p = project(x, z, cam, vp);
  if (!p) return;
  const s = p.scale;
  if (s < 3) return;
  const postH = 1.25 * s;
  ctx.fillStyle = pal.woodDark;
  ctx.fillRect(Math.round(p.x - 0.05 * s), Math.round(p.y - postH), Math.max(1, Math.round(0.1 * s)), Math.round(postH));
  const font = Math.max(6, Math.round(0.2 * s));
  ctx.font = `600 ${font}px system-ui, sans-serif`;
  const textW = ctx.measureText(spot.label).width;
  const bw = Math.max(0.8 * s, textW + 0.24 * s);
  const bh = 0.36 * s;
  // Board leans toward its spot so it reads as "this way".
  const bx = p.x - bw / 2 + spot.side * 0.18 * s;
  const by = p.y - postH - bh * 0.4;
  if (active) glow(ctx, bx + bw / 2, by + bh / 2, bw * 0.9, "#fff1b8");
  ctx.fillStyle = pal.woodDark;
  ctx.fillRect(Math.round(bx - 0.03 * s), Math.round(by - 0.03 * s), Math.round(bw + 0.06 * s), Math.round(bh + 0.06 * s));
  ctx.fillStyle = active ? "#fff6dc" : lerpColor(pal.wood, "#fff8e8", 0.45);
  ctx.fillRect(Math.round(bx), Math.round(by), Math.round(bw), Math.round(bh));
  // Arrow tip on the spot side.
  const tipX = spot.side > 0 ? bx + bw : bx;
  quad(ctx, [tipX, by, tipX + spot.side * bh * 0.45, by + bh / 2, tipX, by + bh], active ? "#fff6dc" : lerpColor(pal.wood, "#fff8e8", 0.45));
  ctx.fillStyle = "#3d2f25";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(spot.label, bx + bw / 2, by + bh / 2 + 1);
}

function drawPier(ctx: Canvas2D, spot: TrailSpot, z: number, road: number, pal: Palette, cam: Camera, vp: Viewport, range: number) {
  const side = spot.side;
  const xIn = road + side * (ROAD_HALF - 0.1);
  const xOut = road + side * (SPOT_OFFSET + 1.5);
  const z0 = Math.max(NEAR + 0.15, z - 1.1);
  const z1 = z + 1.1;
  const a = project(xIn, z1, cam, vp); const b = project(xOut, z1, cam, vp);
  const c = project(xOut, z0, cam, vp); const d = project(xIn, z0, cam, vp);
  if (!a || !b || !c || !d) return;
  const deck = haze(pal.wood, pal, z, range);
  const seam = haze(pal.woodDark, pal, z, range);
  // Posts under the front edge, into the water.
  const postH = 0.55 * c.scale;
  ctx.fillStyle = haze(pal.trunk, pal, z, range);
  for (const t of [0.35, 0.68, 1]) {
    const px = d.x + (c.x - d.x) * t;
    ctx.fillRect(Math.round(px - 0.09 * c.scale), Math.round(c.y), Math.max(2, Math.round(0.18 * c.scale)), Math.round(postH));
  }
  // Front face (deck thickness), then the deck top.
  quad(ctx, [d.x, d.y, c.x, c.y, c.x, c.y + 0.16 * c.scale, d.x, d.y + 0.16 * d.scale], seam);
  quad(ctx, [a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y], deck);
  // Plank seams run along the pier.
  ctx.strokeStyle = seam;
  ctx.lineWidth = Math.max(1, c.scale * 0.03);
  for (let t = 0.2; t < 1; t += 0.2) {
    ctx.beginPath();
    ctx.moveTo(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
    ctx.lineTo(d.x + (c.x - d.x) * t, d.y + (c.y - d.y) * t);
    ctx.stroke();
  }
  // End rail posts and rope.
  const railH = 0.7;
  for (const pt of [b, c]) {
    ctx.fillStyle = seam;
    ctx.fillRect(Math.round(pt.x - 0.06 * pt.scale), Math.round(pt.y - railH * pt.scale), Math.max(2, Math.round(0.12 * pt.scale)), Math.round(railH * pt.scale));
  }
  ctx.strokeStyle = haze("#d8c7a0", pal, z, range);
  ctx.lineWidth = Math.max(1, c.scale * 0.025);
  ctx.beginPath();
  ctx.moveTo(b.x, b.y - railH * 0.85 * b.scale);
  ctx.quadraticCurveTo((b.x + c.x) / 2, (b.y + c.y) / 2 - railH * 0.45 * c.scale, c.x, c.y - railH * 0.85 * c.scale);
  ctx.stroke();
}

function drawFlame(ctx: Canvas2D, x: number, z: number, frame: TrailFrame, cam: Camera, vp: Viewport) {
  const p = project(x, z, cam, vp);
  if (!p) return;
  const s = p.scale;
  const flick = 0.85 + 0.15 * Math.sin(frame.time * 9) + 0.08 * Math.sin(frame.time * 23);
  if (!frame.isDay) glow(ctx, p.x, p.y - 0.3 * s, s * 2.4, "#ffa548");
  ctx.fillStyle = "#f08a3c"; ctx.fillRect(p.x - 0.18 * s, p.y - 0.62 * s * flick, 0.36 * s, 0.45 * s * flick);
  ctx.fillStyle = "#f7d36a"; ctx.fillRect(p.x - 0.09 * s, p.y - 0.48 * s * flick, 0.18 * s, 0.3 * s * flick);
}

// ---------------------------------------------------------------------------
// Sprites: drawn once in metres (y up, origin at bottom centre) into an offscreen canvas.
// ---------------------------------------------------------------------------
const SIZE: Record<SpriteKind, [number, number]> = {
  tree: [2.6, 3.8], pine: [2, 4.2], snowpine: [2, 4.2], bush: [1.5, 1], rock: [1.3, 0.8], reed: [0.9, 1.7], palm: [2.8, 4.4],
  grass: [0.8, 0.45], flower: [0.9, 0.55], lamp: [0.5, 2.7], tent: [2.6, 1.7], stump: [0.8, 0.55], planter: [1.3, 1.4],
  bench: [1.9, 1.05], sunbed: [2.4, 2.6], log: [1.9, 0.6], picnic: [2.2, 0.9], flag: [0.9, 2.1], lookout: [2.6, 2.7],
  snowman: [1, 1.6], rail: [2.6, 1.2], desk: [1.6, 1.15], telescope: [0.9, 1.5], campfire: [1.3, 0.5], bucket: [0.5, 0.45],
};

function renderSprite(kind: SpriteKind, variant: number, pal: Palette): Sprite {
  const [w, h] = SIZE[kind];
  const canvas = makeCanvas(Math.ceil(w * PX_PER_M), Math.ceil(h * PX_PER_M));
  const c = canvas.getContext("2d") as Canvas2D | null;
  if (c) paintSprite(c, kind, variant, pal, w, h);
  return { canvas, w, h };
}

function paintSprite(c: Canvas2D, kind: SpriteKind, variant: number, pal: Palette, w: number, h: number) {
  const r = (x: number, y: number, rw: number, rh: number, color: string) => {
    c.fillStyle = color;
    c.fillRect(Math.round((x + w / 2) * PX_PER_M), Math.round((h - y - rh) * PX_PER_M), Math.round(rw * PX_PER_M), Math.round(rh * PX_PER_M));
  };
  const light = (color: string) => lerpColor(color, "#ffffff", 0.22);
  const leaf = variant === 2 ? lerpColor(pal.foliage, "#c9b45a", 0.25) : pal.foliage;
  switch (kind) {
    case "tree":
      r(-0.15, 0, 0.3, 1.4, pal.trunk); r(-0.15, 0, 0.12, 1.4, lerpColor(pal.trunk, "#000000", 0.2));
      r(-1.2, 1.1, 2.4, 1.3, leaf); r(-0.9, 2.3, 1.8, 0.9, leaf); r(-0.5, 3.1, 1, 0.6, leaf);
      r(0.4, 1.1, 0.8, 1.3, pal.foliageDark); r(0.3, 2.3, 0.6, 0.9, pal.foliageDark); r(-1.2, 1.1, 2.4, 0.25, pal.foliageDark);
      r(-0.8, 2.5, 0.5, 0.3, light(leaf)); r(-0.3, 3.3, 0.35, 0.2, light(leaf)); r(-1, 1.8, 0.4, 0.25, light(leaf));
      break;
    case "pine":
    case "snowpine": {
      r(-0.13, 0, 0.26, 0.9, pal.trunk);
      const tiers = [[0.6, 1.9, 1], [1.5, 1.5, 0.85], [2.3, 1.1, 0.75], [3.1, 0.7, 0.7], [3.7, 0.3, 0.5]];
      for (const [y, half, th] of tiers) {
        r(-half, y, half * 2, th, leaf); r(half * 0.3, y, half * 0.7, th, pal.foliageDark);
        if (kind === "snowpine") r(-half, y + th - 0.18, half * 1.6, 0.18, "#f4f8fa");
      }
      break;
    }
    case "bush":
      r(-0.7, 0, 1.4, 0.6, leaf); r(-0.45, 0.55, 0.9, 0.4, leaf); r(0.2, 0, 0.5, 0.6, pal.foliageDark); r(-0.4, 0.7, 0.3, 0.15, light(leaf));
      break;
    case "rock":
      r(-0.6, 0, 1.2, 0.45, pal.rock); r(-0.4, 0.42, 0.75, 0.3, pal.rock); r(0.2, 0, 0.4, 0.45, lerpColor(pal.rock, "#000000", 0.18)); r(-0.3, 0.6, 0.3, 0.1, light(pal.rock));
      break;
    case "reed":
      for (const [x, ht] of [[-0.3, 1.2], [-0.1, 1.55], [0.12, 1.35], [0.3, 1.05]]) {
        r(x, 0, 0.05, ht, lerpColor(pal.foliage, "#8a8a4a", 0.35));
        if (ht > 1.2) r(x - 0.03, ht - 0.35, 0.11, 0.28, pal.trunk);
      }
      r(-0.42, 0, 0.84, 0.25, pal.foliageDark);
      break;
    case "palm":
      for (let i = 0; i < 7; i += 1) r(-0.12 + i * 0.07, i * 0.52, 0.26, 0.56, i % 2 ? pal.trunk : lerpColor(pal.trunk, "#ffffff", 0.15));
      r(-1.3, 3.6, 2.6, 0.3, leaf); r(-0.9, 3.85, 1.9, 0.3, leaf); r(-1.35, 3.2, 0.35, 0.4, leaf); r(1, 3.2, 0.35, 0.4, leaf); r(0.2, 3.6, 0.9, 0.3, pal.foliageDark);
      break;
    case "grass":
      r(-0.35, 0, 0.7, 0.2, leaf); r(-0.25, 0.15, 0.1, 0.25, leaf); r(0.05, 0.15, 0.1, 0.3, leaf); r(0.2, 0.15, 0.08, 0.2, pal.foliageDark);
      break;
    case "flower": {
      r(-0.4, 0, 0.8, 0.22, leaf);
      const petal = ["#f2c14e", "#e88aa0", "#ffffff"][variant] ?? "#f2c14e";
      r(-0.3, 0.25, 0.14, 0.14, petal); r(0.02, 0.32, 0.14, 0.14, petal); r(0.22, 0.22, 0.14, 0.14, petal);
      break;
    }
    case "lamp":
      r(-0.06, 0, 0.12, 2.3, "#3f4548"); r(-0.2, 2.3, 0.4, 0.3, "#3f4548"); r(-0.14, 2.32, 0.28, 0.22, "#f7d98a"); r(-0.16, 0, 0.32, 0.12, "#3f4548");
      break;
    case "tent":
      for (let i = 0; i < 6; i += 1) r(-1.2 + i * 0.2, i * 0.27, 2.4 - i * 0.4, 0.28, i % 2 ? pal.accent : lerpColor(pal.accent, "#ffffff", 0.15));
      r(-0.18, 0, 0.36, 0.7, lerpColor(pal.accent, "#000000", 0.4));
      break;
    case "stump":
      r(-0.35, 0, 0.7, 0.45, pal.trunk); r(-0.3, 0.42, 0.6, 0.1, lerpColor(pal.wood, "#ffffff", 0.2));
      break;
    case "planter":
      r(-0.6, 0, 1.2, 0.55, pal.woodDark); r(-0.6, 0.45, 1.2, 0.1, pal.wood);
      r(-0.5, 0.55, 1, 0.5, leaf); r(-0.3, 1, 0.6, 0.3, leaf); r(-0.3, 0.9, 0.15, 0.15, "#e88aa0"); r(0.15, 1.1, 0.15, 0.15, "#f2c14e");
      break;
    case "bench":
      r(-0.85, 0, 0.12, 0.45, pal.woodDark); r(0.73, 0, 0.12, 0.45, pal.woodDark);
      r(-0.95, 0.42, 1.9, 0.14, pal.wood); r(-0.95, 0.62, 1.9, 0.12, pal.wood); r(-0.95, 0.82, 1.9, 0.12, pal.wood); r(-0.85, 0.56, 0.1, 0.4, pal.woodDark); r(0.75, 0.56, 0.1, 0.4, pal.woodDark);
      break;
    case "sunbed":
      r(-1, 0, 0.1, 0.35, pal.woodDark); r(0.9, 0, 0.1, 0.35, pal.woodDark); r(-1, 0.3, 2, 0.15, "#f4f1e8"); r(0.5, 0.45, 0.5, 0.35, "#f4f1e8");
      r(-0.05, 0, 0.1, 2.3, pal.woodDark); r(-1.1, 2.2, 2.2, 0.25, pal.accent); r(-0.7, 2.45, 1.4, 0.15, pal.accent); r(-0.3, 2.2, 0.6, 0.25, "#ffffff");
      break;
    case "log":
      r(-0.9, 0, 1.8, 0.5, pal.trunk); r(-0.9, 0.38, 1.8, 0.12, lerpColor(pal.trunk, "#ffffff", 0.15)); r(0.75, 0.05, 0.15, 0.4, lerpColor(pal.wood, "#ffffff", 0.3));
      break;
    case "picnic":
      r(-1, 0, 2, 0.12, "#d65c5c"); r(-0.6, 0, 0.2, 0.12, "#ffffff"); r(0.2, 0, 0.2, 0.12, "#ffffff");
      r(0.2, 0.12, 0.6, 0.4, pal.wood); r(0.3, 0.52, 0.4, 0.1, pal.woodDark);
      break;
    case "flag":
      r(-0.04, 0, 0.08, 2, pal.woodDark); r(0.04, 1.4, 0.7, 0.45, pal.accent); r(-0.25, 0, 0.5, 0.25, pal.rock);
      break;
    case "lookout":
      r(-1.1, 0, 0.14, 1.6, pal.woodDark); r(0.96, 0, 0.14, 1.6, pal.woodDark); r(-1.25, 1.5, 2.5, 0.18, pal.wood);
      r(-1.25, 1.68, 0.1, 0.8, pal.woodDark); r(1.15, 1.68, 0.1, 0.8, pal.woodDark); r(-1.25, 2.38, 2.5, 0.1, pal.wood);
      break;
    case "snowman":
      r(-0.42, 0, 0.84, 0.75, "#f6f9fb"); r(-0.3, 0.72, 0.6, 0.55, "#f6f9fb"); r(-0.2, 1.25, 0.4, 0.12, pal.accent); r(-0.22, 1.37, 0.44, 0.18, "#2f3436");
      r(-0.1, 1.0, 0.06, 0.06, "#2f3436"); r(0.05, 1.0, 0.06, 0.06, "#2f3436"); r(0.12, 0.95, 0.15, 0.05, "#f08a3c");
      break;
    case "rail":
      r(-1.25, 0, 2.5, 0.35, pal.woodDark); r(-1.15, 0.35, 2.3, 0.4, pal.foliage); r(-1.25, 1, 2.5, 0.1, "#8f969a");
      for (let i = 0; i < 6; i += 1) r(-1.25 + i * 0.48, 0.35, 0.06, 0.7, "#8f969a");
      break;
    case "desk":
      r(-0.75, 0, 0.1, 0.75, pal.woodDark); r(0.65, 0, 0.1, 0.75, pal.woodDark); r(-0.8, 0.72, 1.6, 0.1, pal.wood);
      r(-0.3, 0.82, 0.6, 0.04, "#5a6068"); r(-0.28, 0.86, 0.56, 0.28, "#3d434a"); r(-0.24, 0.9, 0.48, 0.2, "#8fc1d8");
      break;
    case "telescope":
      r(-0.3, 0, 0.06, 0.9, "#4a4f55"); r(0.24, 0, 0.06, 0.9, "#4a4f55"); r(-0.04, 0, 0.08, 0.9, "#4a4f55");
      r(-0.35, 0.9, 0.7, 0.18, "#d9dde0"); r(0.25, 1.0, 0.18, 0.28, "#d9dde0");
      break;
    case "campfire":
      r(-0.55, 0, 1.1, 0.15, pal.rock); r(-0.45, 0.1, 0.9, 0.14, pal.trunk); r(-0.25, 0.2, 0.5, 0.12, lerpColor(pal.trunk, "#000000", 0.25));
      break;
    case "bucket":
      r(-0.2, 0, 0.4, 0.32, "#6f8796"); r(-0.22, 0.3, 0.44, 0.06, "#8fa6b4");
      break;
  }
}
