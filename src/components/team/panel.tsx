"use client";

import { useId, useState } from "react";
import { LogIn, LogOut, Users, Check, RefreshCw, Settings, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Attendance } from "@/lib/team/workspace";
import type { TeamWorkspaceState } from "@/lib/team/use-team-workspace";
import { cn } from "@/lib/utils";

function time(value: string) {
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}
function status(record?: Attendance | null) {
  return record?.checked_out_at ? "퇴근" : record ? "근무 중" : "미출근";
}

function StatusEditor({ saved, disabled, onSave, compact = false }: { saved: string; disabled: boolean; onSave: (value: string) => Promise<void>; compact?: boolean }) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const value = draft ?? saved;
  const save = async (next: string) => {
    if (saving || disabled) return;
    setSaving(true);
    setError(null);
    setNotice("");
    try {
      await onSave(next.trim());
      setDraft(null);
      setNotice(next.trim() ? "상태 메시지를 저장했어요." : "상태 메시지를 지웠어요.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "상태 메시지를 저장하지 못했습니다. 다시 시도해 주세요.");
    } finally { setSaving(false); }
  };
  const onChange = (next: string) => { setDraft(Array.from(next).slice(0, 60).join("")); setError(null); setNotice(""); };
  if (compact) {
    // One line: input + save. Saving an empty field clears the message.
    return (
      <form className="mt-2" onSubmit={(event) => { event.preventDefault(); void save(value); }}>
        <div className="flex items-center gap-2">
          <Input id={id} value={value} maxLength={120} disabled={disabled || saving} placeholder="상태 메시지 한 줄" aria-label="내 상태 메시지" aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined} className="h-10 bg-white text-xs sm:h-8" onChange={(event) => onChange(event.target.value)} />
          <Button type="submit" size="sm" className="h-10 shrink-0 bg-teal-800 px-3 text-xs text-white hover:bg-teal-900 sm:h-8" disabled={disabled || saving || value.trim() === saved}>{saving ? "저장 중…" : "저장"}</Button>
        </div>
        {error && <p id={`${id}-error`} role="alert" className="mt-1 text-xs leading-5 text-red-700">{error}</p>}
        <p role="status" className="sr-only">{notice}</p>
      </form>
    );
  }
  return (
    <form className="mt-4 border-t border-teal-900/10 pt-3" onSubmit={(event) => { event.preventDefault(); void save(value); }}>
      <label htmlFor={id} className="mb-2 flex items-center gap-1.5 text-xs font-medium text-teal-900"><MessageSquare className="size-3.5" />내 상태 메시지</label>
      <Input id={id} value={value} maxLength={120} disabled={disabled || saving} placeholder="집중 작업 중 · 3시에 답할게요" aria-describedby={`${id}-count${error ? ` ${id}-error` : ""}`} aria-invalid={!!error} className="bg-white text-xs" onChange={(event) => onChange(event.target.value)} />
      <div className="mt-2 flex items-center gap-2">
        <span id={`${id}-count`} className="mr-auto text-[10px] text-slate-500">{Array.from(value).length}/60자</span>
        <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs text-slate-500" disabled={disabled || saving || !saved} onClick={() => void save("")}>지우기</Button>
        <Button type="submit" size="sm" className="h-7 bg-teal-800 px-3 text-xs text-white hover:bg-teal-900" disabled={disabled || saving || value.trim() === saved}>{saving ? "저장 중…" : "저장"}</Button>
      </div>
      {error && <p id={`${id}-error`} role="alert" className="mt-2 text-xs leading-5 text-red-700">{error}</p>}
      <p role="status" className="mt-1 text-[10px] leading-5 text-teal-700">{notice || "팀원 목록과 내 캐릭터에서 함께 볼 수 있어요."}</p>
    </form>
  );
}

function attendanceLabel(w: TeamWorkspaceState) {
  return w.busy ? "기록 중…" : w.myAttendance?.checked_out_at ? "오늘 퇴근 완료" : w.myAttendance ? "퇴근하기" : "출근하기";
}

function attendanceIcon(w: TeamWorkspaceState) {
  return w.myAttendance?.checked_out_at ? <Check className="size-4" /> : w.myAttendance ? <LogOut className="size-4" /> : <LogIn className="size-4" />;
}

function CompactRoster({ w }: { w: TeamWorkspaceState }) {
  return (
    <ul className="mt-3 max-h-40 space-y-0.5 overflow-y-auto" aria-label={`팀원 ${w.members.length}명`}>
      {w.members.length === 0 ? <li className="py-2 text-xs text-slate-400">회원가입한 팀원이 여기에 표시됩니다.</li> : w.members.map((member) => {
        const record = w.attendance.find((row) => row.member_id === member.id);
        const working = Boolean(record && !record.checked_out_at);
        return <li key={member.id} className="flex items-center gap-2 py-1 text-xs" data-member-id={member.id}>
          <span className="text-base leading-none">{member.avatar}</span>
          <span className="shrink-0 font-medium text-slate-700">{member.name}{member.id === w.currentMember?.id && <span className="text-teal-600"> · 나</span>}</span>
          <span className="min-w-0 flex-1 truncate text-[11px] text-teal-800" title={member.status_message ?? undefined}>{member.status_message}</span>
          <span className={cn("flex shrink-0 items-center gap-1 text-[11px]", working ? "text-teal-700" : "text-slate-400")}><span className={cn("size-1.5 rounded-full", working ? "bg-teal-500" : "bg-slate-300")} />{status(record)}</span>
        </li>;
      })}
    </ul>
  );
}

