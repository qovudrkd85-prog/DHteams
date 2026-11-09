"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import {
  Armchair, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, Coffee,
  LayoutGrid, Leaf, LoaderCircle, Monitor, MousePointer2, Pencil,
  Plus, RotateCw, Save, Sparkles, Trash2, Users, X,
} from "lucide-react";
import { toast } from "sonner";
import {
  deleteOfficeLayout, listOfficeLayouts, officeDateKey, saveOfficeLayout,
  OFFICE_HEIGHT, OFFICE_WIDTH,
  type Attendance, type OfficeItem, type OfficeLayout, type TeamMember, type OfficeDraft,
} from "@/lib/team/workspace";
import { claimOfficeSeat } from "@/lib/team/presence";
import { useOfficePresence } from "@/lib/team/use-office-presence";
import { roomPortals } from "@/lib/team/world";
import { WalkingCharacter, StatusBubble } from "./character";
import { WorldArt, WorldPortals } from "./world-art";
import styles from "./office.module.css";
import { HealingOverlay } from "./healing/healing-overlay";

type Draft = OfficeDraft;
type Props = {
  members: TeamMember[];
  attendance: Attendance[];
  currentMember: TeamMember | null;
  loading?: boolean;
  onRegister: () => void;
};
type PendingAction = { kind: "switch"; id: string } | { kind: "new" | "reload" | "cancel" | "delete" };

const WIDTH = OFFICE_WIDTH;
const HEIGHT = OFFICE_HEIGHT;
const LAYOUT_KEY = "teams-office-layout";
const FURNITURE = {
  desk: { name: "책상", icon: Monitor, width: 140, height: 136 },
  table: { name: "회의 테이블", icon: Coffee, width: 200, height: 140 },
  plant: { name: "초록 식물", icon: Leaf, width: 76, height: 80 },
  sofa: { name: "소파", icon: Armchair, width: 184, height: 108 },
  board: { name: "보드", icon: LayoutGrid, width: 144, height: 84 },
} as const;
const THEMES = [{ id: "sage", name: "그린 가든", color: "#dce9dd" }, { id: "sand", name: "샌드 라운지", color: "#efdfc7" }, { id: "sky", name: "블루 스카이", color: "#dce8f4" }] as const;

function starter(): Draft {
  const objects: [OfficeItem["kind"], number, number][] = [
    ["desk", 235, 195], ["desk", 420, 195], ["desk", 235, 385], ["desk", 420, 385],
    ["table", 720, 235], ["sofa", 745, 425], ["plant", 80, 100],
    ["plant", 922, 445], ["board", 725, 90],
  ];
  return {
    name: "우리 팀 오피스", theme: "sage",
    items: objects.map(([kind, x, y], index) => ({
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      kind, x, y, rotation: 0, label: "", member_id: null,
    })),
  };
}

function toDraft(layout: OfficeLayout): Draft {
  return { name: layout.name, theme: layout.theme, canvas_width: layout.canvas_width ?? WIDTH, canvas_height: layout.canvas_height ?? HEIGHT, room_kind: layout.room_kind ?? "office", items: layout.items.map((item) => ({ ...item })) };
}

function preferredLayout(layouts: OfficeLayout[], currentId?: string): OfficeLayout | null {
  let preferred = currentId;
  if (!preferred) {
    try { preferred = localStorage.getItem(LAYOUT_KEY) ?? undefined; } catch { /* A saved layout is still available without browser storage. */ }
  }
  return layouts.find((layout) => layout.id === preferred) ?? layouts[0] ?? null;
}

function boundPosition(item: OfficeItem, x: number, y: number, rotation: OfficeItem["rotation"], width: number, height: number) {
  const size = FURNITURE[item.kind];
  const turned = rotation === 90 || rotation === 270;
  const halfWidth = (turned ? size.height : size.width) / 2;
  const halfHeight = (turned ? size.width : size.height) / 2;
  return {
    x: Math.max(32 + halfWidth, Math.min(width - 32 - halfWidth, Math.round(x / 10) * 10)),
    y: Math.max(45 + halfHeight, Math.min(height - 66 - halfHeight, Math.round(y / 10) * 10)),
  };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "배치도를 처리하지 못했어요. 잠시 후 다시 시도해 주세요.";
}

