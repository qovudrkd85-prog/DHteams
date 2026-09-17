import type { OfficeLayout } from "./workspace";

export function roomPortals(room: OfficeLayout | null, rooms: OfficeLayout[]) {
  if (!room) return [];
  const width = room.canvas_width ?? 1000;
  const height = room.canvas_height ?? 560;
  if (room.room_kind === "outdoor") {
    const destinations = rooms.filter((r) => r.room_key && r.room_key !== "outdoor").sort((a, b) => (a.room_key ?? "").localeCompare(b.room_key ?? ""));
    return destinations.map((destination, index) => ({ destination, x: width * (index + 1) / (destinations.length + 1), y: 400 }));
  }
  const yard = rooms.find((r) => r.room_key === "outdoor");
  return yard ? [{ destination: yard, x: width / 2, y: height - 60 }] : [];
}
