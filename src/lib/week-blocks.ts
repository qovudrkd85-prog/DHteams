// Pure helpers for week-board blocks (schedules.kind / sort_order). Never mutate inputs.

type KindLike = { kind?: string | null };
type OrderLike = { sort_order?: number | null; created_at?: string | null };

const orderOf = (item: OrderLike): number => item.sort_order ?? 0;

/** Rows without kind (column not installed yet) or kind 'todo' are to-dos. */
export function isTodo(row: KindLike): boolean {
  return row.kind == null || row.kind === "todo";
}

/** Order one day's rows by sort_order (missing = 0), then created_at. Returns a new array. */
export function orderDay<T extends OrderLike>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => {
    const diff = orderOf(a) - orderOf(b);
    if (diff !== 0) return diff;
    return (a.created_at ?? "").localeCompare(b.created_at ?? "");
  });
}

/** sort_order for a row appended at the end of the day: 1 on an empty day, else max + 1. */
export function nextOrder(items: readonly OrderLike[]): number {
  if (items.length === 0) return 1;
  return Math.max(...items.map(orderOf)) + 1;
}

/** sort_order between two neighbours; without a lower neighbour b, a + 1. */
export function orderBetween(a: number, b?: number | null): number {
  if (b == null) return a + 1;
  return (a + b) / 2;
}
