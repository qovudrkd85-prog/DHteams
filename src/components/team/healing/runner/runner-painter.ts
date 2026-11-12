// Canvas painter for the "방파제 달리기" runner, R3 stage: small pixel-style art.
// Pure drawing: reads the engine state, never changes it. No per-frame allocation of big objects.

import { RUNNER, runnerView, speedAt, type RunnerPlatform, type RunnerState, type RunnerZone } from "@/lib/team/runner";

export interface RunnerFrame {
  /** CSS pixels of the play field. */
  width: number;
  height: number;
  isDay: boolean;
  /** Runner body colour (my member colour). */
  color: string;
}

/** Ground line (y = 0) sits this far down the field; leaves ≥ 3 m below for the water at 9 m view height. */
const GROUND_SHARE = 0.65;
const BODY_W_M = 0.6;
const BODY_H_M = 1.7;
const HEAD_R_M = 0.22;
const COIN_DRAW_R_M = 0.3;
const EDGE_M = 0.15;
const WATER_SURFACE_M = RUNNER.WATER_Y * 0.5;
/** Far horizon sits this far above the near water surface (m, screen only). */
const HORIZON_ABOVE_M = 1.2;
/** Parallax factors: share of the camera movement each background layer follows. */
const FAR_PARALLAX = 0.12;
const NEAR_PARALLAX = 0.45;
const ISLAND_TILE_M = 40;
const WAVE_GAP_M = 2.4;
const SPLASH_G = 18;
/** Splash droplets: [vx, vy] in m/s. */
const SPLASH_DROPS: readonly (readonly [number, number])[] = [[-2.2, 5], [-1.1, 7], [-0.3, 8.5], [0.6, 7.5], [1.5, 6], [2.4, 4.5]];
/** Night stars as [x, y] shares of the far layer tile / sky height. */
const STARS: readonly (readonly [number, number])[] = [[0.05, 0.2], [0.18, 0.55], [0.31, 0.12], [0.47, 0.4], [0.6, 0.18], [0.72, 0.6], [0.86, 0.3], [0.94, 0.08]];

interface Palette {
  sky: string; skyHigh: string; land: string; seaFar: string; water: string; wave: string; foam: string; star: string;
}
const PALETTE: Readonly<Record<"day" | "night", Palette>> = {
  day: { sky: "#a9d8ea", skyHigh: "#8fcbe2", land: "#7fa3b3", seaFar: "#3f84a3", water: "#2f6f8f", wave: "#4c90ae", foam: "#d7eef5", star: "#ffffff" },
  night: { sky: "#1b2a4a", skyHigh: "#141f3a", land: "#26375a", seaFar: "#1c3d58", water: "#16324a", wave: "#25496a", foam: "#5f7e99", star: "#e6ecf5" },
};

interface ZoneArt { body: string; edge: string; line: string; extra: string }
const ZONE_ART: Readonly<Record<"day" | "night", Readonly<Record<RunnerZone, ZoneArt>>>> = {
  day: {
    breakwater: { body: "#8c96a0", edge: "#c4ccd3", line: "#717b85", extra: "#a3acb4" },
    pier: { body: "#8a6a4a", edge: "#b8946c", line: "#6b5038", extra: "#7d8790" },
    levee: { body: "#6f8f5a", edge: "#d6c39a", line: "#557245", extra: "#9aa0a6" },
  },
  night: {
    breakwater: { body: "#59616b", edge: "#7f8892", line: "#464d56", extra: "#6a737c" },
    pier: { body: "#5a4532", edge: "#7a6248", line: "#443426", extra: "#4f5760" },
    levee: { body: "#465c3a", edge: "#8c7f63", line: "#36472c", extra: "#5f656b" },
  },
};

/** One frame's view: screen mapping plus shared numbers. */
interface View {
  ctx: CanvasRenderingContext2D; width: number; height: number; k: number; left: number; baseY: number; waterTop: number;
}

const sx = (v: View, x: number): number => (x - v.left) * v.k;
const sy = (v: View, y: number): number => v.baseY - y * v.k;

/** Pixel-snapped rectangle. */
function rect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
}

/** Calls draw(screenX) for every repeat of a `gapPx` pattern that scrolls with `offsetPx`. */
function eachRepeat(width: number, gapPx: number, offsetPx: number, draw: (x: number) => void): void {
  if (gapPx < 4) return;
  const start = -(((offsetPx % gapPx) + gapPx) % gapPx);
  for (let x = start - gapPx; x < width + gapPx; x += gapPx) draw(x);
}

