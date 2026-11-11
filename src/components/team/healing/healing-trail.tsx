"use client";

import { memo, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import type { HealingActivityId, WeatherEffect } from "@/lib/team/healing";
import {
  activityOf, biomeAt, canvasSize, entranceAt, initialTrailState, stepTrail, tapSide, trailCaption, trailPose,
  type BiomeId, type TrailInput, type TrailPose, type TrailState,
} from "@/lib/team/healing-trail";
import type { TeamMember } from "@/lib/team/workspace";
import { HealingCharacter } from "./healing-character";
import { characterAnchor, drawTrail, type TrailFrame } from "./trail-painter";

/** Jump to a place's start. `soft` ones (weather suggestion) are skipped once the player has walked off. */
export interface TrailJump { sceneId: BiomeId; nonce: number; soft?: boolean }

/** What the frame shows, reported only when one of these changes. */
export interface TrailReport { scene: BiomeId; activity: HealingActivityId; caption: string }

interface HealingTrailProps {
  startScene: BiomeId;
  jump: TrailJump | null;
  member: Pick<TeamMember, "avatar" | "color" | "name"> | null;
  isDay: boolean;
  effect: WeatherEffect;
  /** Big canvas cap (full-screen view). */
  wide: boolean;
  /** Keys are taken only while focus sits inside this element (so other widgets keep theirs). */
  focusRoot: RefObject<HTMLElement | null>;
  onReport: (report: TrailReport) => void;
}

type Dir = "up" | "down" | "left" | "right";
// Physical key codes, so WASD also works while the Korean IME is on (event.key would be "ㅈ" etc.).
const KEY_DIR: Record<string, Dir> = {
  ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right",
  KeyW: "up", KeyS: "down", KeyA: "left", KeyD: "right",
};
const ACTIVE_FRAME_MS = 1000 / 30;
/** Standing or sitting still: only ripples and flames move, so draw less often. */
const IDLE_FRAME_MS = 100;
const ATTR_EVERY_MS = 250;
/** A side tap holds ← or → this long: enough to reach the path edge and turn into a spot. */
const SIDE_TAP_MS = 1100;
const SOFT_JUMP_LIMIT_M = 20;
const ACTIVITY_ZOOM = 1.15;
const FALLBACK_MEMBER = { avatar: "🙂", name: "나", color: "#4f8a9b" };

const isTyping = (target: EventTarget | null): boolean => target instanceof HTMLElement && ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName);
const samePose = (a: TrailPose, b: TrailPose) => a.pose === b.pose && a.facing === b.facing && a.hand === b.hand;
const isMoving = (s: TrailState) => s.phase === "walking" || s.phase === "entering" || s.phase === "leaving";

function reportOf(state: TrailState, isDay: boolean): TrailReport {
  const activity = activityOf(state);
  const entrance = state.phase === "standing" || state.phase === "walking" ? entranceAt(state.distance, isDay) : null;
  return { scene: biomeAt(state.distance).id, activity, caption: trailCaption(activity, entrance) };
}

