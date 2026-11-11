"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { LoaderCircle, RotateCw, Users } from "lucide-react";

import { claimOfficeSeat } from "@/lib/team/presence";
import { garageDoor, nearGarageDoor, pickTeamRoom, withOwnDesk } from "@/lib/team/rooms";
import { useOfficePresence } from "@/lib/team/use-office-presence";
import {
  listOfficeLayouts, officeDateKey, saveOfficeLayout,
  type Attendance, type OfficeLayout, type TeamMember, type TeamPresence,
} from "@/lib/team/workspace";
import { WalkingCharacter } from "./character";
import { FurnitureArt } from "./office";
import styles from "./office.module.css";
import { WorldArt } from "./world-art";

interface TeamRoomMiniProps {
  members: TeamMember[];
  attendance: Attendance[];
  currentMember: TeamMember | null;
  /** Called when I go through the door to my garage (button, E/Enter near the door, or a second tap on the door). */
  onEnterGarage?: () => void;
}

// The room is ~1600 units wide but shown ~340px wide: draw characters larger so they stay readable.
const CHARACTER_SCALE = 1.8;
const NO_ROOM = "팀 방이 아직 없어요. 관리자에게 팀 방 준비를 요청해 주세요.";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "팀 방을 불러오지 못했어요.";
}

function GarageDoorArt({ x, y, near, onClick }: { x: number; y: number; near: boolean; onClick: (event: MouseEvent<SVGGElement>) => void }) {
  return (
    <g transform={`translate(${x} ${y})`} className={styles.portal} onClick={onClick} data-testid="team-room-door" data-x={x} data-y={y} data-near={near}>
      <rect x="-130" y="-45" width="260" height="150" fill="transparent" pointerEvents="all" />
      <ellipse cy="3" rx="95" ry="36" fill={near ? "#dcefa170" : "#70998730"} stroke="#5d927b" strokeWidth="3" strokeDasharray="8 8" />
      <rect x="-125" y="42" width="250" height="56" rx="28" fill="#fffdf1" stroke="#c2cfb9" strokeWidth="2" />
      <text y="82" textAnchor="middle" fontSize="38" fontWeight="600" fill="#466450">내 정비실 ↗</text>
    </g>
  );
}

