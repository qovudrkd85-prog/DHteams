// Pure helpers for the project week board (Monday-first weeks). No imports so
// the node unit test can load this file on its own. Day keys are YYYY-MM-DD.

const DAY_MS = 86400000;

// Parse and format in UTC so the local time zone and DST never shift a day.
const parseKey = (key: string): Date => new Date(`${key}T00:00:00Z`);
const formatKey = (date: Date): string => date.toISOString().slice(0, 10);
const addDays = (key: string, days: number): string =>
  formatKey(new Date(parseKey(key).getTime() + days * DAY_MS));

/** Monday of the week that holds `day` (Sunday belongs to the week before it). */
export function weekStart(day: string): string {
  const weekday = parseKey(day).getUTCDay(); // 0 = Sunday
  return addDays(day, -((weekday + 6) % 7));
}

/** Seven consecutive day keys starting at `start`. */
export function weekDays(start: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** Week start moved by `delta` weeks. */
export function shiftWeek(start: string, delta: number): string {
  return addDays(start, delta * 7);
}

/** "11월 9일~15일", or "11월 30일~12월 6일" when the week spans two months. */
export function weekLabel(start: string): string {
  const first = parseKey(start);
  const last = parseKey(addDays(start, 6));
  const head = `${first.getUTCMonth() + 1}월 ${first.getUTCDate()}일`;
  const sameMonth = first.getUTCMonth() === last.getUTCMonth();
  const tail = sameMonth
    ? `${last.getUTCDate()}일`
    : `${last.getUTCMonth() + 1}월 ${last.getUTCDate()}일`;
  return `${head}~${tail}`;
}

/** Items of the week grouped by day (all seven keys present, input order kept). */
export function groupWeek<T extends { due_date: string }>(
  items: readonly T[],
  start: string,
): Map<string, T[]> {
  const days = weekDays(start);
  return new Map(days.map((day) => [day, items.filter((item) => item.due_date === day)]));
}

/** False while an IME (Hangul) composition is still running, so Enter is not handled twice. */
export function shouldHandleKey(event: { isComposing: boolean; keyCode: number }): boolean {
  return !event.isComposing && event.keyCode !== 229;
}
