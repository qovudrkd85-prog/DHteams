"use client";

import { Pin } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  getMemoSnapshot,
  MemoConflictError,
  saveMemoChecked,
  type MemoSnapshot,
} from "@/lib/queries";
import { memoLineCount, shouldRefreshMemo, type MemoStatus } from "@/lib/schedule-view";

interface MonthMemoProps {
  projectId: string;
  /** 'YYYY-MM' */
  month: string;
}

const SAVE_DELAY = 800;
const REFRESH_MS = 30000;
const saves = new Map<string, Promise<string>>();
// updated_at we last read or wrote per memo; a save only lands if the row still has it.
const bases = new Map<string, string | null>();
// Unsaved text left behind during a conflict (month switch or unmount).
// Coming back to that month shows the conflict again with this text.
const conflictDrafts = new Map<string, string>();

const memoKey = (projectId: string, month: string) => `${projectId}:${month}`;

// 같은 월의 저장은 순서대로 처리하고, 다시 열 때 마지막 저장을 기다린다.
// The base is read when the save actually runs, after earlier saves updated it.
function queueSave(projectId: string, month: string, content: string) {
  const key = memoKey(projectId, month);
  const request = (saves.get(key) ?? Promise.resolve())
    .catch(() => undefined)
    .then(async () => {
      const updatedAt = await saveMemoChecked(projectId, month, content, bases.get(key) ?? null);
      bases.set(key, updatedAt);
      return updatedAt;
    });
  saves.set(key, request);
  const clear = () => {
    if (saves.get(key) === request) saves.delete(key);
  };
  void request.then(clear, clear);
  return request;
}

function waitForSaves(key: string) {
  return (saves.get(key) ?? Promise.resolve()).catch(() => undefined);
}

/** 달력 아래 고정 메모 — 이번 달 주요 사항을 팀 전체가 같이 본다 */
export function MonthMemo({ projectId, month }: MonthMemoProps) {
  return <MonthMemoEditor key={memoKey(projectId, month)} projectId={projectId} month={month} />;
}