function FurnitureArt({ item, member, present }: { item: OfficeItem; member?: TeamMember; present: boolean }) {
  const characterSeed = member ? Array.from(member.avatar + member.name).reduce((sum, char) => sum + (char.codePointAt(0) ?? 0), 0) : 0;
  const skin = ["#efc8a6", "#ddb18f", "#bc896b", "#f2d6bd"][characterSeed % 4];
  const hair = ["#4f4038", "#76604b", "#353d3b", "#916647"][Math.floor(characterSeed / 3) % 4];
  if (item.kind === "plant") return (
    <g>
      <ellipse cy="24" rx="26" ry="11" fill="#294f3420" />
      <path d="M-17 9h34l-4 26h-26z" fill="#d59f77" stroke="#bf8b65" strokeWidth="2" />
      <ellipse cy="10" rx="18" ry="7" fill="#a47454" />
      <path d="M0 11V-20M0-1l-18-14M0-8l16-18" stroke="#567858" strokeWidth="3" />
      <ellipse cx="-15" cy="-14" rx="11" ry="21" transform="rotate(-43 -15 -14)" fill="#75987b" />
      <ellipse cx="15" cy="-21" rx="10" ry="20" transform="rotate(38 15 -21)" fill="#547a5d" />
      <ellipse cx="-1" cy="-26" rx="10" ry="19" transform="rotate(-6 -1 -26)" fill="#8daa80" />
      <path d="M-21-23l14 16M18-31l-10 20M0-38v24" stroke="#ffffff45" strokeWidth="1.5" />
    </g>
  );
  if (item.kind === "table") return (
    <g>
      {[-57, 57].map((x) => <g key={x}><rect x={x - 19} y="-64" width="38" height="31" rx="10" fill="#8ba6a1" stroke="#708f88" strokeWidth="2" /><rect x={x - 19} y="35" width="38" height="31" rx="10" fill="#8ba6a1" stroke="#708f88" strokeWidth="2" /></g>)}
      <rect x="-99" y="-42" width="198" height="94" rx="38" fill="#334d3e16" />
      <rect x="-96" y="-47" width="192" height="92" rx="38" fill="#c49c73" />
      <rect x="-96" y="-52" width="192" height="92" rx="38" fill="#e8cba4" stroke="#cdaa80" strokeWidth="2" />
      <path d="M-71-34H63M-63 22H69" stroke="#d8b58d" strokeWidth="1.5" />
      <rect x="-44" y="-21" width="37" height="27" rx="3" fill="#fcfaf4" transform="rotate(-8 -44 -21)" />
      <path d="M-38-13h23M-38-6h15" stroke="#aabbb7" strokeWidth="2" />
      <rect x="15" y="-13" width="30" height="22" rx="3" fill="#85a49b" transform="rotate(9 15 -13)" />
      <circle cx="-60" cy="10" r="9" fill="#f7f4ec" /><circle cx="-60" cy="10" r="5" fill="#876c55" />
      <circle cx="59" cy="-19" r="8" fill="#f7f4ec" /><circle cx="59" cy="-19" r="4" fill="#876c55" />
    </g>
  );
  if (item.kind === "sofa") return (
    <g>
      <rect x="-87" y="-38" width="174" height="88" rx="20" fill="#2a493521" />
      <rect x="-87" y="-47" width="174" height="86" rx="18" fill="#66857a" stroke="#557265" strokeWidth="2" />
      <rect x="-72" y="-27" width="69" height="54" rx="10" fill="#98b0a0" stroke="#7b9889" strokeWidth="2" />
      <rect x="3" y="-27" width="69" height="54" rx="10" fill="#98b0a0" stroke="#7b9889" strokeWidth="2" />
      <rect x="-86" y="-32" width="20" height="64" rx="9" fill="#789487" />
      <rect x="66" y="-32" width="20" height="64" rx="9" fill="#789487" />
      <rect x="-58" y="-18" width="31" height="30" rx="6" fill="#e5cd9e" transform="rotate(-13 -44 -3)" />
      <rect x="27" y="-18" width="31" height="30" rx="6" fill="#d8e2cb" transform="rotate(13 42 -3)" />
    </g>
  );
  if (item.kind === "board") return (
    <g>
      <path d="M-54 28v12M54 28v12" stroke="#9b9e91" strokeWidth="7" strokeLinecap="round" />
      <rect x="-69" y="-37" width="138" height="72" rx="7" fill="#b6b7a6" />
      <rect x="-65" y="-37" width="130" height="64" rx="5" fill="#fafbf3" stroke="#bdc4b4" strokeWidth="3" />
      <rect x="-49" y="-22" width="24" height="21" rx="2" fill="#e4c686" transform="rotate(-5 -38 -10)" />
      <rect x="-11" y="-21" width="23" height="21" rx="2" fill="#a7c3b3" />
      <rect x="26" y="-22" width="24" height="21" rx="2" fill="#d7b2a3" transform="rotate(5 38 -10)" />
      <path d="M-46 10h29M-6 10h19M27 10h20" stroke="#b5c4b6" strokeWidth="3" strokeLinecap="round" />
    </g>
  );
  return (
    <g>
      <path d="M-54-4v31M54-4v31" stroke="#977451" strokeWidth="7" strokeLinecap="round" />
      <ellipse cy="43" rx="29" ry="19" fill="#243c3920" />
      <path d="M0 35v22M0 51l-21 6M0 51l21 6" stroke="#60736d" strokeWidth="4" strokeLinecap="round" />
      <rect x="-23" y="7" width="46" height="43" rx="15" fill={present ? "#6c8c84" : "#adb6ad"} stroke={present ? "#54776e" : "#949f94"} strokeWidth="2" />
      <path d="M-27 20v19M27 20v19" stroke="#71857d" strokeWidth="5" strokeLinecap="round" />
      <rect x="-64" y="-53" width="128" height="69" rx="8" fill="#b58c63" />
      <rect x="-64" y="-59" width="128" height="68" rx="8" fill="#e6c39b" stroke="#c6a27b" strokeWidth="2" />
      <path d="M-52-46h105M-52-39h21M29-5h22" stroke="#d9b58d" strokeWidth="1.4" />
      <rect x="-27" y="-52" width="54" height="31" rx="4" fill="#526b68" />
      <rect x="-23" y="-48" width="46" height="22" rx="2" fill={present ? "#c1dfd7" : "#8faaa3"} />
      {present && <g stroke="#f4faf3" strokeWidth="2" strokeLinecap="round"><path d="M-16-41h10M-16-36h23M-16-31h16" /><path d="M13-42h4v10h-4" fill="#88b8aa" strokeWidth="1" /></g>}
      <path d="M-2-22v5M-11-16h22" stroke="#526b68" strokeWidth="3" strokeLinecap="round" />
      <rect x="-22" y="-10" width="44" height="9" rx="3" fill="#f3eee0" />
      <path d="M-16-7h32M-13-4h25" stroke="#cfcebd" strokeWidth="1.3" />
      <rect x="-50" y="-23" width="17" height="22" rx="2" fill="#f8f6eb" transform="rotate(-8 -42 -12)" />
      <circle cx="45" cy="-17" r="8" fill="#f8f6eb" /><circle cx="45" cy="-17" r="4.5" fill="#967c61" />
      {member && present && <g className={styles.person} data-testid={`office-character-${member.id}`}>
        <ellipse cy="54" rx="21" ry="10" fill="#32443c20" />
        <path d="M-13 40l1 15M13 40l-1 15" stroke="#55616c" strokeWidth="12" strokeLinecap="round" />
        <ellipse cx="-11" cy="58" rx="9" ry="5" fill="#3f4a49" /><ellipse cx="11" cy="58" rx="9" ry="5" fill="#3f4a49" />
        <path d="M-19 25Q-26 20-27 3M19 25Q26 20 27 3" fill="none" stroke={member.color} strokeWidth="11" strokeLinecap="round" />
        <ellipse cx="-27" cy="1" rx="5" ry="6" fill={skin} transform="rotate(-15 -27 1)" /><ellipse cx="27" cy="1" rx="5" ry="6" fill={skin} transform="rotate(15 27 1)" />
        <path d="M-19 25c0-12 38-12 38 0l2 20c-11 6-31 6-42 0z" fill={member.color} stroke="#344b4828" strokeWidth="1.5" />
        <path d="M-13 40q13 5 26 0" stroke="#ffffff25" strokeWidth="2" fill="none" />
        <rect x="-6" y="14" width="12" height="12" rx="5" fill={skin} />
        <path d="M-8 23q8 7 16 0" stroke="#ffffffa0" strokeWidth="2" fill="none" />
        {characterSeed % 3 === 0 && <ellipse cx="15" cy="8" rx="9" ry="18" fill={hair} transform="rotate(-15 15 8)" />}
        <ellipse cy="4" rx="20" ry="22" fill={hair} />
        <circle cx="-18" cy="7" r="4" fill={skin} /><circle cx="18" cy="7" r="4" fill={skin} />
        <path d="M-17-3q17-14 34 0v12c0 11-9 17-17 17s-17-6-17-17z" fill={skin} />
        <path d={characterSeed % 2 ? "M-19 3q-4-26 20-22 22 1 19 24L13-8Q0 2-12-6z" : "M-19 3q-4-27 21-23 24 3 17 25L11-8 4-1-3-9-13-5z"} fill={hair} />
        <path d="M-11-11q8-7 16-5" stroke="#ffffff23" strokeWidth="2.5" fill="none" strokeLinecap="round" />
        <ellipse cx="-7" cy="7" rx="2" ry="2.7" fill="#483f38" /><ellipse cx="7" cy="7" rx="2" ry="2.7" fill="#483f38" />
        <circle cx="-7.5" cy="6.3" r=".65" fill="#fff8ee" /><circle cx="6.5" cy="6.3" r=".65" fill="#fff8ee" />
        <ellipse cx="-11" cy="12" rx="3.5" ry="2" fill="#d3867860" /><ellipse cx="11" cy="12" rx="3.5" ry="2" fill="#d3867860" />
        <path d="M-4 15q4 4 8 0" stroke="#aa7260" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        {characterSeed % 4 === 1 && <g fill="none" stroke="#525454" strokeWidth="1.4"><rect x="-14" y="3" width="11" height="9" rx="3" /><rect x="3" y="3" width="11" height="9" rx="3" /><path d="M-3 6h6" /></g>}
        <circle cy="36" r="5" fill="#ffffff30" /><text y="39" textAnchor="middle" fontSize="8" fontWeight="600" fill="#fffdf5">{Array.from(member.name)[0]}</text>
        <circle cx="25" cy="-15" r="6" fill="#55a780" stroke="#f6fbf5" strokeWidth="2" />
      </g>}
    </g>
  );
}

