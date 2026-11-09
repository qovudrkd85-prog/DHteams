"use client";

import { useEffect, useId, useRef, useState } from "react";
import { LoaderCircle, RotateCw, Users } from "lucide-react";

import { claimOfficeSeat } from "@/lib/team/presence";
import { pickTeamRoom, withOwnDesk } from "@/lib/team/rooms";
import { useOfficePresence } from "@/lib/team/use-office-presence";
import {
  listOfficeLayouts, officeDateKey, saveOfficeLayout,
  type Attendance, type OfficeLayout, type TeamMember,
} from "@/lib/team/workspace";
import { FurnitureArt } from "./office";
import styles from "./office.module.css";
import { WorldArt } from "./world-art";

interface TeamRoomMiniProps {
  members: TeamMember[];
  attendance: Attendance[];
  currentMember: TeamMember | null;
}

const NO_ROOM = "팀 방이 아직 없어요. 관리자에게 팀 방 준비를 요청해 주세요.";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "팀 방을 불러오지 못했어요.";
}

/** One room per team: a desk per member, sit/stand only. Walking, portals and decorating are not offered here. */
export function TeamRoomMini({ members, attendance, currentMember }: TeamRoomMiniProps) {
  const patternId = useId().replace(/:/g, "");
  const viewportRef = useRef<HTMLDivElement>(null);
  const pendingSit = useRef<string | null>(null);
  const busyRef = useRef(false);
  const [room, setRoom] = useState<OfficeLayout | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const game = useOfficePresence({ member: currentMember, layout: room, paused: busy || loading, viewportRef });

  async function load(): Promise<void> {
    try {
      const next = pickTeamRoom(await listOfficeLayouts());
      setRoom(next);
      setError(next ? null : NO_ROOM);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      if (!active || document.visibilityState !== "visible" || busyRef.current) return;
      try {
        const next = pickTeamRoom(await listOfficeLayouts());
        if (active) setRoom(next);
      } catch { /* Keep the last room; the next tick retries. */ }
    };
    listOfficeLayouts().then((rows) => {
      if (!active) return;
      const next = pickTeamRoom(rows);
      setRoom(next);
      setError(next ? null : NO_ROOM);
    }).catch((reason) => { if (active) setError(errorMessage(reason)); })
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
    setBusy(true);
    setError(null);
    try {
      let layout = room;
      const { draft, deskId } = withOwnDesk(layout, currentMember.id);
      if (draft) layout = await saveOfficeLayout(draft, layout);
      if (layout.items.find((item) => item.id === deskId)?.member_id !== currentMember.id) layout = await claimOfficeSeat(layout.id, deskId);
      pendingSit.current = deskId;
      setRoom(layout);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  const today = officeDateKey();
  const presentIds = new Set(attendance.filter((row) => row.work_date === today && row.checked_in_at && !row.checked_out_at).map((row) => row.member_id));
  const memberById = new Map(members.map((member) => [member.id, member]));
  const onlineIds = new Set([...game.peers.map((row) => row.member_id), ...(game.player && currentMember ? [currentMember.id] : [])]);
  const online = members.filter((member) => onlineIds.has(member.id));
  const seated = game.player?.motion === "seated";
  const width = room?.canvas_width ?? 1000;
  const height = room?.canvas_height ?? 560;
  const desks = room?.items.filter((item) => item.kind === "desk") ?? [];

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
        <div ref={viewportRef} className={`${styles.scene} ${styles[room.theme] ?? ""}`} style={{ padding: "0 8px", background: "transparent" }}>
          <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full rounded-xl" role="img" aria-label={`팀 방. 책상 ${desks.length}개, 접속 ${online.length}명.`}>
            <WorldArt width={width} height={height} kind="office" patternId={patternId} editing={false} />
            {desks.map((item) => {
              const member = item.member_id ? memberById.get(item.member_id) : undefined;
              const presence = member?.id === currentMember?.id ? game.player : game.peers.find((row) => row.member_id === member?.id);
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
          </svg>
        </div>
      ) : null}
      {error && <div className={styles.error} role="alert"><p>{error}</p>{!room && <button type="button" onClick={() => { setLoading(true); void load(); }}><RotateCw size={14} /> 다시 불러오기</button>}</div>}
      {game.syncError && <p className="px-4 pt-2 text-xs text-amber-700" role="status">{game.syncError}</p>}
      <div className="flex gap-2 p-4">
        {seated ? (
          <button type="button" className={styles.quietButton} onClick={() => game.stand()} data-testid="team-room-stand">일어나기</button>
        ) : (
          <button type="button" className={styles.primaryButton} disabled={!room || !currentMember || busy || !game.player} onClick={() => void sitDown()} data-testid="team-room-sit">
            {busy ? <LoaderCircle size={14} className="animate-spin" /> : null} 자리에 앉기
          </button>
        )}
      </div>
    </section>
  );
}
