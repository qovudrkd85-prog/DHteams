"use client";

import { Pin } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { getMemo, saveMemo } from "@/lib/queries";

interface MonthMemoProps {
  projectId: string;
  /** 'YYYY-MM' */
  month: string;
}

const SAVE_DELAY = 800;
const saves = new Map<string, Promise<void>>();

// 같은 월의 저장은 순서대로 처리하고, 다시 열 때 마지막 저장을 기다린다.
function queueSave(projectId: string, month: string, content: string) {
  const key = `${projectId}:${month}`;
  const request = (saves.get(key) ?? Promise.resolve())
    .catch(() => undefined)
    .then(() => saveMemo(projectId, month, content));
  saves.set(key, request);
  const clear = () => {
    if (saves.get(key) === request) saves.delete(key);
  };
  void request.then(clear, clear);
  return request;
}

/** 달력 아래 고정 메모 — 이번 달 주요 사항을 팀 전체가 같이 본다 */
export function MonthMemo({ projectId, month }: MonthMemoProps) {
  return <MonthMemoEditor key={`${projectId}:${month}`} projectId={projectId} month={month} />;
}

function MonthMemoEditor({ projectId, month }: MonthMemoProps) {
  const [content, setContent] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<string | null>(null);
  const revision = useRef(0);
  const mounted = useRef(false);

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const next = pending.current;
    if (next === null) return;
    pending.current = null;
    const currentRevision = revision.current;
    void queueSave(projectId, month, next).then(
      () => {
        if (mounted.current && revision.current === currentRevision) setStatus("saved");
      },
      (error) => {
        if (mounted.current && revision.current === currentRevision) {
          pending.current = next;
          setStatus("error");
        }
        toast.error(`${month} 메모: ${error instanceof Error ? error.message : "저장하지 못했습니다."}`);
      },
    );
  }, [projectId, month]);

  useEffect(() => {
    let cancelled = false;
    mounted.current = true;
    // 이전 화면을 닫으면서 시작한 저장이 완료된 후 읽는다.
    (saves.get(`${projectId}:${month}`) ?? Promise.resolve())
      .catch(() => undefined)
      .then(() => getMemo(projectId, month))
      .then((text) => {
        if (!cancelled) {
          setContent(text);
          setStatus("idle");
          setLoaded(true);
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
      flush();
    };
  }, [projectId, month, loadAttempt, flush]);

  function handleChange(next: string) {
    setContent(next);
    setStatus("saving");
    revision.current += 1;
    pending.current = next;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_DELAY);
  }

  const statusLabel = !loaded
    ? loadError ? "불러오기 실패" : "불러오는 중..."
    : { idle: "", saving: "저장 중...", saved: "저장됨", error: "저장 실패" }[status];

  return (
    <section className="rounded-lg border bg-amber-50 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-sm font-medium text-amber-900">
        <Pin className="size-4" />
        {month.replace("-", "년 ")}월 주요사항 (고정 메모)
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
      <Textarea
        aria-label={`${month} 주요사항`}
        disabled={!loaded}
        maxLength={4000}
        value={content}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={flush}
        placeholder={"이번 달 꼭 챙길 것\n- 중간보고 준비\n- 발주처 협의 일정 확정"}
        className="min-h-28 border-amber-200 bg-white/70"
      />
    </section>
  );
}