/** The walk-along healing trail: canvas scenery + my character, arrow keys / taps, one rAF loop at 30 fps. */
export const HealingTrail = memo(function HealingTrail({ startScene, jump, member, isDay, effect, wide, focusRoot, onReport }: HealingTrailProps) {
  const sceneRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const whoRef = useRef<HTMLDivElement | null>(null);
  const [initial] = useState(() => initialTrailState(startScene));
  const stateRef = useRef<TrailState>(initial);
  const keysRef = useRef(new Set<Dir>());
  const tapRef = useRef(false);
  const sideTapRef = useRef<{ dir: -1 | 1; until: number } | null>(null);
  const walkedRef = useRef(0);
  const movedRef = useRef(false);
  const envRef = useRef({ isDay, effect, wide });
  const reportRef = useRef<TrailReport | null>(null);
  const onReportRef = useRef(onReport);
  const wakeRef = useRef<() => void>(() => undefined);
  const [view, setView] = useState<TrailReport>(() => reportOf(initial, isDay));
  const [pose, setPose] = useState<TrailPose>(() => trailPose(initial, { forward: 0, side: 0, tap: false }));

  useEffect(() => { onReportRef.current = onReport; }, [onReport]);
  useEffect(() => {
    envRef.current = { isDay, effect, wide };
    wakeRef.current();
  }, [isDay, effect, wide]);

  // Place picks and the weather suggestion.
  useEffect(() => {
    if (!jump) return;
    if (jump.soft && (movedRef.current || walkedRef.current >= SOFT_JUMP_LIMIT_M)) return;
    if (!jump.soft) movedRef.current = true;
    stateRef.current = initialTrailState(jump.sceneId);
    sideTapRef.current = null;
    tapRef.current = false;
    wakeRef.current();
  }, [jump]);

  // Keys: arrows / WASD / Space while focus is inside the healing area; never from text fields.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const dir = KEY_DIR[event.code];
      if ((!dir && event.code !== "Space") || event.altKey || event.ctrlKey || event.metaKey || isTyping(event.target)) return;
      if (!(event.target instanceof Node) || !focusRoot.current?.contains(event.target)) return;
      // Space on a button is that button's click.
      if (!dir && event.target instanceof HTMLButtonElement) return;
      event.preventDefault();
      movedRef.current = true;
      if (dir) keysRef.current.add(dir);
      else if (!event.repeat) tapRef.current = true;
      wakeRef.current();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const dir = KEY_DIR[event.code];
      if (dir && keysRef.current.delete(dir)) wakeRef.current();
    };
    const release = () => { keysRef.current.clear(); wakeRef.current(); };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", release);
    };
  }, [focusRoot]);

  // Frame loop. Stops while the tab is hidden or the picture is off screen; with reduced motion it only
  // runs while I am actually moving (no idle ripples), then leaves a still picture.
  useEffect(() => {
    const scene = sceneRef.current;
    const canvas = canvasRef.current;
    if (!scene || !canvas) return;
    const ctx = canvas.getContext("2d");
    const motion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    let reduced = Boolean(motion?.matches);
    let onScreen = true;
    let raf = 0;
    let lastFrame = 0;
    let lastAttr = 0;
    let lastPhase = "";
    let time = 0;
    let zoom = 1;
    let cssWidth = 0;

    const input = (now: number): TrailInput => {
      const keys = keysRef.current;
      const forward = keys.has("up") === keys.has("down") ? 0 : keys.has("up") ? 1 : -1;
      const heldSide = keys.has("left") === keys.has("right") ? 0 : keys.has("left") ? -1 : 1;
      const pulse = sideTapRef.current && sideTapRef.current.until > now ? sideTapRef.current.dir : 0;
      if (sideTapRef.current && sideTapRef.current.until <= now) sideTapRef.current = null;
      return { forward, side: heldSide || pulse, tap: tapRef.current };
    };
    const busy = (s: TrailState) => isMoving(s) || keysRef.current.size > 0 || tapRef.current || sideTapRef.current !== null;
    const writeAttrs = (s: TrailState) => {
      scene.setAttribute("data-x", s.distance.toFixed(1));
      scene.setAttribute("data-y", "0");
      scene.setAttribute("data-phase", s.phase);
    };

    const render = (s: TrailState, inp: TrailInput, dt: number) => {
      const env = envRef.current;
      if (!reduced) time += dt;
      const targetZoom = s.phase === "activity" ? ACTIVITY_ZOOM : 1;
      zoom = reduced ? targetZoom : zoom + (targetZoom - zoom) * Math.min(1, dt * 2);
      const moving = isMoving(s);
      const frame: TrailFrame = {
        width: canvas.width, height: canvas.height, distance: s.distance, lateral: s.lateral, isDay: env.isDay, effect: env.effect,
        time, zoom, bob: moving && !reduced ? Math.abs(Math.sin((time * Math.PI) / 0.42)) * -2.5 : 0,
        entranceId: s.phase === "standing" || s.phase === "walking" ? entranceAt(s.distance, env.isDay)?.id ?? null : null,
      };
      if (ctx) drawTrail(ctx, frame);
      // Character SVG over the canvas, converted from canvas pixels to CSS pixels.
      const who = whoRef.current;
      if (who && cssWidth > 0) {
        const k = cssWidth / canvas.width;
        const a = characterAnchor(frame);
        const svgH = ((a.height * zoom * 160) / 102) * k;
        const svgW = (svgH * 140) / 160;
        const footY = (a.y - a.height / 2 + (a.height / 2) * zoom) * k;
        who.style.width = `${svgW}px`;
        who.style.height = `${svgH}px`;
        who.style.transform = `translate(${a.x * k - svgW / 2}px, ${footY - (svgH * 150) / 160}px)`;
      }
      const nextPose = trailPose(s, inp);
      setPose((prev) => (samePose(prev, nextPose) ? prev : nextPose));
      const report = reportOf(s, env.isDay);
      const prev = reportRef.current;
      if (!prev || prev.scene !== report.scene || prev.activity !== report.activity || prev.caption !== report.caption) {
        reportRef.current = report;
        setView(report);
        onReportRef.current(report);
      }
    };

    const tick = (now: number) => {
      raf = 0;
      if (document.hidden || !onScreen) { writeAttrs(stateRef.current); return; }
      const idle = !busy(stateRef.current);
      if (now - lastFrame < (idle ? IDLE_FRAME_MS : ACTIVE_FRAME_MS) - 2) { raf = window.requestAnimationFrame(tick); return; }
      const dt = Math.min(0.25, Math.max(0, (now - lastFrame) / 1000));
      lastFrame = now;
      const inp = input(now);
      tapRef.current = false;
      const before = stateRef.current;
      const next = stepTrail(before, inp, dt, { isDay: envRef.current.isDay });
      walkedRef.current += Math.abs(next.distance - before.distance) < 10 ? Math.abs(next.distance - before.distance) : 0;
      stateRef.current = next;
      render(next, inp, dt);
      if (next.phase !== lastPhase || now - lastAttr >= ATTR_EVERY_MS) { writeAttrs(next); lastAttr = now; lastPhase = next.phase; }
      if (reduced && !busy(next)) { writeAttrs(next); return; }
      raf = window.requestAnimationFrame(tick);
    };
    const wake = () => {
      if (raf || document.hidden || !onScreen) return;
      lastFrame = performance.now() - ACTIVE_FRAME_MS;
      raf = window.requestAnimationFrame(tick);
    };
    wakeRef.current = wake;

    const resize = () => {
      const rect = scene.getBoundingClientRect();
      cssWidth = rect.width;
      const size = canvasSize(rect.width, rect.height, window.devicePixelRatio || 1, envRef.current.wide);
      if (canvas.width !== size.width || canvas.height !== size.height) { canvas.width = size.width; canvas.height = size.height; }
      // A resize clears the canvas: draw again even when the loop is resting.
      if (!raf) render(stateRef.current, { forward: 0, side: 0, tap: false }, 0);
    };
    const resizer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
    resizer?.observe(scene);
    resize();
    const watcher = typeof IntersectionObserver !== "undefined"
      ? new IntersectionObserver((entries) => { onScreen = entries.some((e) => e.isIntersecting); if (onScreen) wake(); })
      : null;
    watcher?.observe(scene);
    const onVisibility = () => { if (!document.hidden) wake(); };
    const onMotion = () => { reduced = Boolean(motion?.matches); wake(); };
    document.addEventListener("visibilitychange", onVisibility);
    motion?.addEventListener?.("change", onMotion);
    writeAttrs(stateRef.current);
    wake();
    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      wakeRef.current = () => undefined;
      resizer?.disconnect();
      watcher?.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      motion?.removeEventListener?.("change", onMotion);
    };
  }, []);

  // Tap/click: middle walks or stops (or stands up), left/right quarter steps that way (into a spot at a signpost).
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const side = tapSide(rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0.5);
    if (side === 0) tapRef.current = true;
    else sideTapRef.current = { dir: side, until: performance.now() + SIDE_TAP_MS };
    movedRef.current = true;
    event.currentTarget.focus({ preventScroll: true });
    wakeRef.current();
  };

  return (
    <div
      ref={sceneRef}
      className="absolute inset-0 select-none overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-300"
      style={{ touchAction: "pan-y" }}
      tabIndex={0}
      role="application"
      aria-label="힐링 산책 (방향키로 걷기, 탭하면 걷기·멈춤)"
      data-testid="healing-scene"
      data-scene={view.scene}
      data-activity={view.activity}
      onPointerDown={onPointerDown}
    >
      <canvas ref={canvasRef} className="block h-full w-full" aria-hidden="true" />
      <div ref={whoRef} className="pointer-events-none absolute left-0 top-0 will-change-transform">
        <HealingCharacter member={member ?? FALLBACK_MEMBER} pose={pose.pose} facing={pose.facing} hand={pose.hand} className="block h-full w-full" />
      </div>
    </div>
  );
});