function paintFarLayer(v: View, p: Palette, isDay: boolean, cameraM: number): void {
  const { ctx, width, k } = v;
  const horizon = v.waterTop - HORIZON_ABOVE_M * k;
  ctx.fillStyle = p.sky;
  ctx.fillRect(0, 0, width, horizon);
  ctx.fillStyle = p.skyHigh;
  rect(ctx, 0, 0, width, horizon * 0.35);
  const tile = ISLAND_TILE_M * k;
  const offset = cameraM * k * FAR_PARALLAX;
  if (!isDay) {
    ctx.fillStyle = p.star;
    eachRepeat(width, tile, offset * 0.5, (x) => {
      for (const [fx, fy] of STARS) rect(ctx, x + fx * tile, fy * horizon * 0.8, 2, 2);
    });
  }
  ctx.fillStyle = p.land;
  eachRepeat(width, tile, offset, (x) => {
    rect(ctx, x + tile * 0.1, horizon - 0.5 * k, tile * 0.3, 0.5 * k);
    rect(ctx, x + tile * 0.16, horizon - 0.9 * k, tile * 0.14, 0.4 * k);
    rect(ctx, x + tile * 0.62, horizon - 0.3 * k, tile * 0.22, 0.3 * k);
  });
}

function paintSea(v: View, p: Palette, cameraM: number): void {
  const { ctx, width, height, k, waterTop } = v;
  const horizon = waterTop - HORIZON_ABOVE_M * k;
  ctx.fillStyle = p.seaFar;
  ctx.fillRect(0, horizon, width, waterTop - horizon);
  ctx.fillStyle = p.wave;
  const gap = WAVE_GAP_M * k;
  eachRepeat(width, gap, cameraM * k * NEAR_PARALLAX, (x) => {
    rect(ctx, x, horizon + (waterTop - horizon) * 0.4, gap * 0.3, 1);
    rect(ctx, x + gap * 0.5, horizon + (waterTop - horizon) * 0.75, gap * 0.25, 1);
  });
  ctx.fillStyle = p.water;
  ctx.fillRect(0, waterTop, width, height - waterTop);
  ctx.fillStyle = p.wave;
  eachRepeat(width, gap, cameraM * k, (x) => rect(ctx, x, waterTop + 0.5 * k, gap * 0.35, Math.max(1, 0.08 * k)));
  ctx.fillStyle = p.foam;
  rect(ctx, 0, waterTop, width, Math.max(1, k * 0.06));
}

/** Concrete blocks with seams, tetrapods at the waterline. */
function paintBreakwater(v: View, a: ZoneArt, pl: RunnerPlatform, x0: number, top: number, w: number): void {
  const { ctx, k, height, waterTop } = v;
  ctx.fillStyle = a.body;
  rect(ctx, x0, top, w, height - top);
  ctx.fillStyle = a.line;
  rect(ctx, x0, top + 0.8 * k, w, 1);
  const block = 1.5 * k;
  for (let bx = x0 + block; bx < x0 + w - 2; bx += block) rect(ctx, bx, top, 1, 0.8 * k);
  for (let bx = x0 + block * 0.5; bx < x0 + w - 2; bx += block) rect(ctx, bx, top + 0.8 * k, 1, waterTop - top - 0.8 * k);
  ctx.fillStyle = a.extra;
  const s = 0.35 * k;
  for (let i = 0; i * 1.3 < pl.length; i += 1) {
    const cx = x0 + (i * 1.3 + 0.5) * k;
    rect(ctx, cx - s, waterTop - s * 0.5, s * 2, s * 0.6);
    rect(ctx, cx - s * 0.3, waterTop - s * 1.2, s * 0.6, s * 1.4);
  }
  ctx.fillStyle = a.edge;
  rect(ctx, x0, top, w, Math.max(2, EDGE_M * k));
}

/** Deck slab on pillars; the water shows between the pillars. */
function paintPier(v: View, a: ZoneArt, x0: number, top: number, w: number): void {
  const { ctx, k, height } = v;
  const deck = 0.55 * k;
  const pillar = 0.4 * k;
  ctx.fillStyle = a.extra;
  const count = Math.max(1, Math.round(w / (2.5 * k)));
  for (let i = 0; i <= count; i += 1) rect(ctx, x0 + ((w - pillar) * i) / count, top + deck, pillar, height - top - deck);
  ctx.fillStyle = a.body;
  rect(ctx, x0, top, w, deck);
  ctx.fillStyle = a.line;
  rect(ctx, x0, top + deck - Math.max(1, 0.1 * k), w, Math.max(1, 0.1 * k));
  for (let px = x0 + 0.6 * k; px < x0 + w - 2; px += 0.6 * k) rect(ctx, px, top + EDGE_M * k, 1, deck * 0.5);
  ctx.fillStyle = a.edge;
  rect(ctx, x0, top, w, Math.max(2, EDGE_M * k));
}

/** Gravel path on top, grass bank, stone revetment near the water. */
function paintLevee(v: View, a: ZoneArt, x0: number, top: number, w: number): void {
  const { ctx, k, height, waterTop } = v;
  ctx.fillStyle = a.body;
  rect(ctx, x0, top, w, height - top);
  ctx.fillStyle = a.line;
  for (let gx = x0 + 0.4 * k; gx < x0 + w - 2; gx += 1.1 * k) rect(ctx, gx, top + 0.5 * k, 0.15 * k, 0.15 * k);
  ctx.fillStyle = a.extra;
  rect(ctx, x0, waterTop - 0.7 * k, w, height - waterTop + 0.7 * k);
  ctx.fillStyle = a.line;
  rect(ctx, x0, waterTop - 0.7 * k, w, 1);
  ctx.fillStyle = a.edge;
  rect(ctx, x0, top, w, Math.max(2, 0.25 * k));
}

