"use client";

import { memo, useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { findActivity, type WeatherEffect } from "@/lib/team/healing";
import {
  activityForProp, hikeProgress, portalAt, propAt, stepCharacter, walkToward, zoneAt, zoneSpawn,
  PORTAL_DELAY_MS, WORLD, WORLD_HEIGHT, WORLD_SIZE, WORLD_WIDTH, WORLD_ZONES,
  type HealingProp, type HealingPropKind, type SceneArtId, type Vec, type WorldActivityId,
} from "@/lib/team/healing-world";
import type { TeamMember, TeamPresence } from "@/lib/team/workspace";
import { WalkingCharacter } from "../character";
import { SCENE_ART, type SceneArtProps } from "./scenes";

/** Jump straight to a zone. `soft` ones (weather suggestion) are skipped once the player has moved. */
export interface WorldTeleport { sceneId: SceneArtId; nonce: number; soft?: boolean }
/** Walk to the first prop in the current zone that starts this activity. */
export interface WalkRequest { activity: WorldActivityId; nonce: number }

interface HealingWorldProps {
  startZone: SceneArtId;
  teleport: WorldTeleport | null;
  walkRequest: WalkRequest | null;
  member: Pick<TeamMember, "avatar" | "color" | "name"> | null;
  isDay: boolean;
  effect: WeatherEffect;
  /** Keys are taken only while focus sits inside this element (so other widgets keep theirs). */
  focusRoot: RefObject<HTMLElement | null>;
  onZone: (zone: SceneArtId) => void;
  onActivity: (activity: WorldActivityId | null) => void;
}

type Facing = TeamPresence["facing"];
interface View { pos: Vec; cam: Vec; facing: Facing; moving: boolean; activity: WorldActivityId | null; summit: boolean; zone: SceneArtId }

// Physical key codes, so WASD also works while the Korean IME is on (event.key would be "ㅈ" etc.).
const KEY_DIR: Record<string, "up" | "down" | "left" | "right"> = {
  ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right",
  KeyW: "up", KeyS: "down", KeyA: "left", KeyD: "right",
};
const PROP_EMOJI: Record<HealingPropKind, string> = { fishing: "🎣", smoke: "🚬", hike: "🚩", bench: "🪑", laptop: "💻", stargaze: "🔭", snowman: "⛄", campfire: "🔥", portal: "🚪" };
const CAMERA_EASE = 5;
const MAX_FRAME_S = 0.05;
const STROLL_DISTANCE = 500;
const SUMMIT_STEPS = 3;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
/** Camera follows x inside the zone's own row (rows can differ in length). */
function cameraFor(pos: Vec): Vec {
  const row = zoneAt(pos).origin.y;
  const xs = WORLD_ZONES.filter((z) => z.origin.y === row).map((z) => z.origin.x);
  return { x: clamp(pos.x - WORLD_WIDTH / 2, Math.min(...xs), Math.max(...xs)), y: row };
}
const isTyping = (target: EventTarget | null): boolean => target instanceof HTMLElement && ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName);

/** Zones close enough to the player to be on screen (own zone and its row neighbours). */
function zonesNear(zoneId: SceneArtId): string {
  const here = WORLD_ZONES.find((z) => z.id === zoneId) ?? WORLD_ZONES[0];
  return WORLD_ZONES.filter((z) => z.origin.y === here.origin.y && Math.abs(z.origin.x - here.origin.x) <= WORLD_WIDTH).map((z) => z.id).join(",");
}

/** Zone paintings laid out side by side in world space; only the ones near the player are mounted. */
const WorldArt = memo(function WorldArt({ isDay, effect, near }: SceneArtProps & { near: string }) {
  const shown = near.split(",");
  return <>
    {WORLD_ZONES.filter((zone) => shown.includes(zone.id)).map((zone) => {
      const Art = SCENE_ART[zone.id];
      return (
        <svg key={zone.id} data-zone={zone.id} x={zone.origin.x} y={zone.origin.y} width={WORLD_WIDTH} height={WORLD_HEIGHT} viewBox={`0 0 ${WORLD_WIDTH} ${WORLD_HEIGHT}`}>
          <Art isDay={isDay} effect={effect} />
        </svg>
      );
    })}
  </>;
});

const PropLayer = memo(function PropLayer({ props, nearId }: { props: readonly HealingProp[]; nearId: string | null }) {
  return <g>
    {props.map((p) => {
      const near = p.id === nearId;
      const cx = p.x + p.w / 2;
      return (
        <g key={p.id} data-testid={`healing-prop-${p.id}`} data-near={near ? "true" : undefined} pointerEvents="none">
          {near && <rect x={p.x} y={p.y} width={p.w} height={p.h} rx="12" fill="#ffffff" opacity="0.18" stroke="#fff8e8" strokeWidth="4" />}
          <text x={cx} y={p.y + p.h - 10} textAnchor="middle" fontSize="44">{PROP_EMOJI[p.kind]}</text>
          <rect x={cx - 52} y={p.y + p.h + 6} width="104" height="26" rx="13" fill="#0f172a" opacity={near ? 0.85 : 0.55} />
          <text x={cx} y={p.y + p.h + 24} textAnchor="middle" fontSize="16" fontWeight="600" fill="#fffdf5">{p.label}</text>
        </g>
      );
    })}
  </g>;
});

