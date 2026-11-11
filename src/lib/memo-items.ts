import { createClient } from "@/lib/supabase/client";

/** One line of a month's notes (project_memo_items). The server stamps the author. */
export interface MemoItem {
  id: string;
  project_id: string;
  month: string;
  content: string;
  created_by: string | null;
  creator_name: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface NewMemoItem {
  project_id: string;
  /** 'YYYY-MM' */
  month: string;
  content: string;
}

export const MEMO_ITEM_MAX = 300;
const COLUMNS = "id,project_id,month,content,created_by,creator_name,created_at,updated_at,deleted_at";

/** The table is not in the database yet; callers fall back to the single memo editor. */
export class MemoItemsUnavailableError extends Error {
  constructor() {
    super("월 주요사항 항목 저장소가 아직 준비되지 않았습니다.");
    this.name = "MemoItemsUnavailableError";
  }
}

/** A teammate changed (or removed) the row after we read it. */
export class MemoItemConflictError extends Error {
  constructor() {
    super("다른 팀원이 이 항목을 먼저 고쳤습니다");
    this.name = "MemoItemConflictError";
  }
}

function databaseError(error: { code?: string; message: string }): Error {
  // Same detection as department-events.ts: missing relation in PostgREST or Postgres.
  if (["PGRST205", "42P01"].includes(error.code ?? "")) return new MemoItemsUnavailableError();
  return new Error(error.message);
}

function cleanContent(content: string): string {
  const text = content.trim();
  if (!text) throw new Error("내용을 입력해 주세요.");
  return text;
}

/** Live items of one project month, newest first. */
export async function listMemoItems(projectId: string, month: string): Promise<MemoItem[]> {
  const { data, error } = await createClient()
    .from("project_memo_items")
    .select(COLUMNS)
    .eq("project_id", projectId)
    .eq("month", month)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (error) throw databaseError(error);
  return (data ?? []) as MemoItem[];
}

/** Only project, month and text are sent; author columns are filled by the server trigger. */
export async function addMemoItem(input: NewMemoItem): Promise<MemoItem> {
  const row = { project_id: input.project_id, month: input.month, content: cleanContent(input.content) };
  const { data, error } = await createClient()
    .from("project_memo_items")
    .insert(row)
    .select(COLUMNS)
    .single();
  if (error) throw databaseError(error);
  return data as MemoItem;
}

/** Saves only if the row still has the updated_at we read; otherwise MemoItemConflictError. */
export async function updateMemoItem(item: MemoItem, content: string): Promise<MemoItem> {
  const { data, error } = await createClient()
    .from("project_memo_items")
    .update({ content: cleanContent(content) })
    .eq("id", item.id)
    .eq("updated_at", item.updated_at)
    .select(COLUMNS)
    .maybeSingle();
  if (error) throw databaseError(error);
  if (!data) throw new MemoItemConflictError();
  return data as MemoItem;
}

/** Soft delete or restore, under the same updated_at condition as an edit. */
export async function setMemoItemDeleted(item: MemoItem, deleted: boolean): Promise<MemoItem> {
  const { data, error } = await createClient()
    .from("project_memo_items")
    .update({ deleted_at: deleted ? new Date().toISOString() : null })
    .eq("id", item.id)
    .eq("updated_at", item.updated_at)
    .select(COLUMNS)
    .maybeSingle();
  if (error) throw databaseError(error);
  if (!data) throw new MemoItemConflictError();
  return data as MemoItem;
}

/** First `limit` items unless expanded; hiddenCount = items folded away right now. */
export function foldItems<T>(items: readonly T[], limit: number, expanded: boolean): { shown: T[]; hiddenCount: number } {
  if (expanded || items.length <= limit) return { shown: [...items], hiddenCount: 0 };
  return { shown: items.slice(0, limit), hiddenCount: items.length - limit };
}
