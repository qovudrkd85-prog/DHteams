import type { OfficeDraft, OfficeItem, OfficeLayout } from "./workspace";

export type HubView = "team" | "garage";

const HUB_VIEW_KEY = "teams-hub-view";
const DESK_GAP = 150;
const GROW_SIZES: readonly [number, number][] = [[1600, 900], [2200, 1100], [2400, 1200]];

export function loadHubView(): HubView {
  try {
    return window.localStorage.getItem(HUB_VIEW_KEY) === "garage" ? "garage" : "team";
  } catch {
    return "team";
  }
}

export function saveHubView(view: HubView): void {
  try { window.localStorage.setItem(HUB_VIEW_KEY, view); } catch { /* View choice can stay session-only. */ }
}

// The team room is the team's first office; yard/cafe/extra offices stay in the DB but are not shown.
export function pickTeamRoom(layouts: readonly OfficeLayout[]): OfficeLayout | null {
  const offices = layouts.filter((layout) => (layout.room_kind ?? "office") === "office");
  return offices.find((layout) => layout.room_key === "office-1") ?? offices[0] ?? null;
}

export function deskSlots(width: number, height: number): { x: number; y: number }[] {
  const slots: { x: number; y: number }[] = [];
  for (let y = 130; y <= height - 90; y += 190) {
    for (let x = 100; x <= width - 90; x += 180) slots.push({ x, y });
  }
  return slots;
}

function freeSlot(items: readonly OfficeItem[], width: number, height: number) {
  return deskSlots(width, height).find((slot) => items.every((item) => Math.hypot(item.x - slot.x, item.y - slot.y) >= DESK_GAP));
}

/** Finds the member's desk, else an empty desk, else a draft with one new empty desk on a free grid cell. */
export function withOwnDesk(layout: OfficeLayout, memberId: string): { draft: OfficeDraft | null; deskId: string } {
  const desks = layout.items.filter((item) => item.kind === "desk");
  const own = desks.find((item) => item.member_id === memberId);
  if (own) return { draft: null, deskId: own.id };
  const empty = desks.find((item) => item.member_id === null);
  if (empty) return { draft: null, deskId: empty.id };

  const width = layout.canvas_width ?? 1000;
  const height = layout.canvas_height ?? 560;
  const sizes = [[width, height] as [number, number], ...GROW_SIZES.filter(([w, h]) => w >= width && h >= height && (w > width || h > height))];
  for (const [w, h] of sizes) {
    const slot = freeSlot(layout.items, w, h);
    if (!slot) continue;
    const desk: OfficeItem = { id: crypto.randomUUID(), kind: "desk", x: slot.x, y: slot.y, rotation: 0, label: "", member_id: null };
    return {
      deskId: desk.id,
      draft: { name: layout.name, theme: layout.theme, canvas_width: w, canvas_height: h, room_kind: layout.room_kind ?? "office", items: [...layout.items.map((item) => ({ ...item })), desk] },
    };
  }
  throw new Error("책상 자리가 없어요. 팀 방이 가득 찼어요.");
}
