"use client";

import { useState } from "react";
import { Copy, DoorOpen, LoaderCircle, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useAccount } from "@/components/account/provider";
import { Button } from "@/components/ui/button";
import type { TeamSpace } from "@/lib/account/types";

interface TeamSettingsProps {
  team: TeamSpace;
  busy: boolean;
  setBusy: (busy: boolean) => void;
}

const formatCode = (code: string): string => `${code.slice(0, 4)}-${code.slice(4)}`;

export function TeamSettings({ team, busy, setBusy }: TeamSettingsProps) {
  const { teamAction, setSettingsOpen } = useAccount();
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: "regenerate" | "leave") {
    setBusy(true);
    setError(null);
    try {
      await teamAction({ action });
      if (action === "leave") {
        setSettingsOpen(false);
        toast.success(`${team.name} 팀에서 나왔습니다. 내 개인 일정은 그대로 남아 있습니다.`);
      } else {
        toast.success("새 초대코드를 만들었습니다. 이전 코드로는 더 이상 참가할 수 없습니다.");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "팀 요청을 처리하지 못했습니다.");
    } finally {
      setBusy(false);
      setConfirmLeave(false);
    }
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(team.invite_code);
      toast.success("초대코드를 복사했습니다.");
    } catch {
      setError("복사하지 못했습니다. 코드를 직접 적어 전달해 주세요.");
    }
  }

  return (
    <div className="space-y-4 pb-1">
      <div className="rounded-xl bg-[#f1f6f1] p-3">
        <p className="text-xs text-slate-500">현재 팀</p>
        <p className="mt-1 truncate text-sm font-semibold text-teal-900">{team.name}{team.is_owner && <span className="ml-2 rounded bg-teal-100 px-1.5 py-0.5 text-[11px] font-medium text-teal-800">만든 사람</span>}</p>
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium">초대코드</p>
        <div className="flex items-center gap-2">
          <code className="flex-1 rounded-lg bg-slate-50 px-3 py-2 text-center font-mono text-base tracking-[0.3em] text-slate-800" data-testid="team-invite-code">{formatCode(team.invite_code)}</code>
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void copyCode()}><Copy className="size-3.5" />복사</Button>
        </div>
        <p className="text-[11px] leading-5 text-slate-500">이 코드를 아는 사람은 누구나 팀에 참가할 수 있습니다. 코드가 퍼졌다면 새 코드를 만드세요.</p>
        {team.can_rotate_code && <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void run("regenerate")}>{busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}새 초대코드 만들기</Button>}
      </div>
      <div className="space-y-2 border-t pt-4">
        {confirmLeave ? (
          <div className="space-y-2 rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-900" role="alert">
            <p>팀을 나가면 이 팀의 과업·사무실·팀 일정을 볼 수 없고, 내 자리도 비워집니다. 다시 들어오려면 초대코드가 필요합니다. 내 개인 일정은 남습니다.</p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setConfirmLeave(false)}>취소</Button>
              <Button type="button" size="sm" disabled={busy} className="bg-red-700 text-white hover:bg-red-800" onClick={() => void run("leave")}>{busy && <LoaderCircle className="size-3.5 animate-spin" />}팀 나가기</Button>
            </div>
          </div>
        ) : (
          <Button type="button" variant="ghost" size="sm" disabled={busy} className="text-red-700" onClick={() => setConfirmLeave(true)}><DoorOpen className="size-3.5" />팀 나가기</Button>
        )}
      </div>
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-xs leading-6 text-red-700">{error}</p>}
    </div>
  );
}