/** One room per team: a desk per member. Walk by tapping the floor or with arrow keys; the only door leads to my garage. */
export function TeamRoomMini({ members, attendance, currentMember, onEnterGarage }: TeamRoomMiniProps) {
  const patternId = useId().replace(/:/g, "");
  const viewportRef = useRef<HTMLDivElement>(null);
  const pendingSit = useRef<string | null>(null);
  const busyRef = useRef(false);
  const [room, setRoom] = useState<OfficeLayout | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // Bumped by every load and mutation; a response from an older generation is dropped.
  const generation = useRef(0);
  const game = useOfficePresence({ member: currentMember, layout: room, paused: busy || loading, viewportRef });

  async function load(): Promise<void> {
    const ticket = ++generation.current;
    try {
      const next = pickTeamRoom(await listOfficeLayouts());
      if (ticket !== generation.current) return;
      setRoom(next);
      setLoadError(next ? null : NO_ROOM);
    } catch (reason) {
      if (ticket === generation.current) setLoadError(errorMessage(reason));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      if (!active || document.visibilityState !== "visible" || busyRef.current) return;
      const ticket = ++generation.current;
      try {
        const next = pickTeamRoom(await listOfficeLayouts());
        if (!active || ticket !== generation.current || busyRef.current) return;
        setRoom(next);
        setLoadError(next ? null : NO_ROOM);
      } catch (reason) {
        // Keep the last room on screen; show the sync problem until a later tick succeeds.
        if (active && ticket === generation.current) setLoadError(errorMessage(reason));
      }
    };
    const first = ++generation.current;
    listOfficeLayouts().then((rows) => {
      if (!active || first !== generation.current) return;
      const next = pickTeamRoom(rows);
      setRoom(next);
      setLoadError(next ? null : NO_ROOM);
    }).catch((reason) => { if (active && first === generation.current) setLoadError(errorMessage(reason)); })
      .finally(() => { if (active) setLoading(false); });
    const timer = window.setInterval(() => { void refresh(); }, 3_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  // Sit only after the hook has seen the layout that holds the claimed desk.
  useEffect(() => {
    const deskId = pendingSit.current;
    if (!deskId || !room || !currentMember) return;
    const desk = room.items.find((item) => item.id === deskId && item.member_id === currentMember.id);
    if (!desk) return;
    pendingSit.current = null;
    game.sit(desk);
  }, [room, currentMember, game]);

  async function sitDown(): Promise<void> {
    if (!room || !currentMember || busy) return;
    busyRef.current = true;
    generation.current++; // Drop any refresh already in flight.
    setBusy(true);
    setActionError(null);
    let layout = room;
    try {
      const { draft, deskId } = withOwnDesk(layout, currentMember.id);
      if (draft) layout = await saveOfficeLayout(draft, layout);
      if (layout.items.find((item) => item.id === deskId)?.member_id !== currentMember.id) layout = await claimOfficeSeat(layout.id, deskId);
      generation.current++;
      pendingSit.current = deskId;
      setRoom(layout);
    } catch (reason) {
      // Keep a desk that was already saved so a retry reuses it instead of hitting a stale-version conflict.
      generation.current++;
      if (layout !== room) setRoom(layout);
      setActionError(errorMessage(reason));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  const today = officeDateKey();
  const presentIds = new Set(attendance.filter((row) => row.work_date === today && row.checked_in_at && !row.checked_out_at).map((row) => row.member_id));
  const memberById = new Map(members.map((member) => [member.id, member]));
  // Presence rows are never cleared, so only count peers who are also checked in today.
  const livePeers = game.peers.filter((row) => presentIds.has(row.member_id));
  const onlineIds = new Set([...livePeers.map((row) => row.member_id), ...(game.player && currentMember ? [currentMember.id] : [])]);
  const online = members.filter((member) => onlineIds.has(member.id));
  const seated = game.player?.motion === "seated";
  const width = room?.canvas_width ?? 1000;
  const height = room?.canvas_height ?? 560;
  const desks = room?.items.filter((item) => item.kind === "desk") ?? [];
  // Status bubbles are clamped for an unscaled room, so the scaled mini characters go without them.
  const walker = (member: TeamMember, presence: TeamPresence, own: boolean) => (
    <g key={presence.member_id} transform={`translate(${presence.x} ${presence.y}) scale(${CHARACTER_SCALE}) translate(${-presence.x} ${-presence.y})`}
      data-testid={own ? "team-room-me" : `team-room-walker-${member.id}`} data-x={presence.x} data-y={presence.y}>
      <WalkingCharacter member={{ ...member, status_message: undefined }} presence={presence} roomWidth={width} own={own} moving={own && game.moving} working={presentIds.has(member.id)} />
    </g>
  );
  const standingPeers = livePeers.filter((row) => row.motion !== "seated").sort((a, b) => a.y - b.y);

  function walkHere(event: MouseEvent<SVGSVGElement>): void {
    const ctm = event.currentTarget.getScreenCTM();
    if (!ctm || ctm.a === 0 || ctm.d === 0) return;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(ctm.inverse());
    viewportRef.current?.focus({ preventScroll: true });
    game.walkTo({ x: point.x, y: point.y });
  }

  const door = room ? garageDoor(room) : null;
  const nearDoor = Boolean(onEnterGarage && door && game.player && !seated && nearGarageDoor(game.player, door));

  function focusRoom(): void {
    viewportRef.current?.focus({ preventScroll: true });
  }

  function toggleSeat(): void {
    if (seated) { game.stand(); return; }
    if (!busyRef.current && game.player) void sitDown();
  }

  function onDoorClick(event: MouseEvent<SVGGElement>): void {
    event.stopPropagation();
    focusRoom();
    if (nearDoor) onEnterGarage?.();
    else if (door) game.walkTo(door);
  }

  // Shortcuts only while the room itself has focus (no inputs live inside it). event.code keeps E/F working under a Korean IME.
  function onRoomKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === "Escape" && event.target === event.currentTarget) { event.currentTarget.blur(); return; }
    if (event.target === event.currentTarget && !event.altKey && !event.ctrlKey && !event.metaKey) {
      if (event.code === "KeyF") {
        event.preventDefault();
        if (!event.repeat) toggleSeat();
        return;
      }
      if (nearDoor && (event.code === "KeyE" || event.key === "Enter")) {
        event.preventDefault();
        if (!event.repeat) onEnterGarage?.();
        return;
      }
    }
    game.onKeyDown(event);
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" aria-label="팀 방" data-testid="team-room">
      <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
        <Users className="size-4 text-teal-700" />
        <h2 className="font-semibold text-slate-900">팀 방</h2>
        <span className="ml-auto rounded-full bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-700" data-testid="team-room-online-count">{online.length}명 접속</span>
      </div>
      <div className="flex min-h-9 flex-wrap gap-1.5 px-4 py-2" aria-label="지금 접속한 팀원" data-testid="team-room-online">
        {online.length ? online.map((member) => (
          <span key={member.id} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700" data-member-id={member.id}>{member.avatar} {member.name}{member.id === currentMember?.id ? " · 나" : ""}</span>
        )) : <span className="text-xs text-slate-400">아직 아무도 들어오지 않았어요.</span>}
      </div>
      {loading ? (
        <div className="flex items-center justify-center gap-2 p-8 text-sm text-slate-500"><LoaderCircle className="size-4 animate-spin" /> 팀 방을 준비하고 있어요.</div>
      ) : room ? (
        <div ref={viewportRef} className={`${styles.scene} ${styles[room.theme] ?? ""} rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-teal-500`} style={{ padding: "0 8px", background: "transparent" }}
          tabIndex={0} role="group" aria-label="팀 방. 방향키로 걷기, F 앉기, 입구 근처에서 E 들어가기" data-testid="team-room-view" onKeyDown={onRoomKeyDown} onKeyUp={game.onKeyUp}>
          <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full cursor-pointer rounded-xl" role="img" onClick={walkHere} aria-label={`팀 방. 책상 ${desks.length}개, 접속 ${online.length}명.`}>
            <WorldArt width={width} height={height} kind="office" patternId={patternId} editing={false} />
            {door && onEnterGarage && <GarageDoorArt x={door.x} y={door.y} near={nearDoor} onClick={onDoorClick} />}
            {desks.map((item) => {
              const member = item.member_id ? memberById.get(item.member_id) : undefined;
              const presence = member?.id === currentMember?.id ? game.player : livePeers.find((row) => row.member_id === member?.id);
              const isSeated = Boolean(member && presence?.motion === "seated");
              const own = Boolean(member && member.id === currentMember?.id);
              const label = member?.name ?? (item.member_id ? "등록 해제된 팀원" : "빈 자리");
              return (
                <g key={item.id} transform={`translate(${item.x} ${item.y})`} data-testid={`team-desk-${item.id}`} data-member-id={item.member_id ?? ""} data-seated={isSeated}>
                  <g transform={`rotate(${item.rotation})`}><FurnitureArt item={item} member={member} present={isSeated} /></g>
                  <text y="104" textAnchor="middle" fontSize="38" fontWeight={own ? 700 : 500} fill={member && presentIds.has(member.id) ? "#355d4d" : "#81877d"}>
                    {member && presentIds.has(member.id) ? "● " : member ? "○ " : ""}{label.length > 6 ? `${label.slice(0, 5)}…` : label}{own ? " · 나" : ""}
                  </text>
                </g>
              );
            })}
            {standingPeers.map((row) => {
              const member = memberById.get(row.member_id);
              return member ? walker(member, row, false) : null;
            })}
            {currentMember && game.player && !seated && walker(currentMember, game.player, true)}
          </svg>
        </div>
      ) : null}
      {(actionError ?? loadError) && <div className={styles.error} role="alert"><p>{actionError ?? loadError}</p>{!room && <button type="button" onClick={() => { setLoading(true); void load(); }}><RotateCw size={14} /> 다시 불러오기</button>}</div>}
      {game.syncError && <p className="px-4 pt-2 text-xs text-amber-700" role="status">{game.syncError}</p>}
      {room && <p className="px-4 pt-3 text-xs text-slate-400">방을 누르거나 방향키로 걸어요<span className="hidden sm:inline"> · F 앉기{onEnterGarage ? " · E 들어가기" : ""}</span>.</p>}
      <div className="flex flex-wrap gap-2 p-4">
        {seated ? (
          <button type="button" className={styles.quietButton} aria-keyshortcuts="F" onClick={() => { game.stand(); focusRoom(); }} data-testid="team-room-stand">일어나기<span className="hidden sm:inline"> (F)</span></button>
        ) : (
          <button type="button" className={styles.primaryButton} aria-keyshortcuts="F" disabled={!room || !currentMember || busy || !game.player} onClick={() => { focusRoom(); void sitDown(); }} data-testid="team-room-sit">
            {busy ? <LoaderCircle size={14} className="animate-spin" /> : null} 자리에 앉기<span className="hidden sm:inline"> (F)</span>
          </button>
        )}
        {nearDoor && (
          <button type="button" className={styles.primaryButton} aria-keyshortcuts="E Enter" onClick={() => onEnterGarage?.()} data-testid="team-room-enter">
            들어가기<span className="hidden sm:inline"> (E)</span>
          </button>
        )}
      </div>
    </section>
  );
}
