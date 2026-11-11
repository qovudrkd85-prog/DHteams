"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { listTeamPresence, saveTeamPresence } from "./presence";
import { OFFICE_HEIGHT, OFFICE_WIDTH, type OfficeItem, type OfficeLayout, type TeamMember, type TeamPresence } from "./workspace";

export type OfficeDirection = TeamPresence["facing"];
/** SVG-style rectangle: x/y identify the upper-left corner. */
export type OfficeObstacle = { x: number; y: number; width: number; height: number };
type Props = { member: TeamMember | null; layout: OfficeLayout | null; paused: boolean; viewportRef: RefObject<HTMLDivElement | null>; obstacles?: OfficeObstacle[] };
type PendingWrite = { value: TeamPresence; key: string; urgent: boolean };
const keys: Record<string, OfficeDirection | undefined> = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", w: "up", s: "down", a: "left", d: "right" };
const speed = 160;
const boxSizes = { desk: [62, 28], table: [96, 48], sofa: [83, 40], plant: [24, 22], board: [63, 18] } as const;
const message = (error: unknown) => error instanceof Error ? error.message : "위치를 저장하지 못했어요. 연결을 확인해 주세요.";
const noObstacles: OfficeObstacle[] = [];

function modalVisible() {
  return Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]')).some((element) => element.checkVisibility());
}

function bounded(x: number, y: number, layout: OfficeLayout) {
  return { x: Math.max(24, Math.min((layout.canvas_width ?? OFFICE_WIDTH) - 24, x)), y: Math.max(80, Math.min((layout.canvas_height ?? OFFICE_HEIGHT) - 30, y)) };
}

/** Test the character's feet against floor footprints, accounting for furniture rotation. */
function blocked(x: number, y: number, layout: OfficeLayout, obstacles: OfficeObstacle[]) {
  return obstacles.some((item) => x > item.x - 9 && x < item.x + item.width + 9 && y > item.y - 7 && y < item.y + item.height + 7) || layout.items.some((item) => {
    const angle = -item.rotation * Math.PI / 180;
    const dx = x - item.x;
    const dy = y - item.y;
    const localX = dx * Math.cos(angle) - dy * Math.sin(angle);
    const localY = dx * Math.sin(angle) + dy * Math.cos(angle);
    const [width, height] = boxSizes[item.kind];
    return Math.abs(localX) < width + 9 && Math.abs(localY) < height + 7;
  });
}

function spawn(layout: OfficeLayout, obstacles: OfficeObstacle[]) {
  const center = bounded((layout.canvas_width ?? OFFICE_WIDTH) / 2, (layout.canvas_height ?? OFFICE_HEIGHT) - 120, layout);
  if (!blocked(center.x, center.y, layout, obstacles)) return center;
  // A decorated room can cover the normal entrance. Find its nearest free floor tile.
  for (let radius = 30; radius <= 450; radius += 30) {
    for (const [dx, dy] of [[radius, 0], [-radius, 0], [0, -radius], [0, radius], [radius, -radius], [-radius, -radius]]) {
      const point = bounded(center.x + dx, center.y + dy, layout);
      if (!blocked(point.x, point.y, layout, obstacles)) return point;
    }
  }
  return center;
}

