"use client";

import { useEffect, useRef } from "react";
import {
  RUNNER, dailySeed, initialRunnerState, loadRunnerBest, pauseRunner, runnerResult, runnerScore, saveRunnerBest, stepRunner,
  type RunnerPhase, type RunnerResult, type RunnerState,
} from "@/lib/team/runner";
import type { TeamMember } from "@/lib/team/workspace";
import { paintRunner } from "./runner-painter";

interface HealingRunnerProps {
  member: Pick<TeamMember, "color" | "name"> | null;
  isDay: boolean;
  /** Called once when a run ends. Stage 1 does not use it; team records attach here later. */
  onResult?: (result: RunnerResult) => void;
}

const MAX_STEPS_PER_FRAME = 4;
/** A frame gap longer than this pauses instead of catching up. */
const STALL_MS = 250;
const ATTR_EVERY_MS = 250;
const DPR_MAX = 1.5;
const DEFAULT_COLOR = "#4f8a9b";

const PANEL_TEXT: Readonly<Record<RunnerPhase, string>> = {
  ready: "Space 또는 탭으로 출발 · 누르면 점프, 길게 누르면 높이",
  paused: "멈춤 · Space 또는 탭으로 계속",
  running: "",
  over: "",
};

function seoulDateKey(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(now);
}