function MonthMemoEditor({ projectId, month }: MonthMemoProps) {
  const key = memoKey(projectId, month);
  const [content, setContent] = useState("");
  const [status, setStatusState] = useState<MemoStatus>("idle");
  const [latest, setLatest] = useState<MemoSnapshot | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<string | null>(null);
  const revision = useRef(0);
  const mounted = useRef(false);
  const loadedRef = useRef(false);
  const statusRef = useRef<MemoStatus>("idle");
  const conflict = useRef(false);
  const refreshSeq = useRef(0);
  const textarea = useRef<HTMLTextAreaElement | null>(null);

  // Keep a ref in step so event handlers see the status without a re-render.
  const setStatus = useCallback((next: MemoStatus) => {
    statusRef.current = next;
    setStatusState(next);
  }, []);

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    // During a conflict nothing is saved until the user picks a side.
    if (conflict.current) return;
    const next = pending.current;
    if (next === null) return;
    pending.current = null;
    const currentRevision = revision.current;
    void queueSave(projectId, month, next).then(
      () => {
        if (mounted.current && revision.current === currentRevision) setStatus("saved");
      },
      (error) => {
        const current = mounted.current && revision.current === currentRevision;
        if (error instanceof MemoConflictError) {
          if (current) {
            pending.current = pending.current ?? next;
            conflict.current = true;
            setLatest(error.latest);
            setStatus("conflict");
          }
          return;
        }
        if (current) {
          pending.current = next;
          setStatus("error");
        }
        toast.error(`${month} 메모: ${error instanceof Error ? error.message : "저장하지 못했습니다."}`);
      },
    );
  }, [projectId, month, setStatus]);

  // Pull a teammate's text only when nothing of ours could be lost.
  const refresh = useCallback(
    (fromBlur = false) => {
      if (!loadedRef.current) return;
      const ok = shouldRefreshMemo({
        visible: document.visibilityState === "visible",
        pending: pending.current !== null,
        status: statusRef.current,
        focused: !fromBlur && document.activeElement === textarea.current,
      });
      if (!ok) return;
      const seq = ++refreshSeq.current;
      const startRevision = revision.current;
      void waitForSaves(key)
        .then(() => getMemoSnapshot(projectId, month))
        .then(
          (snapshot) => {
            const stale =
              !mounted.current ||
              seq !== refreshSeq.current ||
              revision.current !== startRevision ||
              pending.current !== null ||
              conflict.current;
            if (stale) return;
            bases.set(key, snapshot.updatedAt);
            setContent(snapshot.content);
          },
          // Background refresh failures stay quiet; the next tick retries.
          () => undefined,
        );
    },
    [key, projectId, month],
  );

  useEffect(() => {
    let cancelled = false;
    mounted.current = true;
    // 이전 화면을 닫으면서 시작한 저장이 완료된 후 읽는다.
    waitForSaves(key)
      .then(() => getMemoSnapshot(projectId, month))
      .then((snapshot) => {
        if (!cancelled) {
          bases.set(key, snapshot.updatedAt);
          const draft = conflictDrafts.get(key);
          conflictDrafts.delete(key);
          if (draft !== undefined && draft !== snapshot.content) {
            // Resume the open conflict against the freshest teammate text.
            pending.current = draft;
            conflict.current = true;
            setContent(draft);
            setLatest(snapshot);
            setStatus("conflict");
          } else {
            setContent(snapshot.content);
            setStatus("idle");
          }
          setLoaded(true);
          loadedRef.current = true;
          setLoadError(false);
        }
      })
      .catch((error) => {
        if (cancelled) return;
        setLoadError(true);
        toast.error(
          error instanceof Error
            ? error.message
            : "메모를 불러오지 못했습니다.",
        );
      });
    return () => {
      cancelled = true;
      mounted.current = false;
      // flush() saves nothing during a conflict, so park the text for this month.
      if (conflict.current && pending.current !== null) conflictDrafts.set(key, pending.current);
      flush();
    };
  }, [key, projectId, month, loadAttempt, flush, setStatus]);

  // Teammates' edits arrive without a reload: every 30s and on focus.
  useEffect(() => {
    const seqRef = refreshSeq;
    const onVisible = () => refresh();
    const interval = window.setInterval(onVisible, REFRESH_MS);
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      seqRef.current++;
      window.clearInterval(interval);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  function handleChange(next: string) {
    setContent(next);
    revision.current += 1;
    pending.current = next;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    // Autosave stays off during a conflict; the text is kept as pending.
    if (conflict.current) return;
    setStatus("saving");
    timer.current = setTimeout(flush, SAVE_DELAY);
  }

  function keepMine() {
    if (!latest) return;
    conflictDrafts.delete(key);
    bases.set(key, latest.updatedAt);
    conflict.current = false;
    setLatest(null);
    pending.current = pending.current ?? content;
    setStatus("saving");
    flush();
  }

  function usePeer() {
    if (!latest) return;
    conflictDrafts.delete(key);
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    revision.current += 1;
    pending.current = null;
    bases.set(key, latest.updatedAt);
    conflict.current = false;
    setContent(latest.content);
    setLatest(null);
    setStatus("idle");
  }

  const statusLabel = !loaded
    ? loadError ? "불러오기 실패" : "불러오는 중..."
    : {
        idle: "",
        saving: "저장 중...",
        saved: "저장됨",
        error: "저장 실패",
        conflict: "다른 팀원이 먼저 수정했습니다",
      }[status];
  const lines = memoLineCount(content);

  return (
    <section className="rounded-lg border bg-amber-50 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-sm font-medium text-amber-900">
        <Pin className="size-4" />
        {month.replace("-", "년 ")}월 주요사항 (고정 메모)
        {lines > 0 ? <span className="text-xs font-normal text-amber-700">{lines}줄</span> : null}
        <span aria-live="polite" className="ml-auto text-xs font-normal text-amber-700">
          {statusLabel}
        </span>
        {loadError || status === "error" ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              if (loadError) setLoadAttempt((attempt) => attempt + 1);
              else {
                setStatus("saving");
                flush();
              }
            }}
          >
            다시 시도
          </Button>
        ) : null}
      </div>
      {latest ? (
        <div data-testid="memo-peer" className="mb-2 rounded-md border border-amber-300 bg-white p-2 text-sm">
          <div className="mb-1 flex flex-wrap items-center gap-1.5 text-xs font-medium text-amber-900">
            <span>동료가 저장한 내용</span>
            <Button type="button" size="sm" variant="outline" className="ml-auto" onClick={keepMine}>
              내 글로 저장
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={usePeer}>
              동료 내용 사용
            </Button>
          </div>
          <p className="max-h-32 overflow-y-auto whitespace-pre-wrap text-amber-950">
            {latest.content || "(비어 있음)"}
          </p>
        </div>
      ) : null}
      <Textarea
        ref={textarea}
        aria-label={`${month} 주요사항`}
        disabled={!loaded}
        maxLength={4000}
        value={content}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={() => {
          flush();
          refresh(true);
        }}
        placeholder={"이번 달 꼭 챙길 것\n- 중간보고 준비\n- 발주처 협의 일정 확정"}
        className="min-h-28 max-h-60 overflow-y-auto border-amber-200 bg-white/70"
      />
    </section>
  );
}