export function useOfficePresence({ member, layout, paused, viewportRef, obstacles = noObstacles }: Props) {
  const [player, setPlayer] = useState<TeamPresence | null>(null);
  const [peers, setPeers] = useState<TeamPresence[]>([]);
  const [moving, setMoving] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const runtime = useRef({ member, layout, paused, obstacles });
  const position = useRef<TeamPresence | null>(null);
  const activeKey = useRef("");
  const interacted = useRef(false);
  const held = useRef(new Set<OfficeDirection>());
  const target = useRef<{ x: number; y: number } | null>(null);
  const animation = useRef<number | null>(null);
  const lastFrame = useRef<number | null>(null);
  const mounted = useRef(false);
  const pending = useRef<PendingWrite | null>(null);
  const writing = useRef(false);
  const lastWrite = useRef(0);
  const writeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushRef = useRef<() => Promise<void>>(async () => undefined);
  const animateRef = useRef<(time: number) => void>(() => undefined);

  const flush = useCallback(async () => {
    if (writing.current || !pending.current) return;
    if (writeTimer.current) clearTimeout(writeTimer.current);
    writeTimer.current = null;
    const next = pending.current;
    pending.current = null;
    writing.current = true;
    lastWrite.current = Date.now();
    try {
      await saveTeamPresence(next.value);
      if (mounted.current && next.key === activeKey.current) setSyncError(null);
    } catch (error) {
      if (mounted.current && next.key === activeKey.current) setSyncError(message(error));
    } finally {
      writing.current = false;
      const queued = pending.current as PendingWrite | null;
      if (queued) {
        const delay = queued.urgent ? 0 : Math.max(0, 1000 - (Date.now() - lastWrite.current));
        writeTimer.current = setTimeout(() => { void flushRef.current(); }, delay);
      }
    }
  }, []);

  const queueSave = useCallback((value: TeamPresence, urgent = false) => {
    pending.current = { value: { ...value }, key: activeKey.current, urgent };
    if (urgent) {
      if (writeTimer.current) clearTimeout(writeTimer.current);
      writeTimer.current = null;
      void flushRef.current();
    } else if (!writing.current && !writeTimer.current) {
      writeTimer.current = setTimeout(() => { void flushRef.current(); }, Math.max(0, 1000 - (Date.now() - lastWrite.current)));
    }
  }, []);

  const stopMovement = useCallback(() => {
    const wasMoving = held.current.size > 0 || animation.current !== null;
    held.current.clear();
    target.current = null;
    if (animation.current !== null) cancelAnimationFrame(animation.current);
    animation.current = null;
    lastFrame.current = null;
    if (mounted.current) setMoving(false);
    if (wasMoving && position.current) queueSave(position.current, true);
  }, [queueSave]);

  const stand = useCallback(() => {
    const current = position.current;
    const room = runtime.current.layout;
    if (!current || !room || runtime.current.paused) return;
    interacted.current = true;
    let point = bounded(current.x, current.y, room);
    if (blocked(point.x, point.y, room, runtime.current.obstacles)) {
      const below = bounded(current.x, current.y + 48, room);
      point = blocked(below.x, below.y, room, runtime.current.obstacles) ? spawn(room, runtime.current.obstacles) : below;
    }
    const next = { ...current, ...point, motion: "standing" as const };
    position.current = next;
    setPlayer(next);
    queueSave(next, true);
  }, [queueSave]);

  const animate = useCallback((time: number) => {
    const state = runtime.current;
    const current = position.current;
    if (!current || !state.layout || state.paused || modalVisible() || (held.current.size === 0 && !target.current)) { stopMovement(); return; }
    const dt = Math.min(0.05, lastFrame.current === null ? 1 / 60 : (time - lastFrame.current) / 1000);
    lastFrame.current = time;
    // Held keys win; otherwise head for the tapped point.
    const goal = held.current.size === 0 ? target.current : null;
    const dx = goal ? goal.x - current.x : Number(held.current.has("right")) - Number(held.current.has("left"));
    const dy = goal ? goal.y - current.y : Number(held.current.has("down")) - Number(held.current.has("up"));
    const length = Math.hypot(dx, dy);
    if (goal && length <= speed * dt) {
      // Arrived (or close enough): land on the goal if it is free floor, then stop.
      const landing = bounded(goal.x, goal.y, state.layout);
      if (!blocked(landing.x, landing.y, state.layout, state.obstacles)) {
        const next = { ...current, ...landing, motion: "standing" as const };
        position.current = next;
        setPlayer(next);
      }
      stopMovement();
      return;
    }
    if (length) {
      const stepX = dx / length * speed * dt;
      const stepY = dy / length * speed * dt;
      const candidate = bounded(current.x + stepX, current.y + stepY, state.layout);
      // Resolve each axis separately so a character can slide along furniture.
      const x = blocked(candidate.x, current.y, state.layout, state.obstacles) ? current.x : candidate.x;
      const y = blocked(x, candidate.y, state.layout, state.obstacles) ? current.y : candidate.y;
      const facing: OfficeDirection = Math.abs(dx) >= Math.abs(dy) ? dx > 0 ? "right" : "left" : dy > 0 ? "down" : "up";
      // Blocked (or only creeping along furniture): stop as close as we got.
      if (goal && Math.hypot(x - current.x, y - current.y) < speed * dt * 0.25) { stopMovement(); return; }
      const next = { ...current, x, y, facing, motion: "standing" as const };
      position.current = next;
      setPlayer(next);
      setMoving(x !== current.x || y !== current.y);
      if (x !== current.x || y !== current.y || facing !== current.facing || current.motion !== "standing") queueSave(next);
    } else setMoving(false);
    animation.current = requestAnimationFrame(animateRef.current);
  }, [queueSave, stopMovement]);

  const startDirection = useCallback((direction: OfficeDirection) => {
    if (runtime.current.paused || !position.current || !runtime.current.member || !runtime.current.layout || document.visibilityState !== "visible" || modalVisible()) return;
    interacted.current = true;
    if (position.current.motion === "seated") stand();
    target.current = null;
    held.current.add(direction);
    // Keep a keyboard-operated direction button focused so its keyup can stop us.
    if (animation.current === null) animation.current = requestAnimationFrame(animateRef.current);
  }, [stand]);

  /** Walk toward a room point (tap/click). Same gates as the arrow keys; stands up first if seated. */
  const walkTo = useCallback((point: { x: number; y: number }) => {
    if (runtime.current.paused || !position.current || !runtime.current.member || !runtime.current.layout || document.visibilityState !== "visible" || modalVisible()) return;
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
    interacted.current = true;
    if (position.current.motion === "seated") stand();
    target.current = { x: point.x, y: point.y };
    if (animation.current === null) animation.current = requestAnimationFrame(animateRef.current);
  }, [stand]);

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey || runtime.current.paused) return;
    const direction = keys[event.key] ?? keys[event.key.toLowerCase()];
    if (!direction) return;
    event.preventDefault();
    startDirection(direction);
  }, [startDirection]);

  const onKeyUp = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || runtime.current.paused) return;
    const direction = keys[event.key] ?? keys[event.key.toLowerCase()];
    if (!direction) return;
    event.preventDefault();
    held.current.delete(direction);
    if (!held.current.size) stopMovement();
  }, [stopMovement]);

  const sit = useCallback((item: OfficeItem) => {
    const state = runtime.current;
    if (!position.current || !state.member || !state.layout || state.paused || item.kind !== "desk" || item.member_id !== state.member.id) return;
    // Use the current room's actual item, rather than trusting a stale selection.
    const owned = state.layout.items.find((candidate) => candidate.id === item.id && candidate.kind === "desk" && candidate.member_id === state.member?.id);
    if (!owned) return;
    stopMovement();
    interacted.current = true;
    const next = { ...position.current, ...bounded(owned.x, owned.y + 35, state.layout), facing: "up" as const, motion: "seated" as const };
    position.current = next;
    setPlayer(next);
    queueSave(next, true);
  }, [queueSave, stopMovement]);

  useEffect(() => { flushRef.current = flush; animateRef.current = animate; }, [flush, animate]);
  useEffect(() => {
    const previousSeat = runtime.current.layout?.items.find((item) => item.kind === "desk" && item.member_id === member?.id);
    runtime.current = { member, layout, paused, obstacles };
    if (paused) stopMovement();
    const current = position.current;
    if (!current || !layout || !member || current.member_id !== member.id || current.layout_id !== layout.id) return;
    let next = { ...current, ...bounded(current.x, current.y, layout) };
    if (current.motion === "seated") {
      const seat = layout.items.find((item) => item.kind === "desk" && item.member_id === member.id);
      // A seat release or furniture edit can happen while movement is paused.
      next = seat && (!previousSeat || previousSeat.id === seat.id)
        ? { ...next, ...bounded(seat.x, seat.y + 35, layout), facing: "up" }
        : { ...next, motion: "standing" };
    }
    if (next.motion === "standing" && blocked(next.x, next.y, layout, obstacles)) {
      const below = bounded(next.x, next.y + 48, layout);
      next = { ...next, ...(blocked(below.x, below.y, layout, obstacles) ? spawn(layout, obstacles) : below) };
    }
    if (next.x !== current.x || next.y !== current.y || next.motion !== current.motion || next.facing !== current.facing) {
      position.current = next;
      setPlayer(next);
      queueSave(next, true);
    }
  }, [member, layout, paused, obstacles, stopMovement, queueSave]);

  useEffect(() => {
    mounted.current = true;
    const onBlur = () => stopMovement();
    const onVisibility = () => { if (document.visibilityState !== "visible") stopMovement(); };
    const onFocusOut = (event: FocusEvent) => { if (event.target === viewportRef.current) stopMovement(); };
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      stopMovement();
      mounted.current = false;
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("focusout", onFocusOut);
      if (writeTimer.current) { clearTimeout(writeTimer.current); writeTimer.current = null; }
      void flushRef.current();
    };
  }, [stopMovement, viewportRef]);

  const memberId = member?.id;
  const layoutId = layout?.id;
  useEffect(() => {
    stopMovement();
    const room = runtime.current.layout;
    const key = `${memberId ?? ""}:${layoutId ?? ""}`;
    activeKey.current = key;
    interacted.current = false;
    let cancelled = false;
    let polling = false;
    let initialized = false;
    const initialize = (value: TeamPresence | null) => {
      position.current = value;
      setPlayer(value);
      setPeers([]);
      setSyncError(null);
    };
    if (!memberId || !layoutId || !room) { initialize(null); return; }
    initialize({ member_id: memberId, layout_id: layoutId, ...spawn(room, runtime.current.obstacles), facing: "up", motion: "standing" });
    const poll = async () => {
      if (polling || document.visibilityState !== "visible") return;
      polling = true;
      try {
        const rows = await listTeamPresence();
        if (cancelled || activeKey.current !== key) return;
        setPeers(rows.filter((row) => row.member_id !== memberId && row.layout_id === layoutId));
        if (!initialized && !interacted.current) {
          const mine = rows.find((row) => row.member_id === memberId && row.layout_id === layoutId);
          let next = position.current;
          if (mine) {
            const latestRoom = runtime.current.layout ?? room;
            const ownSeat = latestRoom.items.find((item) => item.kind === "desk" && item.member_id === memberId);
            next = mine.motion === "seated" && ownSeat
              ? { ...mine, ...bounded(ownSeat.x, ownSeat.y + 35, latestRoom), facing: "up" }
              : { ...mine, ...bounded(mine.x, mine.y, latestRoom), motion: "standing" };
            if (next.motion === "standing" && blocked(next.x, next.y, latestRoom, runtime.current.obstacles)) next = { ...next, ...spawn(latestRoom, runtime.current.obstacles) };
          }
          if (next) { position.current = next; setPlayer(next); queueSave(next, true); }
        }
        initialized = true;
      } catch (error) {
        if (!cancelled && activeKey.current === key) setSyncError(message(error));
      } finally { polling = false; }
    };
    void poll();
    const timer = setInterval(() => { void poll(); }, 3000);
    const visible = () => { if (document.visibilityState === "visible") void poll(); };
    document.addEventListener("visibilitychange", visible);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
      stopMovement();
    };
  }, [memberId, layoutId, queueSave, stopMovement]);

  // A room/member prop can change one render before the initialization effect.
  const visiblePlayer = player?.layout_id === layoutId && player?.member_id === memberId ? player : null;
  const visiblePeers = peers.filter((peer) => peer.layout_id === layoutId && peer.member_id !== memberId);
  return { player: visiblePlayer, peers: visiblePeers, moving: Boolean(visiblePlayer) && moving, syncError, onKeyDown, onKeyUp, startDirection, stopMovement, sit, stand, walkTo };
}
