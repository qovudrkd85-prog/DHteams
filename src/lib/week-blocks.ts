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

export type BlockKind = "todo" | "text" | "h1" | "h2" | "h3" | "bullet" | "number";

// Longest marks first so "### " is not read as "# ".
const SHORTCUTS: ReadonlyArray<readonly [string, BlockKind]> = [
  ["### ", "h3"],
  ["## ", "h2"],
  ["# ", "h1"],
  ["- ", "bullet"],
  ["* ", "bullet"],
  ["1. ", "number"],
  ["[ ] ", "todo"],
  ["[] ", "todo"],
];

/** Markdown mark at the very start of a line ("## 제목") -> new kind and the text without the mark. */
export function parseShortcut(value: string): { kind: BlockKind; text: string } | null {
  for (const [mark, kind] of SHORTCUTS) {
    if (value.startsWith(mark)) return { kind, text: value.slice(mark.length) };
  }
  return null;
}

/** Display numbers for number rows: each consecutive run counts from 1; other rows get null. */
export function numberLabels(items: readonly KindLike[]): (number | null)[] {
  let run = 0;
  return items.map((item) => {
    if (item.kind !== "number") {
      run = 0;
      return null;
    }
    run += 1;
    return run;
  });
}

/** Kind for the next line after Enter: lists and to-dos carry on, headings and text go back to to-do. */
export function stickyKind(kind: BlockKind): BlockKind {
  return kind === "bullet" || kind === "number" ? kind : "todo";
}

// ------------------------------------------------------------ "/" block menu (D11)

export interface BlockMenuItem {
  kind: BlockKind;
  label: string;
  /** English aliases matched by prefix, lower case. */
  aliases: readonly string[];
}

export const BLOCK_MENU: readonly BlockMenuItem[] = [
  { kind: "todo", label: "할 일 목록", aliases: ["todo"] },
  { kind: "text", label: "텍스트", aliases: ["text"] },
  { kind: "h1", label: "제목1", aliases: ["h1"] },
  { kind: "h2", label: "제목2", aliases: ["h2"] },
  { kind: "h3", label: "제목3", aliases: ["h3"] },
  { kind: "bullet", label: "글머리 기호 목록", aliases: ["bullet"] },
  { kind: "number", label: "번호 매기기 목록", aliases: ["num", "number"] },
];

/** Menu items whose label contains the query or whose alias starts with it (case-insensitive). */
export function filterMenu(query: string): BlockMenuItem[] {
  const q = query.trim().toLowerCase();
  return BLOCK_MENU.filter(
    (item) => item.label.toLowerCase().includes(q) || item.aliases.some((alias) => alias.startsWith(q)),
  );
}

/** Next highlighted index after ↑ (-1) or ↓ (+1), wrapping at both ends. */
export function moveIndex(index: number, delta: number, count: number): number {
  if (count <= 0) return 0;
  return (((index + delta) % count) + count) % count;
}

/** Filter text after a "/" typed at the very start of the input, else null (menu closed). */
export function slashQuery(value: string): string | null {
  return value.startsWith("/") ? value.slice(1) : null;
}
