// Pure view helpers for the project schedule calendar. No imports so the
// node unit test can load this file on its own.

export interface ScheduleViewItem {
  due_date: string;
  done: boolean;
}

/** Keep the first `limit` items in their given order; count the rest. */
export function capCell<T>(items: readonly T[], limit: number): { shown: T[]; hidden: number } {
  const shown = items.slice(0, Math.max(0, limit));
  return { shown, hidden: items.length - shown.length };
}

/** Split month items into not-done (date ascending, stable) and done lists. */
export function splitMonthItems<T extends ScheduleViewItem>(
  items: readonly T[],
  // Kept in the signature for callers; ordering does not depend on it.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _today: string,
): { open: T[]; done: T[] } {
  const open = items
    .filter((item) => !item.done)
    .map((item, index) => ({ item, index }))
    .sort((a, b) =>
      a.item.due_date === b.item.due_date
        ? a.index - b.index
        : a.item.due_date < b.item.due_date
          ? -1
          : 1,
    )
    .map(({ item }) => item);
  const done = items.filter((item) => item.done);
  return { open, done };
}

/** True only for a not-done item whose date (YYYY-MM-DD) is before today. */
export function isOverdue(item: ScheduleViewItem, today: string): boolean {
  return !item.done && item.due_date < today;
}

/** Background refresh only while the page is visible, no dialog is open and no write is in flight. */
export function shouldRefreshSchedules(state: {
  visible: boolean;
  editing: boolean;
  mutating: number;
}): boolean {
  return state.visible && !state.editing && state.mutating === 0;
}

const SAME_KEYS = ["id", "title", "due_date", "assignee", "note", "color", "done"] as const;
type ComparableSchedule = { [K in (typeof SAME_KEYS)[number]]: unknown };

/** True when both lists hold the same rows in the same order (shown fields only). */
export function sameSchedules(a: readonly ComparableSchedule[], b: readonly ComparableSchedule[]): boolean {
  return (
    a.length === b.length &&
    a.every((row, i) => SAME_KEYS.every((key) => row[key] === b[i][key]))
  );
}