/** "방파제 달리기": rAF loop over the pure engine, one held input (Space on this element, or pointer). */
export function HealingRunner({ member, isDay, onResult }: HealingRunnerProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hudRef = useRef<HTMLParagraphElement | null>(null);
  const panelRef = useRef<HTMLParagraphElement | null>(null);
  // Latest props for the loop, which is set up once per mount.
  const propsRef = useRef({ isDay, color: member?.color ?? DEFAULT_COLOR, onResult });
  useEffect(() => { propsRef.current = { isDay, color: member?.color ?? DEFAULT_COLOR, onResult }; }, [isDay, member?.color, onResult]);

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    const hud = hudRef.current;
    const panel = panelRef.current;
    const ctx = canvas?.getContext("2d") ?? null;
    if (!root || !canvas || !hud || !panel || !ctx) return;

    const dateKey = seoulDateKey();
    let state: RunnerState = initialRunnerState(dailySeed(dateKey));
    let best = loadRunnerBest();
    let held = false;
    // A press seen by at least one step even if released before the next frame.
    let latch = false;
    let raf = 0;
    let last = 0;
    let acc = 0;
    let lastAttr = -Infinity;
    let shownPhase: RunnerPhase | null = null;
    let shownAir = "";
    let size = { w: 0, h: 0, dpr: 0 };

    const draw = () => {
      const w = root.clientWidth;
      const h = root.clientHeight;
      const dpr = Math.min(DPR_MAX, window.devicePixelRatio || 1);
      if (w !== size.w || h !== size.h || dpr !== size.dpr) {
        size = { w, h, dpr };
        canvas.width = Math.max(1, Math.round(w * dpr));
        canvas.height = Math.max(1, Math.round(h * dpr));
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      paintRunner(ctx, state, { width: w, height: h, isDay: propsRef.current.isDay, color: propsRef.current.color });
    };

    const publish = (now: number, force: boolean) => {
      const phase = state.phase;
      const phaseChanged = phase !== shownPhase;
      if (phaseChanged) {
        shownPhase = phase;
        root.dataset.phase = phase;
        root.style.touchAction = phase === "running" ? "none" : "pan-y";
        if (phase === "over") {
          const score = runnerScore(state);
          best = saveRunnerBest(score);
          panel.textContent = `${Math.floor(state.x)} m · 동전 ${state.coins} · 점수 ${score} (최고 ${best}) · Space/탭으로 다시`;
          propsRef.current.onResult?.(runnerResult(state, dateKey));
        } else {
          panel.textContent = PANEL_TEXT[phase];
        }
      }
      const air = phase === "running" && !state.grounded ? "true" : "false";
      if (air !== shownAir) { shownAir = air; root.dataset.air = air; }
      if (force || phaseChanged || now - lastAttr >= ATTR_EVERY_MS) {
        lastAttr = now;
        const distance = String(Math.floor(state.x));
        root.dataset.distance = distance;
        root.dataset.coins = String(state.coins);
        root.dataset.best = String(best);
        hud.textContent = `${distance} m · 동전 ${state.coins} · 최고 ${best}`;
      }
    };

    const step = () => {
      // latch means "released, then pressed again". If no step ran in between, the engine
      // still remembers the old press, so clear it to let this press count as a new one.
      const base = latch && state.held ? { ...state, held: false } : state;
      state = stepRunner(base, { held: held || latch });
      latch = false;
    };
    // Loop only while running, and through the restart lock after a fall (the lock counts steps).
    const wantsLoop = () => state.phase === "running" || (state.phase === "over" && state.overFor < RUNNER.RESTART_LOCK);

    const frame = (now: number) => {
      raf = 0;
      const gap = now - last;
      last = now;
      if (gap > STALL_MS && state.phase === "running") {
        state = stepRunner(pauseRunner(state), { held: false });
        held = false;
        latch = false;
      } else {
        acc += gap / 1000;
        let steps = 0;
        while (acc >= RUNNER.STEP && steps < MAX_STEPS_PER_FRAME) { step(); acc -= RUNNER.STEP; steps += 1; }
        if (steps === MAX_STEPS_PER_FRAME) acc = Math.min(acc, RUNNER.STEP);
      }
      draw();
      publish(now, false);
      if (wantsLoop()) raf = window.requestAnimationFrame(frame);
    };
    const startLoop = () => {
      if (raf || !wantsLoop()) return;
      last = performance.now();
      acc = 0;
      raf = window.requestAnimationFrame(frame);
    };

    const press = () => {
      if (held) return;
      held = true;
      latch = true;
      if (raf) return;
      // Loop is idle (ready / paused / over after the lock): apply the press now and start.
      step();
      draw();
      publish(performance.now(), true);
      startLoop();
    };
    const release = () => {
      held = false;
      // Idle loop: tell the engine the button is up so the next press counts as a new press.
      if (!raf) state = stepRunner(state, { held: false });
    };
    const pause = () => {
      held = false;
      latch = false;
      if (state.phase !== "running") return;
      if (raf) { window.cancelAnimationFrame(raf); raf = 0; }
      state = stepRunner(pauseRunner(state), { held: false });
      draw();
      publish(performance.now(), true);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.altKey || event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      if (!event.repeat) press();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== "Space") return;
      event.preventDefault();
      release();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      root.focus({ preventScroll: true });
      press();
    };
    const onPointerUp = () => { if (held) release(); };
    const onContextMenu = (event: MouseEvent) => { if (state.phase === "running") event.preventDefault(); };
    const onVisibility = () => { if (document.hidden) pause(); };

    root.addEventListener("keydown", onKeyDown);
    root.addEventListener("keyup", onKeyUp);
    root.addEventListener("pointerdown", onPointerDown);
    root.addEventListener("pointerup", onPointerUp);
    root.addEventListener("pointercancel", onPointerUp);
    root.addEventListener("pointerleave", onPointerUp);
    root.addEventListener("contextmenu", onContextMenu);
    root.addEventListener("blur", pause);
    window.addEventListener("blur", pause);
    document.addEventListener("visibilitychange", onVisibility);
    const resize = new ResizeObserver(() => draw());
    resize.observe(root);
    const seen = new IntersectionObserver((entries) => { if (entries.some((entry) => !entry.isIntersecting)) pause(); });
    seen.observe(root);

    draw();
    publish(performance.now(), true);

    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      root.removeEventListener("keydown", onKeyDown);
      root.removeEventListener("keyup", onKeyUp);
      root.removeEventListener("pointerdown", onPointerDown);
      root.removeEventListener("pointerup", onPointerUp);
      root.removeEventListener("pointercancel", onPointerUp);
      root.removeEventListener("pointerleave", onPointerUp);
      root.removeEventListener("contextmenu", onContextMenu);
      root.removeEventListener("blur", pause);
      window.removeEventListener("blur", pause);
      document.removeEventListener("visibilitychange", onVisibility);
      resize.disconnect();
      seen.disconnect();
    };
  }, []);

  return (
    <div
      ref={rootRef}
      role="application"
      aria-label="방파제 달리기 (Space 또는 탭으로 점프)"
      tabIndex={0}
      className="absolute inset-0 select-none outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/70"
      data-testid="runner-scene"
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden />
      <p ref={hudRef} className="pointer-events-none absolute left-2 top-1.5 rounded bg-black/40 px-1.5 py-0.5 font-mono text-[11px] tabular-nums" />
      <p ref={panelRef} aria-live="polite" className="pointer-events-none absolute inset-x-3 top-1/2 -translate-y-1/2 text-center text-xs font-medium drop-shadow empty:hidden" />
      <p className="pointer-events-none absolute bottom-1.5 left-2 text-[11px] text-white/85 drop-shadow">🏃 달리기 · {member?.name ?? "나"}</p>
    </div>
  );
}