/** The walkable healing world: paintings, props, my character, keyboard/tap movement and the camera. */
export function HealingWorld({ startZone, teleport, walkRequest, member, isDay, effect, focusRoot, onZone, onActivity }: HealingWorldProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  // Mutable simulation state lives in refs; the frame loop publishes a snapshot into `view`.
  const [initial] = useState(() => { const pos = zoneSpawn(startZone); return { pos, cam: cameraFor(pos) }; });
  const posRef = useRef<Vec>(initial.pos);
  const camRef = useRef<Vec>(initial.cam);
  const keysRef = useRef(new Set<"up" | "down" | "left" | "right">());
  const targetRef = useRef<Vec | null>(null);
  const portalRef = useRef<{ id: string; since: number } | null>(null);
  const visitedRef = useRef<string[]>([]);
  const movedRef = useRef(false);
  const facingRef = useRef<Facing>("down");
  const reportedRef = useRef<{ zone: SceneArtId | null; activity: WorldActivityId | null }>({ zone: null, activity: null });
  const callbacks = useRef({ onZone, onActivity });
  useEffect(() => { callbacks.current = { onZone, onActivity }; }, [onZone, onActivity]);
  const [view, setView] = useState<View>({ pos: initial.pos, cam: initial.cam, facing: "down", moving: false, activity: null, summit: false, zone: startZone });

  const jump = useCallback((to: Vec) => {
    posRef.current = to;
    camRef.current = cameraFor(to);
    targetRef.current = null;
    portalRef.current = null;
  }, []);

  // Fast travel (scene chips, weather suggestion).
  useEffect(() => {
    if (!teleport) return;
    if (teleport.soft && movedRef.current) return;
    if (!teleport.soft) movedRef.current = true;
    jump(zoneSpawn(teleport.sceneId));
  }, [teleport, jump]);

  // Activity button: walk to the prop that starts it; "walk" is just a stroll.
  useEffect(() => {
    if (!walkRequest) return;
    movedRef.current = true;
    const pos = posRef.current;
    const zone = zoneAt(pos);
    if (walkRequest.activity === "walk") {
      const ahead = pos.x - zone.origin.x < WORLD_WIDTH / 2 ? STROLL_DISTANCE : -STROLL_DISTANCE;
      targetRef.current = { x: pos.x + ahead, y: pos.y };
      return;
    }
    const prop = WORLD.props.find((p) => p.id.startsWith(`${zone.id}:`) && activityForProp(p.kind) === walkRequest.activity);
    if (prop) targetRef.current = { x: prop.x + prop.w / 2, y: prop.y + prop.h / 2 };
  }, [walkRequest]);

  // Keys: arrows / WASD while focus is inside the healing area; never from text fields.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const dir = KEY_DIR[event.code];
      if (!dir || event.altKey || event.ctrlKey || event.metaKey || isTyping(event.target)) return;
      if (!(event.target instanceof Node) || !focusRoot.current?.contains(event.target)) return;
      event.preventDefault();
      keysRef.current.add(dir);
      targetRef.current = null;
      movedRef.current = true;
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const dir = KEY_DIR[event.code];
      if (dir) keysRef.current.delete(dir);
    };
    const release = () => keysRef.current.clear();
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", release);
    };
  }, [focusRoot]);

  // Frame loop: move, detect props/portals, follow with the camera, publish the view.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(MAX_FRAME_S, Math.max(0, (now - last) / 1000));
      last = now;
      const pos = posRef.current;
      const keys = keysRef.current;
      const dir = { x: ((keys.has("right") ? 1 : 0) - (keys.has("left") ? 1 : 0)) as -1 | 0 | 1, y: ((keys.has("down") ? 1 : 0) - (keys.has("up") ? 1 : 0)) as -1 | 0 | 1 };
      let next = pos;
      if (dir.x !== 0 || dir.y !== 0) next = stepCharacter(WORLD, pos, dir, dt);
      else if (targetRef.current) {
        next = walkToward(WORLD, pos, targetRef.current, dt);
        const stuck = dt > 0 && next.x === pos.x && next.y === pos.y;
        if (stuck || (next.x === targetRef.current.x && next.y === targetRef.current.y)) targetRef.current = null;
      }
      const moving = next.x !== pos.x || next.y !== pos.y;
      if (moving) {
        const dx = next.x - pos.x;
        const dy = next.y - pos.y;
        facingRef.current = Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? "left" : "right") : dy < 0 ? "up" : "down";
      }
      posRef.current = next;

      const prop = propAt(WORLD, next);
      // Record each arrival (repeats allowed) so an out-of-order detour can still be made good later.
      if (prop?.kind === "hike" && visitedRef.current[visitedRef.current.length - 1] !== prop.id) visitedRef.current = [...visitedRef.current, prop.id];
      const summit = zoneAt(next).id === "mountain" && hikeProgress(WORLD, visitedRef.current) >= SUMMIT_STEPS;
      const activity: WorldActivityId | null = moving ? "walk" : prop ? activityForProp(prop.kind) : null;

      const portal = portalAt(WORLD, next);
      if (portal?.to) {
        if (portalRef.current?.id !== portal.id) portalRef.current = { id: portal.id, since: now };
        else if (now - portalRef.current.since >= PORTAL_DELAY_MS) jump(zoneSpawn(portal.to));
      } else portalRef.current = null;

      const target = cameraFor(posRef.current);
      const cam = camRef.current;
      camRef.current = { x: cam.x + (target.x - cam.x) * Math.min(1, dt * CAMERA_EASE), y: target.y };

      const zone = zoneAt(posRef.current).id;
      if (reportedRef.current.zone !== zone) { reportedRef.current.zone = zone; callbacks.current.onZone(zone); }
      if (reportedRef.current.activity !== activity) { reportedRef.current.activity = activity; callbacks.current.onActivity(activity); }
      const settled = Math.abs(target.x - camRef.current.x) < 0.5 ? { x: target.x, y: target.y } : camRef.current;
      camRef.current = settled;
      setView((prev) => (
        prev.pos.x === posRef.current.x && prev.pos.y === posRef.current.y && prev.cam.x === settled.x && prev.cam.y === settled.y
        && prev.facing === facingRef.current && prev.moving === moving && prev.activity === activity && prev.summit === summit && prev.zone === zone
          ? prev
          : { pos: posRef.current, cam: settled, facing: facingRef.current, moving, activity, summit, zone }
      ));
      raf = window.requestAnimationFrame(frame);
    };
    raf = window.requestAnimationFrame(frame);
    return () => window.cancelAnimationFrame(raf);
  }, [jump]);

  // Tap/click: walk to that spot (an unreachable spot just stops at the nearest floor).
  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm || ctm.a === 0 || ctm.d === 0) return;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(ctm.inverse());
    targetRef.current = { x: point.x, y: point.y };
    movedRef.current = true;
    svg.focus({ preventScroll: true });
  };

  const stub: TeamMember = { id: "me", name: member?.name ?? "나", role: "", avatar: member?.avatar ?? "🙂", color: member?.color ?? "#4f8a9b", created_at: "" };
  const presence: TeamPresence = { member_id: "me", layout_id: null, x: view.pos.x, y: view.pos.y, facing: view.facing, motion: "standing" };
  const near = propAt(WORLD, view.pos);
  const bubble = view.activity && view.activity !== "walk" ? findActivity(view.activity).emoji : null;

  return (
    <svg
      ref={svgRef}
      viewBox={`${view.cam.x} ${view.cam.y} ${WORLD_WIDTH} ${WORLD_HEIGHT}`}
      preserveAspectRatio="xMidYMid slice"
      className="absolute inset-0 h-full w-full touch-none select-none outline-none"
      tabIndex={0}
      role="application"
      aria-label="힐링 월드 (방향키로 걷기)"
      data-testid="healing-scene"
      data-scene={view.zone}
      data-x={Math.round(view.pos.x)}
      data-y={Math.round(view.pos.y)}
      data-activity={view.activity ?? ""}
      onPointerDown={onPointerDown}
    >
      <WorldArt isDay={isDay} effect={effect} near={zonesNear(view.zone)} />
      <PropLayer props={WORLD.props} nearId={near?.id ?? null} />
      {!isDay && view.zone !== "rooftop" && <rect width={WORLD_SIZE.x} height={WORLD_SIZE.y} fill="#0f1a33" opacity="0.28" pointerEvents="none" />}
      <WalkingCharacter member={stub} presence={presence} roomWidth={WORLD_SIZE.x} own moving={view.moving} />
      {bubble && <text x={view.pos.x + 34} y={view.pos.y - 92} fontSize="36" pointerEvents="none" data-testid="healing-bubble">{bubble}</text>}
      {view.summit && <g pointerEvents="none" data-testid="healing-summit"><rect x={view.pos.x - 46} y={view.pos.y - 150} width="92" height="32" rx="16" fill="#f7c948" /><text x={view.pos.x} y={view.pos.y - 128} textAnchor="middle" fontSize="18" fontWeight="700" fill="#3b2f12">정상!</text></g>}
    </svg>
  );
}