/** Small "our team" card for the garage side column: my line with a small check-in button, one-line status, short roster. */
function CompactTeamPanel({ workspace: w }: { workspace: TeamWorkspaceState }) {
  const present = w.attendance.filter((row) => !row.checked_out_at).length;
  const ready = !w.loading && !w.error;
  const me = w.currentMember;
  return (
    <section aria-label="팀원과 출퇴근" data-compact="true" className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-2">
        <Users className="size-4 text-teal-700" />
        <h2 className="text-sm font-semibold text-slate-900">우리 팀</h2>
        <span className="ml-auto rounded-full bg-teal-50 px-2 py-0.5 text-[11px] font-medium text-teal-700">{ready ? `${present}명 근무 중` : "확인 중"}</span>
        <button type="button" className="flex size-10 items-center justify-center rounded hover:bg-slate-100 sm:size-7" aria-label="출퇴근 새로고침" disabled={w.busy} onClick={() => void w.refresh()}><RefreshCw className="size-3.5" /></button>
      </div>
      <div className="p-4">
        {w.error ? (
          <div role="alert" className="rounded-xl bg-amber-50 p-3 text-xs leading-6 text-amber-900">{w.error}<Button variant="outline" size="sm" className="mt-2 block" onClick={() => void w.refresh()}>다시 시도</Button></div>
        ) : w.loading ? <p className="py-2 text-sm text-slate-500">팀원을 불러오는 중…</p> : me && (
          <div className="rounded-xl bg-[#f1f6f1] p-3">
            <div className="flex items-center gap-2">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border-2 bg-white text-xl" style={{ borderColor: me.color }}>{me.avatar}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{me.name} <span className="text-xs font-normal text-teal-700">· 나</span></p>
                <p className="truncate text-[11px] text-slate-500">{status(w.myAttendance)}{w.myAttendance && ` · 출근 ${time(w.myAttendance.checked_in_at)}`}{w.myAttendance?.checked_out_at && ` · 퇴근 ${time(w.myAttendance.checked_out_at)}`}</p>
              </div>
              <Button size="sm" className="h-10 shrink-0 bg-teal-800 px-3 text-xs text-white hover:bg-teal-900 sm:h-8" disabled={w.busy || w.statusBusy || !me.profile_completed || !!w.myAttendance?.checked_out_at} onClick={() => void w.markAttendance()}>
                {attendanceIcon(w)}{attendanceLabel(w)}
              </Button>
              <button type="button" disabled={w.busy} className="flex size-10 shrink-0 items-center justify-center rounded text-slate-500 hover:bg-white sm:size-7" aria-label="내 프로필 수정" title="내 프로필 수정" onClick={() => w.setProfileOpen(true)}><Settings className="size-3.5" /></button>
            </div>
            <StatusEditor key={me.id} compact saved={me.status_message ?? ""} disabled={w.busy} onSave={w.saveStatus} />
          </div>
        )}
        {ready && <CompactRoster w={w} />}
      </div>
    </section>
  );
}

export function TeamPanel({ workspace: w, compact = false }: { workspace: TeamWorkspaceState; compact?: boolean }) {
  if (compact) return <CompactTeamPanel workspace={w} />;
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
            <Button className="mt-4 w-full bg-teal-800 text-white hover:bg-teal-900" disabled={w.busy || w.statusBusy || !w.currentMember.profile_completed || !!w.myAttendance?.checked_out_at} onClick={() => void w.markAttendance()}>
              {attendanceIcon(w)}
              {attendanceLabel(w)}
            </Button>
            {w.myAttendance && <p className="mt-2 text-center text-[11px] text-slate-500">출근 {time(w.myAttendance.checked_in_at)}{w.myAttendance.checked_out_at && ` · 퇴근 ${time(w.myAttendance.checked_out_at)}`}</p>}
            <StatusEditor key={w.currentMember.id} saved={w.currentMember.status_message ?? ""} disabled={w.busy} onSave={w.saveStatus} />
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
                <div className="min-w-0 flex-1"><p className="truncate text-xs font-medium text-slate-700">{member.name}{member.id === w.currentMember?.id && <span className="ml-1 text-teal-600">· 나</span>}</p><p className="truncate text-[10px] text-slate-400">{member.role || "팀원"}{record && ` · ${time(record.checked_in_at)} 출근`}{record?.checked_out_at && ` · ${time(record.checked_out_at)} 퇴근`}</p>{member.status_message && <p className="mt-1 break-words text-[11px] leading-4 text-teal-800" title={member.status_message}>{member.status_message}</p>}</div>
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