function paintPlatforms(v: View, state: RunnerState, isDay: boolean): void {
  const arts = isDay ? ZONE_ART.day : ZONE_ART.night;
  for (const p of state.level.platforms) {
    const x0 = sx(v, p.x);
    const w = p.length * v.k;
    if (x0 + w < 0 || x0 > v.width) continue;
    const top = sy(v, p.top);
    const art = arts[p.zone];
    if (p.zone === "breakwater") paintBreakwater(v, art, p, x0, top, w);
    else if (p.zone === "pier") paintPier(v, art, x0, top, w);
    else paintLevee(v, art, x0, top, w);
  }
}

/** Coins spin (width shimmer) and flash a small sparkle, time-based and staggered per coin. */
function paintCoins(v: View, state: RunnerState): void {
  const { ctx, k, width } = v;
  const r = COIN_DRAW_R_M * k;
  for (const item of state.level.items) {
    const cx = sx(v, item.x);
    if (cx < -k || cx > width + k || state.taken.includes(item.id)) continue;
    const cy = sy(v, item.y);
    const phase = state.time * 5 + item.id * 1.7;
    const rx = r * (0.45 + 0.55 * Math.abs(Math.cos(phase * 0.6)));
    ctx.fillStyle = "#d39a1c";
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, r, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#f7c948";
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx * 0.72, r * 0.72, 0, 0, Math.PI * 2);
    ctx.fill();
    if (Math.sin(phase) > 0.75) {
      const s = Math.max(2, 0.12 * k);
      ctx.fillStyle = "#fffbe6";
      rect(ctx, cx + r * 0.4 - s / 2, cy - r * 1.1 - s * 1.5, s, s * 3);
      rect(ctx, cx + r * 0.4 - s * 1.5, cy - r * 1.1 - s / 2, s * 3, s);
    }
  }
}

function paintRunnerBody(v: View, state: RunnerState, color: string): void {
  const { ctx, k } = v;
  const feetX = sx(v, state.x);
  const feetY = sy(v, state.y);
  ctx.fillStyle = color;
  ctx.fillRect(feetX - (BODY_W_M / 2) * k, feetY - BODY_H_M * k, BODY_W_M * k, BODY_H_M * k);
  ctx.fillStyle = "#f3d2b3";
  ctx.beginPath();
  ctx.arc(feetX, feetY - (BODY_H_M + HEAD_R_M) * k, HEAD_R_M * k, 0, Math.PI * 2);
  ctx.fill();
}

/** After a fall: water over the runner, droplets and a widening ring for the restart-lock time. */
function paintSplash(v: View, state: RunnerState, p: Palette): void {
  const { ctx, k, width, height, waterTop } = v;
  ctx.globalAlpha = 0.6;
  ctx.fillStyle = p.water;
  ctx.fillRect(0, waterTop + 1, width, height - waterTop);
  const t = Math.max(0, state.overFor);
  const life = Math.min(1, t / RUNNER.RESTART_LOCK);
  const cx = sx(v, state.x);
  ctx.globalAlpha = 1 - life * 0.6;
  ctx.fillStyle = p.foam;
  const ring = (0.4 + 1.6 * life) * k;
  rect(ctx, cx - ring, waterTop - 1, ring * 2, Math.max(2, 0.1 * k));
  const s = Math.max(2, 0.14 * k);
  for (const [vx, vy] of SPLASH_DROPS) {
    const rise = vy * t - 0.5 * SPLASH_G * t * t;
    if (rise < 0) continue;
    rect(ctx, cx + vx * t * k - s / 2, waterTop - rise * k - s / 2, s, s);
  }
  ctx.globalAlpha = 1;
}

export function paintRunner(ctx: CanvasRenderingContext2D, state: RunnerState, frame: RunnerFrame): void {
  const { width, height } = frame;
  if (width <= 0 || height <= 0) return;
  const colors = frame.isDay ? PALETTE.day : PALETTE.night;
  const view = runnerView(speedAt(state.x), width, height);
  const k = view.pxPerM;
  const baseY = height * GROUND_SHARE;
  const v: View = { ctx, width, height, k, left: state.x - view.cameraLeftM, baseY, waterTop: baseY - WATER_SURFACE_M * k };

  paintFarLayer(v, colors, frame.isDay, v.left);
  paintSea(v, colors, v.left);
  paintPlatforms(v, state, frame.isDay);
  paintCoins(v, state);
  paintRunnerBody(v, state, frame.color);
  if (state.phase === "over") paintSplash(v, state, colors);
}