export function TeamOffice({ members, attendance, currentMember, loading: membersLoading = false, onRegister }: Props) {
  const patternId = useId().replace(/:/g, "");
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ pointer: number; item: OfficeItem; x: number; y: number } | null>(null);
  const [layouts, setLayouts] = useState<OfficeLayout[]>([]);
  const [healingOpen, setHealingOpen] = useState(false);
  const [original, setOriginal] = useState<OfficeLayout | null>(null);
  const [draft, setDraft] = useState<Draft>(starter);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [today, setToday] = useState(() => officeDateKey());
  const [announcement, setAnnouncement] = useState("");
  const [seatError, setSeatError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(.85);
  const viewportRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<{ pointer: number; x: number; y: number; left: number; top: number } | null>(null);
  const width = draft.canvas_width ?? WIDTH;
  const height = draft.canvas_height ?? HEIGHT;
  const obstacles = useMemo(() => {
    if (original?.room_kind === "outdoor") return [
      ...roomPortals(original, layouts).map((portal) => ({ x: portal.x - 130, y: portal.y - 235, width: 260, height: 218 })),
      { x: (original.canvas_width ?? WIDTH) / 2 + 155, y: 735, width: 150, height: 70 },
    ];
    if (original?.room_kind === "cafe") return [{ x: (original.canvas_width ?? WIDTH) - 430, y: 100, width: 320, height: 145 }];
    return [];
  }, [original, layouts]);
  const game = useOfficePresence({ member: currentMember, layout: original, paused: editing || busy || loading || Boolean(pending || loadError), viewportRef, obstacles });
  const dirty = editing && (!original || JSON.stringify(draft) !== JSON.stringify(toDraft(original)));
  const selected = draft.items.find((item) => item.id === selectedId);
  const memberById = new Map(members.map((member) => [member.id, member]));
  const presentIds = new Set(attendance.filter((row) => row.work_date === today && row.checked_in_at && !row.checked_out_at).map((row) => row.member_id));
  const presentMembers = members.filter((member) => presentIds.has(member.id));
  const seatedIds = new Set(draft.items.filter((item) => item.kind === "desk" && item.member_id).map((item) => item.member_id));
  const unseated = members.filter((member) => !seatedIds.has(member.id));
  const desks = draft.items.filter((item) => item.kind === "desk");
  const nearPortal = game.player && roomPortals(original, layouts).find((portal) => Math.hypot(portal.x - game.player!.x, portal.y - game.player!.y) < 115);
  const ownSeat = desks.find((desk) => desk.member_id === currentMember?.id);
  function clampPosition(item: OfficeItem, x: number, y: number, rotation = item.rotation) {
    return boundPosition(item, x, y, rotation, width, height);
  }
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !game.player || editing) return;
    const x = game.player.x * zoom;
    const y = game.player.y * zoom;
    const edgeX = Math.min(180, viewport.clientWidth / 3);
    const edgeY = Math.min(190, viewport.clientHeight / 3);
    if (x < viewport.scrollLeft + edgeX || x > viewport.scrollLeft + viewport.clientWidth - edgeX) viewport.scrollLeft = x - viewport.clientWidth / 2;
    if (y < viewport.scrollTop + edgeY || y > viewport.scrollTop + viewport.clientHeight - 90) viewport.scrollTop = y - viewport.clientHeight / 2;
  }, [game.player, zoom, editing]);

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const rows = await listOfficeLayouts();
      const layout = preferredLayout(rows, original?.id);
      setLayouts(rows);
      setOriginal(layout);
      setDraft(layout ? toDraft(layout) : starter());
      setEditing(false);
      setSelectedId(null);
      setSaveError(null);
      setSyncError(null);
    } catch (error) {
      setLoadError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [original]);

  useEffect(() => {
    let active = true;
    listOfficeLayouts().then((rows) => {
      if (!active) return;
      const layout = preferredLayout(rows);
      setLayouts(rows);
      setOriginal(layout);
      setDraft(layout ? toDraft(layout) : starter());
    }).catch((error) => {
      if (active) setLoadError(errorMessage(error));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!original) return;
    try { localStorage.setItem(LAYOUT_KEY, original.id); } catch { /* Layout selection can remain session-only. */ }
  }, [original]);
  useEffect(() => {
    // Editing pauses background reads so remote changes cannot replace a local draft.
    if (editing || busy || loading || loadError) return;
    let active = true;
    let refreshing = false;
    const refresh = async () => {
      if (document.visibilityState !== "visible" || refreshing) return;
      refreshing = true;
      try {
        const rows = await listOfficeLayouts();
        if (!active) return;
        const layout = preferredLayout(rows, original?.id);
        setLayouts(rows);
        setOriginal(layout);
        setDraft(layout ? toDraft(layout) : starter());
        setSyncError(null);
      } catch (error) {
        if (active) setSyncError(errorMessage(error));
      } finally { refreshing = false; }
    };
    const onVisible = () => { void refresh(); };
    const interval = window.setInterval(onVisible, 3_000);
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [editing, busy, loading, loadError, original?.id]);
  useEffect(() => {
    const updateDay = () => setToday(officeDateKey());
    const interval = window.setInterval(updateDay, 30_000);
    window.addEventListener("focus", updateDay);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", updateDay);
    };
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);

  function patchItem(id: string, patch: Partial<OfficeItem>) {
    if (!editing || busy) return;
    setDraft((current) => ({ ...current, items: current.items.map((item) => item.id === id ? { ...item, ...patch } : item) }));
  }

  function addItem(kind: OfficeItem["kind"]) {
    if (!editing || busy) return;
    if (draft.items.length >= 100) { toast.error("한 배치도에는 가구를 100개까지 놓을 수 있어요."); return; }
    const offset = (draft.items.length % 6) * 20;
    const item: OfficeItem = { id: crypto.randomUUID(), kind, x: 460 + offset, y: 260 + offset, rotation: 0, label: "", member_id: null };
    setDraft((current) => ({ ...current, items: [...current.items, item] }));
    setSelectedId(item.id);
    setAnnouncement(`${FURNITURE[kind].name}을 추가했어요. 드래그하거나 방향키로 옮겨 주세요.`);
  }

  function moveSelected(dx: number, dy: number) {
    if (!selected) return;
    patchItem(selected.id, clampPosition(selected, selected.x + dx, selected.y + dy));
  }

  function rotateSelected() {
    if (!selected) return;
    const rotation = ((selected.rotation + 90) % 360) as OfficeItem["rotation"];
    patchItem(selected.id, { rotation, ...clampPosition(selected, selected.x, selected.y, rotation) });
  }

  function removeSelected() {
    if (!selected || busy || selected.member_id) return;
    setDraft((current) => ({ ...current, items: current.items.filter((item) => item.id !== selected.id) }));
    setSelectedId(null);
    setAnnouncement("가구를 배치도에서 뺐어요. 저장하면 반영됩니다.");
  }

  function svgPoint(event: PointerEvent<SVGGElement>) {
    const matrix = svgRef.current?.getScreenCTM();
    if (!matrix) return null;
    return new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
  }

  function startDrag(event: PointerEvent<SVGGElement>, item: OfficeItem) {
    if (event.button !== 0 || busy) return;
    event.stopPropagation();
    game.stopMovement();
    event.currentTarget.focus();
    setSelectedId(item.id);
    if (!editing) return;
    const point = svgPoint(event);
    if (!point) return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointer: event.pointerId, item, x: point.x, y: point.y };
  }

  function moveDrag(event: PointerEvent<SVGGElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointer !== event.pointerId || !editing || busy) return;
    const point = svgPoint(event);
    if (!point) return;
    patchItem(drag.item.id, clampPosition(drag.item, drag.item.x + point.x - drag.x, drag.item.y + point.y - drag.y));
  }

  function endDrag(event: PointerEvent<SVGGElement>) {
    if (dragRef.current?.pointer !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function itemKeyDown(event: KeyboardEvent<SVGGElement>, item: OfficeItem) {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedId(item.id); return; }
    if (!editing || busy) return;
    const steps: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (steps[event.key]) {
      event.preventDefault();
      const [x, y] = steps[event.key];
      const step = event.shiftKey ? 30 : 10;
      patchItem(item.id, clampPosition(item, item.x + x * step, item.y + y * step));
    } else if (event.key.toLowerCase() === "r") {
      event.preventDefault();
      const rotation = ((item.rotation + 90) % 360) as OfficeItem["rotation"];
      patchItem(item.id, { rotation, ...clampPosition(item, item.x, item.y, rotation) });
    } else if (event.key === "Escape") setSelectedId(null);
  }

  async function save() {
    if (busy || !editing) return;
    if (!draft.name.trim()) { toast.error("배치도 이름을 입력해 주세요."); return; }
    setBusy(true);
    setSaveError(null);
    try {
      const saved = await saveOfficeLayout({ ...draft, name: draft.name.trim() }, original ?? undefined);
      setLayouts((current) => original ? current.map((layout) => layout.id === saved.id ? saved : layout) : [...current, saved]);
      setOriginal(saved);
      setDraft(toDraft(saved));
      setEditing(false);
      setPending(null);
      setSyncError(null);
      setAnnouncement("배치도를 저장했어요. 팀원 모두에게 이 공간이 보여요.");
      toast.success("우리 팀의 공간을 저장했어요.");
    } catch (error) { setSaveError(errorMessage(error)); }
    finally { setBusy(false); }
  }

  async function perform(action: PendingAction) {
    setPending(null);
    if (action.kind === "delete") {
      if (!original) return;
      setBusy(true);
      try {
        await deleteOfficeLayout(original);
        const remaining = layouts.filter((layout) => layout.id !== original.id);
        setLayouts(remaining);
        setOriginal(remaining[0] ?? null);
        setDraft(remaining[0] ? toDraft(remaining[0]) : starter());
        setEditing(false);
        setSelectedId(null);
        setSaveError(null);
        toast.success("배치도를 삭제했어요.");
      } catch (error) { setSaveError(errorMessage(error)); }
      finally { setBusy(false); }
      return;
    }
    setSaveError(null);
    setSelectedId(null);
    if (action.kind === "reload") { await reload(); return; }
    if (action.kind === "new") {
      setOriginal(null);
      setDraft({ name: `새 오피스 ${layouts.length + 1}`, theme: draft.theme, canvas_width: 1600, canvas_height: 900, room_kind: "office", items: [] });
      setEditing(true);
    } else if (action.kind === "cancel") {
      const previous = original ?? layouts[0] ?? null;
      setOriginal(previous);
      setDraft(previous ? toDraft(previous) : starter());
      setEditing(false);
    } else if (action.kind === "switch") {
      const layout = layouts.find((row) => row.id === action.id);
      if (!layout) return;
      setOriginal(layout);
      setDraft(toDraft(layout));
      setEditing(false);
    }
  }

  function requestAction(action: PendingAction) {
    if (busy) return;
    game.stopMovement();
    setSeatError(null);
    if (dirty || action.kind === "delete") setPending(action);
    else void perform(action);
  }

  async function selectSeat(itemId: string | null) {
    if (!original || !currentMember || busy || editing) return;
    game.stopMovement();
    setBusy(true);
    setSeatError(null);
    try {
      const layout = await claimOfficeSeat(original.id, itemId);
      setLayouts((rows) => rows.map((row) => row.id === layout.id ? layout : row));
      setOriginal(layout);
      setDraft(toDraft(layout));
      // Reservation and posture are separate: a selected seat is kept while walking.
      if (!itemId) game.stand();
      toast.success(itemId ? "내 자리로 예약했어요. 자리에 앉거나 자유롭게 걸어 보세요." : "자리 예약을 해제했어요.");
    } catch (error) { setSeatError(errorMessage(error)); }
    finally { setBusy(false); }
  }
  function travel(id: string) { requestAction({ kind: "switch", id }); viewportRef.current?.focus({ preventScroll: true }); }
  function centerPlayer() {
    const viewport = viewportRef.current;
    if (!viewport || !game.player) return;
    viewport.scrollTo({ left: game.player.x * zoom - viewport.clientWidth / 2, top: game.player.y * zoom - viewport.clientHeight / 2 });
    viewport.focus({ preventScroll: true });
  }

  const selectedMember = selected?.member_id ? memberById.get(selected.member_id) : undefined;
  return (
    <section className={styles.office} aria-label="팀 오피스">
      <div className={styles.header}>
        <div>
          <p className={styles.eyebrow}><Sparkles size={13} /> OUR LITTLE OFFICE</p>
          <h2>우리의 작은 동네<span className={styles.titleDot}>.</span></h2>
          <p className={styles.description}>사무실에서 만나고, 마당을 걷고, 카페에서 잠깐 쉬어요.</p>
        </div>
        <div className={styles.liveBadge}><span />{membersLoading ? "출근 확인 중" : `${presentMembers.length}명 함께 일하는 중`}</div>
      </div>

      {loadError ? <div className={styles.error} role="alert"><strong>오피스를 불러오지 못했어요.</strong><p>{loadError}</p><button type="button" onClick={() => void reload()}><RotateCw size={14} /> 다시 불러오기</button></div> : loading ? <div className={styles.loading}><LoaderCircle size={24} className={styles.spinner} /><p>우리 팀의 공간을 준비하고 있어요.</p></div> : <>
        <div className={styles.toolbar}>
          <div className={styles.layoutPicker}>
            <LayoutGrid size={16} />
            <select aria-label="배치도 선택" value={original?.id ?? "draft"} disabled={busy} onChange={(event) => requestAction({ kind: "switch", id: event.target.value })}>
              {!original && <option value="draft">{draft.name} · 저장 전</option>}
              {layouts.map((layout) => <option key={layout.id} value={layout.id}>{layout.name}</option>)}
            </select>
            <span className={styles.layoutCount}>{layouts.length}개</span>
          </div>
          <div className={styles.toolbarActions}>
            {editing ? <><span className={styles.draftBadge}>{dirty ? "저장하지 않은 변경" : "꾸미는 중"}</span><button type="button" className={styles.quietButton} disabled={busy} onClick={() => requestAction({ kind: "cancel" })}><X size={14} /> 취소</button><button type="button" className={styles.primaryButton} disabled={busy || !draft.name.trim()} onClick={() => void save()}>{busy ? <LoaderCircle className={styles.spinner} size={14} /> : <Save size={14} />} 저장</button></> : <><button type="button" className={styles.quietButton} disabled={busy} onClick={() => requestAction({ kind: "new" })}><Plus size={14} /> 배치도 추가</button><button type="button" className={styles.primaryButton} disabled={busy} onClick={() => setEditing(true)}><Pencil size={14} /> 공간 꾸미기</button></>}
          </div>
        </div>

        <nav className={styles.roomNav} aria-label="우리 동네 공간 이동">
          {layouts.map((room) => <button key={room.id} type="button" aria-current={original?.id === room.id ? "location" : undefined} disabled={busy} onClick={() => travel(room.id)}><span aria-hidden="true">{room.room_kind === "outdoor" ? "🌳" : room.room_kind === "cafe" ? "☕" : "🏡"}</span>{room.name}</button>)}
        </nav>
        {seatError && <div className={styles.error} role="alert">{seatError}</div>}
        {game.syncError && <div className={styles.error} role="status"><strong>위치 공유를 확인해 주세요.</strong><p>{game.syncError}</p></div>}
        {pending && <div className={styles.confirm} role="alert">
          <div><strong>{pending.kind === "delete" ? `‘${original?.name}’ 배치도를 삭제할까요?` : "아직 저장하지 않은 변경사항이 있어요."}</strong><p>{pending.kind === "delete" ? "이 배치도의 가구와 자리 배정이 함께 삭제돼요." : "변경사항을 버리고 이동하거나, 계속 꾸밀 수 있어요."}</p></div>
          <div><button type="button" className={styles.quietButton} onClick={() => setPending(null)}>계속 꾸미기</button><button type="button" className={styles.dangerButton} onClick={() => void perform(pending)}>{pending.kind === "delete" ? "배치도 삭제" : "변경 버리고 계속"}</button></div>
        </div>}
        {saveError && <div className={styles.error} role="alert"><strong>변경사항을 반영하지 못했어요.</strong><p>{saveError}</p><p>지금 꾸민 내용은 화면에 보관되어 있어요.</p><button type="button" disabled={busy} onClick={() => requestAction({ kind: "reload" })}><RotateCw size={14} /> 최신 배치도 불러오기</button></div>}
        {syncError && !saveError && <div className={styles.error} role="status"><strong>마지막으로 불러온 공간을 보여드리고 있어요.</strong><p>{syncError}</p><button type="button" disabled={busy} onClick={() => requestAction({ kind: "reload" })}><RotateCw size={14} /> 다시 불러오기</button></div>}

        <div className={styles.workspace}>
          <div className={styles.sceneColumn}>
            <div className={`${styles.scene} ${styles[draft.theme] ?? ""} ${editing ? styles.editing : ""}`}>
              <div className={styles.sceneNote}>{editing ? <><MousePointer2 size={12} /> 가구를 끌어서 배치하세요</> : <><span className={styles.tinyDot} /> {original ? `${draft.name} · 방향키로 산책해요` : "저장 전 · 기본 배치 미리보기"}</>}</div>
              <div className={styles.cameraTools}><button type="button" aria-label="지도 축소" onClick={() => setZoom((z) => Math.max(.4, Math.round((z - .15) * 100) / 100))}>−</button><span>{Math.round(zoom * 100)}%</span><button type="button" aria-label="지도 확대" onClick={() => setZoom((z) => Math.min(1.4, Math.round((z + .15) * 100) / 100))}>+</button><button type="button" onClick={centerPlayer}>내 캐릭터로</button><button type="button" onClick={() => { const v = viewportRef.current; if (v) setZoom(Math.max(.25, Math.min(v.clientWidth / width, v.clientHeight / height))); }}>전체 보기</button></div>
              <div ref={viewportRef} className={styles.canvasScroll} tabIndex={0} role="region" aria-label="방향키로 걷는 우리 동네" data-testid="office-game-world"
                onKeyDown={(event) => {
                  if (event.target === event.currentTarget && !editing && !busy && nearPortal && (event.key.toLowerCase() === "e" || event.key === "Enter")) {
                    event.preventDefault(); travel(nearPortal.destination.id); return;
                  }
                  game.onKeyDown(event);
                }} onKeyUp={game.onKeyUp}
                onPointerDown={(event) => {
                  if (!(event.target instanceof SVGSVGElement) || event.button !== 0) return;
                  event.currentTarget.focus({ preventScroll: true }); setSelectedId(null);
                  if (event.pointerType === "mouse") { panRef.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, left: event.currentTarget.scrollLeft, top: event.currentTarget.scrollTop }; event.currentTarget.setPointerCapture(event.pointerId); }
                }} onPointerMove={(event) => { const pan = panRef.current; if (!pan || pan.pointer !== event.pointerId) return; event.currentTarget.scrollLeft = pan.left - event.clientX + pan.x; event.currentTarget.scrollTop = pan.top - event.clientY + pan.y; }}
                onPointerUp={() => { panRef.current = null; }} onPointerCancel={() => { panRef.current = null; }}>
                <svg ref={svgRef} viewBox={`0 0 ${width} ${height}`} style={{ width: width * zoom, height: height * zoom }} className={styles.canvas} aria-label={`${draft.name} 배치도. ${desks.length}개 책상, 출근 ${presentMembers.length}명.`}>
                  <WorldArt width={width} height={height} kind={draft.room_kind} patternId={patternId} editing={editing} />
                  <WorldPortals room={original} rooms={layouts} onTravel={travel} disabled={editing || busy} />
                  {draft.items.map((item) => {
                    const member = item.member_id ? memberById.get(item.member_id) : undefined;
                    const memberPresence = member?.id === currentMember?.id ? game.player : game.peers.find((row) => row.member_id === member?.id);
                    const present = Boolean(member && presentIds.has(member.id));
                    const seated = Boolean(member && memberPresence?.motion === "seated" && memberPresence.layout_id === original?.id && memberPresence.member_id === item.member_id);
                    const own = Boolean(member && currentMember?.id === member.id);
                    const isSelected = selectedId === item.id;
                    const size = FURNITURE[item.kind];
                    const turned = item.rotation === 90 || item.rotation === 270;
                    const w = turned ? size.height : size.width;
                    const h = turned ? size.width : size.height;
                    const label = item.kind === "desk" ? member?.name ?? (item.member_id ? "등록 해제된 팀원" : item.label || "빈 자리") : item.label;
                    return <g key={item.id} data-testid={`office-item-${item.id}`} data-kind={item.kind} data-member-id={item.member_id ?? ""} data-present={present} data-x={item.x} data-y={item.y} transform={`translate(${item.x} ${item.y})`} className={`${styles.furniture} ${isSelected ? styles.selectedFurniture : ""}`} role="button" tabIndex={0} aria-label={`${FURNITURE[item.kind].name}${label ? ` · ${label}` : ""}${member ? present ? " · 근무 중" : " · 자리 비움" : ""}${own ? " · 내 자리" : ""}`} aria-pressed={isSelected} onFocus={() => setSelectedId(item.id)} onPointerDown={(event) => startDrag(event, item)} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={() => { dragRef.current = null; }} onKeyDown={(event) => itemKeyDown(event, item)}>
                      <rect className={styles.selectionOutline} x={-w / 2 - 5} y={-h / 2 - 5} width={w + 10} height={h + 10} rx="15" fill={isSelected ? "#ffffff35" : own ? "#7dae9020" : "transparent"} stroke={isSelected ? "#3d7865" : own ? "#82aa91" : "transparent"} strokeWidth="2" strokeDasharray={isSelected ? "5 4" : undefined} />
                      <g transform={`rotate(${item.rotation})`} pointerEvents="none"><FurnitureArt item={item} member={member} present={seated} /></g>
                      {member && <StatusBubble message={member.status_message} y={item.y < 200 ? h / 2 + 150 : -h / 2 - 15} x={Math.max(110 - item.x, Math.min(width - 110 - item.x, 0))} />}
                      {label && <g transform={`translate(0 ${h / 2 + 12})`} pointerEvents="none">
                        <rect x={-Math.min(100, Math.max(37, label.length * 6 + (member ? 18 : 10)))} y="-11" width={Math.min(200, Math.max(74, label.length * 12 + (member ? 36 : 20)))} height="23" rx="11.5" fill={present ? "#fcfff8" : "#f6f5edae"} stroke={own ? "#75a08b" : "#d7dacd"} />
                        <text y="4" textAnchor="middle" fontSize="11" fontWeight={present || own ? "600" : "400"} fill={present ? "#355d4d" : "#81877d"}>{present ? "● " : member ? "○ " : ""}{label.length > 14 ? `${label.slice(0, 13)}…` : label}{own ? " · 나" : ""}</text>
                      </g>}
                    </g>;
                  })}
                  {game.peers.filter((row) => row.motion !== "seated").sort((a, b) => a.y - b.y).map((row) => {
                    const member = memberById.get(row.member_id);
                    return member ? <WalkingCharacter key={row.member_id} member={member} presence={row} roomWidth={width} working={presentIds.has(member.id)} /> : null;
                  })}
                  {currentMember && game.player && (game.player.motion !== "seated" ? <WalkingCharacter member={currentMember} presence={game.player} roomWidth={width} own moving={game.moving} working={presentIds.has(currentMember.id)} /> : <g data-testid="office-player" data-x={game.player.x} data-y={game.player.y} data-room-id={game.player.layout_id} data-motion="seated" />)}
                </svg>
              </div>
            </div>
            <div className={styles.sceneFooter}><span><i className={styles.onlineDot} /> 근무 중 <i className={styles.offlineDot} /> 미출근·퇴근</span><span>{editing ? "가구 선택 후 방향키 이동 · Shift 빠르게 · R 회전" : "바닥 클릭 후 방향키 / WASD · 문 앞에서 E · 지도를 끌어 둘러보기"}</span></div>
            {!editing && <div className={styles.gameControls}>
              <div><strong>{game.player?.motion === "seated" ? "내 자리에서 쉬어 가요" : nearPortal ? `${nearPortal.destination.name} 입구` : "오늘은 어디서 일할까요?"}</strong><p>{game.player?.motion === "seated" ? "일어나 걸어도 자리 예약은 유지돼요." : "빈 책상을 누르면 내 자리로 선택할 수 있어요."}</p></div>
              <div className={styles.gameActions}>{nearPortal && <button type="button" className={styles.primaryButton} disabled={busy} onClick={() => travel(nearPortal.destination.id)}>들어가기 · E</button>}{game.player?.motion === "seated" && <button type="button" className={styles.primaryButton} onClick={() => { game.stand(); viewportRef.current?.focus({ preventScroll: true }); }}>일어나기</button>}{game.player?.motion === "seated" && <button type="button" className={styles.quietButton} data-testid="healing-open" onClick={() => setHealingOpen(true)}>🌊 힐링 타임</button>}</div>{healingOpen && <HealingOverlay onClose={() => { setHealingOpen(false); viewportRef.current?.focus({ preventScroll: true }); }} />}
              <div className={styles.directionPad} aria-label="캐릭터 이동 버튼">{([["up", "위", ArrowUp], ["left", "왼쪽", ArrowLeft], ["down", "아래", ArrowDown], ["right", "오른쪽", ArrowRight]] as const).map(([direction, label, Icon]) => <button key={direction} type="button" aria-label={`캐릭터 ${label}${direction === "left" || direction === "right" ? "으로" : "로"} 이동`} disabled={busy || !game.player} onPointerDown={(event) => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); game.startDirection(direction); }} onPointerUp={game.stopMovement} onPointerCancel={game.stopMovement} onLostPointerCapture={game.stopMovement} onKeyDown={(event) => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); game.startDirection(direction); } }} onKeyUp={game.stopMovement} onBlur={game.stopMovement}><Icon size={18} /></button>)}</div>
            </div>}
          </div>

          <aside className={styles.sidebar} aria-label={editing ? "공간 편집 도구" : "오피스 정보"}>
            {editing ? <>
              <div className={styles.field}><label htmlFor={`${patternId}name`}>배치도 이름</label><input id={`${patternId}name`} maxLength={60} value={draft.name} disabled={busy} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></div>
              <div className={styles.field}><label htmlFor={`${patternId}size`}>공간 크기</label><select id={`${patternId}size`} disabled={busy} value={`${width}x${height}`} onChange={(event) => { const [w, h] = event.target.value.split("x").map(Number); if (draft.items.some((item) => item.x > w - 105 || item.y > h - 110)) { toast.error("가구를 안쪽으로 옮긴 뒤 공간을 줄여 주세요."); return; } setDraft({ ...draft, canvas_width: w, canvas_height: h }); }}>
                {!["1000x560", "1600x900", "2200x1100"].includes(`${width}x${height}`) && <option value={`${width}x${height}`}>현재 크기 · {width} × {height}</option>}
                <option value="1000x560">아담하게 · 1000 × 560</option><option value="1600x900">넓게 · 1600 × 900</option><option value="2200x1100">아주 넓게 · 2200 × 1100</option>
              </select></div>
              <div className={styles.sidebarSection}><h3>오늘의 분위기</h3><div className={styles.themes}>{THEMES.map((theme) => <button key={theme.id} type="button" aria-label={theme.name} aria-pressed={draft.theme === theme.id} title={theme.name} className={styles.themeSwatch} style={{ backgroundColor: theme.color }} disabled={busy} onClick={() => setDraft({ ...draft, theme: theme.id })}>{draft.theme === theme.id && <Check size={15} />}</button>)}<span>{THEMES.find((theme) => theme.id === draft.theme)?.name}</span></div></div>
              <div className={styles.sidebarSection}><h3>가구 더하기 <span>{draft.items.length}/100</span></h3><div className={styles.inventory}>{Object.entries(FURNITURE).map(([kind, furniture]) => <button type="button" key={kind} aria-label={`${furniture.name} 추가`} disabled={busy || draft.items.length >= 100} onClick={() => addItem(kind as OfficeItem["kind"])}><furniture.icon size={20} strokeWidth={1.5} /><span>{furniture.name}</span><Plus size={12} /></button>)}</div></div>
              {selected ? <div className={styles.inspector}>
                <h3><MousePointer2 size={14} /> {FURNITURE[selected.kind].name} 편집</h3>
                <div className={styles.field}><label htmlFor={`${patternId}label`}>가구 이름</label><input id={`${patternId}label`} maxLength={40} placeholder={FURNITURE[selected.kind].name} value={selected.label} disabled={busy} onChange={(event) => patchItem(selected.id, { label: event.target.value })} /></div>
                {selected.kind === "desk" && <p className={styles.smallText}>{selected.member_id ? `${selectedMember?.name ?? "팀원"}님의 예약 자리예요. 예약은 본인만 해제할 수 있어요.` : "저장한 뒤 빈 책상을 눌러 본인 자리를 선택하세요."}</p>}
                <div className={styles.itemActions}><button type="button" disabled={busy} onClick={rotateSelected}><RotateCw size={14} /> 회전</button><button type="button" className={styles.removeButton} disabled={busy || Boolean(selected.member_id)} onClick={removeSelected}><Trash2 size={14} /> 빼기</button></div>
                <div className={styles.moveControls} aria-label="선택한 가구 이동"><span>위치 이동</span>{[[ArrowLeft, -10, 0, "왼쪽"], [ArrowUp, 0, -10, "위"], [ArrowDown, 0, 10, "아래"], [ArrowRight, 10, 0, "오른쪽"]].map(([Icon, x, y, label]) => { const DirectionIcon = Icon as typeof ArrowLeft; return <button type="button" key={String(label)} aria-label={`${label}으로 이동`} disabled={busy} onClick={() => moveSelected(Number(x), Number(y))}><DirectionIcon size={13} /></button>; })}</div>
              </div> : <div className={styles.selectHint}><MousePointer2 size={20} /><p>가구를 선택해 이름을 붙이고<br />팀원의 자리를 정해 주세요.</p></div>}
              {original && <><button type="button" className={styles.deleteLayout} disabled={busy || desks.some((desk) => desk.member_id !== null)} onClick={() => requestAction({ kind: "delete" })}><Trash2 size={12} /> 이 배치도 삭제</button>{desks.some((desk) => desk.member_id !== null) && <p className={styles.smallText}>자리 예약을 모두 해제하면 배치도를 삭제할 수 있어요.</p>}</>}
            </> : <>
              <p className={styles.sidebarEyebrow}>TODAY IN OFFICE</p><h3 className={styles.todayTitle}>각자의 자리, 함께하는 하루</h3>
              <div className={styles.statGrid}><div><strong>{membersLoading ? "—" : presentMembers.length}<small>명</small></strong><span>지금 근무 중</span></div><div><strong>{desks.filter((desk) => !desk.member_id).length}<small>석</small></strong><span>배정할 빈 자리</span></div></div>
              {selectedMember ? <div className={styles.memberCard}><span className={styles.memberAvatar} style={{ backgroundColor: `${selectedMember.color}22` }}>{selectedMember.avatar}</span><div><strong>{selectedMember.name}{selectedMember.id === currentMember?.id && <em>나</em>}</strong><p>{selectedMember.role || "팀원"}</p><span className={styles.memberState}>{presentIds.has(selectedMember.id) ? "● 출근해서 일하는 중" : "○ 미출근·퇴근"}</span>{selectedMember.status_message && <p>{selectedMember.status_message}</p>}</div></div> : selected && <div className={styles.selectionInfo}><strong>{selected.label || FURNITURE[selected.kind].name}</strong><p>{selected.kind === "desk" ? "아직 예약되지 않은 자리예요." : "공간 꾸미기에서 위치와 이름을 바꿀 수 있어요."}</p></div>}
              {selected?.kind === "desk" && <div className={styles.seatActions}>
                {!selected.member_id ? <button type="button" className={styles.primaryButton} disabled={busy || !original || !currentMember} onClick={() => void selectSeat(selected.id)}>내 자리로 선택</button> : selected.member_id === currentMember?.id ? <><button type="button" className={styles.primaryButton} disabled={busy || game.player?.motion === "seated"} onClick={() => { game.sit(selected); viewportRef.current?.focus({ preventScroll: true }); }}>자리에 앉기</button><button type="button" className={styles.quietButton} disabled={busy} onClick={() => void selectSeat(null)}>자리 예약 해제</button></> : <p className={styles.smallText}>{selectedMember?.name ?? "다른 팀원"}님의 자리 · 선택할 수 없어요.</p>}
                {!original && <p className={styles.smallText}>먼저 배치도를 저장해 주세요.</p>}
              </div>}
              {ownSeat && selected?.id !== ownSeat.id && <button type="button" className={styles.quietButton} onClick={() => setSelectedId(ownSeat.id)}>내 예약 자리 보기</button>}
              <div className={styles.sidebarSection}><h3>자리를 기다리는 팀원 <span>{unseated.length}</span></h3>{membersLoading ? <p className={styles.smallText}>팀원을 확인하고 있어요.</p> : unseated.length ? <div className={styles.roster}>{unseated.map((member) => <span key={member.id} className={styles.memberChip} title={presentIds.has(member.id) ? "근무 중 · 자리 배정 필요" : "자리 배정 필요"}>{member.avatar} {member.name}{presentIds.has(member.id) && <i className={styles.onlineDot} />}</span>)}</div> : <p className={styles.smallText}>{members.length ? "모든 팀원에게 자리가 있어요. 🌿" : "첫 번째 팀원을 기다리고 있어요."}</p>}</div>
              <div className={styles.welcomeCard}><span>🌱</span><h4>{currentMember ? "우리 동네, 우리 취향대로" : "반가워요, 새로운 팀원!"}</h4><p>{currentMember ? "책상과 식물을 더하고 나만의 자리를 정해 보세요. 출퇴근은 내 출근 카드에서 기록해요." : "내 설정을 완료하고 우리 동네를 둘러보세요."}</p><button type="button" onClick={currentMember ? () => setEditing(true) : onRegister}>{currentMember ? "오피스 꾸미기" : "내 설정 열기"}<ArrowRight size={13} /></button></div>
              <div className={styles.officeSummary}><Users size={13} /> 팀원 {members.length}명 <span>·</span> 책상 {desks.length}개</div>
            </>}
          </aside>
        </div>
      </>}
      <span className={styles.srOnly} role="status" aria-live="polite">{announcement}</span>
    </section>
  );
}
