"use client";

import { LogIn, LogOut, Users, Check, RefreshCw, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Attendance } from "@/lib/team/workspace";
import type { TeamWorkspaceState } from "@/lib/team/use-team-workspace";
import { cn } from "@/lib/utils";

function time(value: string) {
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}
function status(record?: Attendance | null) {
  return record?.checked_out_at ? "퇴근" : record ? "근무 중" : "미출근";
}

export function TeamPanel({ workspace: w }: { workspace: TeamWorkspaceState }) {
  const present = w.attendance.filter((row) => !row.checked_out_at).length;
  const ready = !w.loading && !w.error;

  return (
    <section aria-label="팀원과 출퇴근" className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-4">
        <Users className="size-4 text-teal-700" />
        <h2 className="font-semibold text-slate-900">우리 팀</h2>
        <span className="ml-auto rounded-full bg-teal-50 px-2 py-1 text-[11px] font-medium text-teal-700">{ready ? `${present}명 근무 중` : "확인 중"}</span>
      </div>
      <div className="p-5">
        <div className="mb-3 flex items-center justify-between text-xs text-slate-500">
          <span>{w.today.replaceAll("-", ". ")} · 한국 시간</span>
          <button type="button" className="rounded p-1 hover:bg-slate-100" aria-label="출퇴근 새로고침" disabled={w.busy} onClick={() => void w.refresh()}><RefreshCw className="size-3.5" /></button>
        </div>
        {w.error ? (
          <div role="alert" className="rounded-xl bg-amber-50 p-3 text-xs leading-6 text-amber-900">{w.error}<Button variant="outline" size="sm" className="mt-2 block" onClick={() => void w.refresh()}>다시 시도</Button></div>
        ) : w.loading ? <p className="py-4 text-sm text-slate-500">팀원을 불러오는 중…</p> : w.currentMember && (
          <div className="rounded-xl bg-[#f1f6f1] p-4">
            <div className="flex items-center gap-3">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl border-2 bg-white text-2xl" style={{ borderColor: w.currentMember.color }}>{w.currentMember.avatar}</span>
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{w.currentMember.name} <span className="text-xs font-normal text-teal-700">나</span></p><p className="mt-1 truncate text-xs text-slate-500">{w.currentMember.role || "팀원"}</p></div>
              <span className="shrink-0 text-xs text-teal-800">{status(w.myAttendance)}</span>
            </div>
            <Button className="mt-4 w-full bg-teal-800 text-white hover:bg-teal-900" disabled={w.busy || !w.currentMember.profile_completed || !!w.myAttendance?.checked_out_at} onClick={() => void w.markAttendance()}>
              {w.myAttendance?.checked_out_at ? <Check className="size-4" /> : w.myAttendance ? <LogOut className="size-4" /> : <LogIn className="size-4" />}
              {w.busy ? "기록 중…" : w.myAttendance?.checked_out_at ? "오늘 퇴근 완료" : w.myAttendance ? "퇴근하기" : "출근하기"}
            </Button>
            {w.myAttendance && <p className="mt-2 text-center text-[11px] text-slate-500">출근 {time(w.myAttendance.checked_in_at)}{w.myAttendance.checked_out_at && ` · 퇴근 ${time(w.myAttendance.checked_out_at)}`}</p>}
            <button type="button" disabled={w.busy} className="mt-3 flex w-full items-center justify-center gap-1 text-xs text-slate-500 underline underline-offset-4" onClick={() => w.setProfileOpen(true)}><Settings className="size-3" />내 프로필 수정</button>
          </div>
        )}
        {ready && <>
          <p className="mb-2 mt-5 text-xs font-medium text-slate-500">팀원 {w.members.length}명</p>
          <div className="max-h-64 space-y-1 overflow-y-auto">
            {w.members.length === 0 ? <p className="py-3 text-xs text-slate-400">회원가입한 팀원이 여기에 표시됩니다.</p> : w.members.map((member) => {
              const record = w.attendance.find((row) => row.member_id === member.id);
              return <div key={member.id} className="flex items-center gap-2.5 rounded-lg py-2" data-member-id={member.id}>
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full border-2 bg-slate-50 text-lg" style={{ borderColor: member.color }}>{member.avatar}</span>
                <div className="min-w-0 flex-1"><p className="truncate text-xs font-medium text-slate-700">{member.name}{member.id === w.currentMember?.id && <span className="ml-1 text-teal-600">· 나</span>}</p><p className="truncate text-[10px] text-slate-400">{member.role || "팀원"}{record && ` · ${time(record.checked_in_at)} 출근`}{record?.checked_out_at && ` · ${time(record.checked_out_at)} 퇴근`}</p></div>
                <span className={cn("flex shrink-0 items-center gap-1 text-[11px]", record && !record.checked_out_at ? "text-teal-700" : "text-slate-400")}><span className={cn("size-1.5 rounded-full", record && !record.checked_out_at ? "bg-teal-500" : "bg-slate-300")} />{status(record)}</span>
              </div>;
            })}
          </div>
          <p className="mt-3 text-[10px] leading-5 text-slate-400">각자 로그인한 계정으로 출퇴근 체크 · 30초마다 갱신</p>
        </>}
      </div>
    </section>
  );
}
