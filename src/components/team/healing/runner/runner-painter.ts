// Canvas painter for the "방파제 달리기" runner, R2 stage: plain boxes and circles only.
// Pure drawing: reads the engine state, never changes it.

import { RUNNER, runnerView, speedAt, type RunnerState, type RunnerZone } from "@/lib/team/runner";

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

const PALETTE = {
  day: { sky: "#a9d8ea", water: "#2f6f8f", foam: "#d7eef5" },
  night: { sky: "#1b2a4a", water: "#16324a", foam: "#5f7e99" },
} as const;

const ZONE_COLOR: Readonly<Record<RunnerZone, { body: string; edge: string }>> = {
  breakwater: { body: "#8c96a0", edge: "#c4ccd3" },
  pier: { body: "#8a6a4a", edge: "#b8946c" },
  levee: { body: "#6f8f5a", edge: "#9fc27f" },
};

export function paintRunner(ctx: CanvasRenderingContext2D, state: RunnerState, frame: RunnerFrame): void {
  const { width, height } = frame;
  if (width <= 0 || height <= 0) return;
  const colors = frame.isDay ? PALETTE.day : PALETTE.night;
  const view = runnerView(speedAt(state.x), width, height);
  const k = view.pxPerM;
  const left = state.x - view.cameraLeftM;
  const baseY = height * GROUND_SHARE;
  const sx = (x: number): number => (x - left) * k;
  const sy = (y: number): number => baseY - y * k;

  ctx.fillStyle = colors.sky;
  ctx.fillRect(0, 0, width, height);

  const waterTop = sy(WATER_SURFACE_M);
  ctx.fillStyle = colors.water;
  ctx.fillRect(0, waterTop, width, height - waterTop);
  ctx.fillStyle = colors.foam;
  ctx.fillRect(0, waterTop, width, Math.max(1, k * 0.06));

  for (const p of state.level.platforms) {
    const x0 = sx(p.x);
    const w = p.length * k;
    if (x0 + w < 0 || x0 > width) continue;
    const top = sy(p.top);
    const zone = ZONE_COLOR[p.zone];
    ctx.fillStyle = zone.body;
    ctx.fillRect(x0, top, w, height - top);
    ctx.fillStyle = zone.edge;
    ctx.fillRect(x0, top, w, Math.max(2, EDGE_M * k));
  }

  ctx.fillStyle = "#f7c948";
  for (const item of state.level.items) {
    if (state.taken.includes(item.id)) continue;
    const cx = sx(item.x);
    if (cx < -k || cx > width + k) continue;
    ctx.beginPath();
    ctx.arc(cx, sy(item.y), COIN_DRAW_R_M * k, 0, Math.PI * 2);
    ctx.fill();
  }

  const feetX = sx(state.x);
  const feetY = sy(state.y);
  ctx.fillStyle = frame.color;
  ctx.fillRect(feetX - (BODY_W_M / 2) * k, feetY - BODY_H_M * k, BODY_W_M * k, BODY_H_M * k);
  ctx.fillStyle = "#f3d2b3";
  ctx.beginPath();
  ctx.arc(feetX, feetY - (BODY_H_M + HEAD_R_M) * k, HEAD_R_M * k, 0, Math.PI * 2);
  ctx.fill();
}
