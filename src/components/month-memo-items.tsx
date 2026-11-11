"use client";

import { Pin, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { toast } from "sonner";

import { Input } from "@/components/ui/input";
import {
  addMemoItem,
  foldItems,
  listMemoItems,
  MEMO_ITEM_MAX,
  MemoItemConflictError,
  setMemoItemDeleted,
  updateMemoItem,
  type MemoItem,
} from "@/lib/memo-items";

interface MonthMemoItemsProps {
  projectId: string;
  /** 'YYYY-MM' */
  month: string;
  initialItems: MemoItem[];
}

interface EditState {
  id: string;
  text: string;
}

const FOLD_LIMIT = 5;
const REFRESH_MS = 30000;
const CONFLICT_MESSAGE = "다른 팀원이 이 항목을 먼저 고쳤습니다";

const message = (error: unknown) => (error instanceof Error ? error.message : "저장하지 못했습니다.");

function shortDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : `${date.getMonth() + 1}/${date.getDate()}`;
}

// Korean IME: Enter that finishes a composition must not submit.
const isSubmitEnter = (e: KeyboardEvent<HTMLInputElement>) => e.key === "Enter" && !e.nativeEvent.isComposing;

/** 월 주요사항 — 한 줄 = 한 항목, 줄마다 작성자·날짜 */
export function MonthMemoItems({ projectId, month, initialItems }: MonthMemoItemsProps) {
  const [items, setItems] = useState<MemoItem[]>(initialItems);
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState("");
  const [editing, setEditingState] = useState<EditState | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const editingRef = useRef<EditState | null>(null);
  const busy = useRef(false);
  const request = useRef(0);
  const mounted = useRef(true);

  // Keep a ref in step so blur/refresh handlers see the latest edit without a re-render.
  const setEditing = useCallback((next: EditState | null) => {
    editingRef.current = next;
    setEditingState(next);
  }, []);

  const reload = useCallback(async () => {
    const seq = ++request.current;
    const rows = await listMemoItems(projectId, month);
    if (mounted.current && seq === request.current) setItems(rows);
    return rows;
  }, [projectId, month]);

  // Teammates' items arrive every 30s and on focus, never while we edit or write.
  const refresh = useCallback(() => {
    if (document.visibilityState !== "visible" || editingRef.current || busy.current) return;
    // Background refresh failures stay quiet; the next tick retries.
    reload().catch(() => undefined);
  }, [reload]);

  useEffect(() => {
    mounted.current = true;
    const interval = window.setInterval(refresh, REFRESH_MS);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      mounted.current = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [refresh]);

  // Run one write at a time; any refresh already in flight is dropped.
  async function write<T>(task: () => Promise<T>): Promise<T | undefined> {
    if (busy.current) return undefined;
    busy.current = true;
    request.current++;
    try {
      return await task();
    } finally {
      busy.current = false;
    }
  }

  async function add() {
    const text = draft.trim();
    if (!text) return;
    try {
      const row = await write(() => addMemoItem({ project_id: projectId, month, content: text }));
      if (!row || !mounted.current) return;
      setItems((prev) => [row, ...prev.filter((item) => item.id !== row.id)]);
      setDraft("");
    } catch (error) {
      toast.error(`${month} 주요사항: ${message(error)}`);
    }
  }

  function startEdit(item: MemoItem) {
    setEditError(null);
    setEditing({ id: item.id, text: item.content });
  }

  function cancelEdit() {
    setEditError(null);
    setEditing(null);
  }

  async function saveEdit() {
    const current = editingRef.current;
    if (!current) return;
    const item = items.find((row) => row.id === current.id);
    const text = current.text.trim();
    if (!item || !text || text === item.content) {
      cancelEdit();
      return;
    }
    try {
      const row = await write(() => updateMemoItem(item, text));
      if (!row || !mounted.current) return;
      setItems((prev) => prev.map((r) => (r.id === row.id ? row : r)));
      if (editingRef.current?.id === row.id) cancelEdit();
    } catch (error) {
      if (!(error instanceof MemoItemConflictError)) {
        toast.error(`${month} 주요사항: ${message(error)}`);
        return;
      }
      // Keep my text; load the teammate's version so the next Enter saves against it.
      setEditError(CONFLICT_MESSAGE);
      try {
        const rows = await reload();
        if (mounted.current && !rows.some((r) => r.id === current.id)) {
          cancelEdit();
          toast.error("다른 팀원이 이 항목을 지웠습니다.");
        }
      } catch {
        // The message already tells the user; the next refresh retries.
      }
    }
  }

  async function remove(item: MemoItem) {
    try {
      const deleted = await write(() => setMemoItemDeleted(item, true));
      if (!deleted) return;
      if (mounted.current) setItems((prev) => prev.filter((r) => r.id !== deleted.id));
      if (editingRef.current?.id === deleted.id) cancelEdit();
      toast.success("항목을 지웠습니다.", {
        duration: 10000,
        action: {
          label: "되돌리기",
          onClick: async () => {
            try {
              await setMemoItemDeleted(deleted, false);
              // The undo toast can outlive this month view.
              if (mounted.current) await reload();
              toast.success("항목을 되돌렸습니다.");
            } catch (error) {
              toast.error(message(error));
            }
          },
        },
      });
    } catch (error) {
      if (error instanceof MemoItemConflictError) {
        toast.error(CONFLICT_MESSAGE);
        reload().catch(() => undefined);
      } else {
        toast.error(`${month} 주요사항: ${message(error)}`);
      }
    }
  }

  const { shown, hiddenCount } = foldItems(items, FOLD_LIMIT, expanded);

  return (
    <section data-testid="memo-items" className="rounded-lg border bg-amber-50 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-sm font-medium text-amber-900">
        <Pin className="size-4" />
        {month.replace("-", "년 ")}월 주요사항
        {items.length > 0 ? <span className="text-xs font-normal text-amber-700">{items.length}건</span> : null}
      </div>
      {shown.length > 0 ? (
        <ul className="mb-2 space-y-0.5">
          {shown.map((item) => {
            const meta = [item.creator_name ?? "팀원", shortDate(item.created_at)].filter(Boolean).join(" · ");
            if (editing?.id === item.id) {
              return (
                <li key={item.id} className="rounded-md bg-white/70 px-1.5 py-1">
                  <Input
                    autoFocus
                    aria-label={`${month} 주요사항 고치기`}
                    maxLength={MEMO_ITEM_MAX}
                    value={editing.text}
                    onChange={(e) => setEditing({ id: item.id, text: e.target.value })}
                    onKeyDown={(e) => {
                      if (isSubmitEnter(e)) {
                        e.preventDefault();
                        void saveEdit();
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        cancelEdit();
                      }
                    }}
                    onBlur={() => {
                      // After a conflict only an explicit Enter saves over the teammate.
                      if (editingRef.current?.id === item.id && !editError) void saveEdit();
                    }}
                    className="h-7 border-amber-200 bg-white text-sm"
                  />
                  {editError ? (
                    <p role="alert" className="mt-0.5 text-[11px] text-red-700">
                      {editError}
                    </p>
                  ) : null}
                </li>
              );
            }
            return (
              <li key={item.id} className="group flex items-start gap-1 rounded-md px-1.5 py-1 hover:bg-white/60 focus-within:bg-white/60">
                <button
                  type="button"
                  title={item.content}
                  onClick={() => startEdit(item)}
                  className="min-w-0 flex-1 text-left text-sm text-amber-950"
                >
                  <span className="line-clamp-2 break-words">• {item.content}</span>
                  <span className="block text-[11px] text-amber-700">{meta}</span>
                </button>
                <button
                  type="button"
                  aria-label={`${item.content} 지우기`}
                  onClick={() => void remove(item)}
                  className="shrink-0 rounded p-1 text-amber-700 opacity-0 hover:text-red-700 focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      {items.length > FOLD_LIMIT ? (
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className="mb-2 px-1.5 text-xs text-amber-800 hover:underline"
        >
          {expanded ? "접기" : `${hiddenCount}건 더 보기`}
        </button>
      ) : null}
      <Input
        aria-label={`${month} 주요사항 추가`}
        maxLength={MEMO_ITEM_MAX}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (isSubmitEnter(e)) {
            e.preventDefault();
            void add();
          }
        }}
        placeholder="한 줄 추가 (Enter)"
        className="h-8 border-amber-200 bg-white/70 text-sm"
      />
    </section>
  );
}
