"use client";

import { Pin } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Textarea } from "@/components/ui/textarea";
import { getMemo, saveMemo } from "@/lib/queries";

interface MonthMemoProps {
  projectId: string;
  /** 'YYYY-MM' */
  month: string;
}

const SAVE_DELAY = 800;

/** 달력 아래 고정 메모 — 이번 달 주요 사항을 팀 전체가 같이 본다 */
export function MonthMemo({ projectId, month }: MonthMemoProps) {
  const [content, setContent] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    getMemo(projectId, month)
      .then((text) => {
        if (!cancelled) {
          setContent(text);
          setStatus("idle");
        }
      })
      .catch((error) =>
        toast.error(
          error instanceof Error
            ? error.message
            : "메모를 불러오지 못했습니다. 메모 테이블 SQL을 실행했는지 확인하세요.",
        ),
      );
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [projectId, month]);

  function handleChange(next: string) {
    setContent(next);
    setStatus("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        await saveMemo(projectId, month, next);
        setStatus("saved");
      } catch (error) {
        setStatus("idle");
        toast.error(error instanceof Error ? error.message : "메모를 저장하지 못했습니다.");
      }
    }, SAVE_DELAY);
  }

  return (
    <section className="rounded-lg border bg-amber-50 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-sm font-medium text-amber-900">
        <Pin className="size-4" />
        {month.replace("-", "년 ")}월 주요사항 (고정 메모)
        <span className="ml-auto text-xs font-normal text-amber-700">
          {status === "saving" ? "저장 중..." : status === "saved" ? "저장됨" : ""}
        </span>
      </div>
      <Textarea
        value={content}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={"이번 달 꼭 챙길 것\n- 중간보고 준비\n- 발주처 협의 일정 확정"}
        className="min-h-28 border-amber-200 bg-white/70"
      />
    </section>
  );
}
