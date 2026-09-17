"use client";

import { useState } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { ArrowUpRight, CalendarDays, X } from "lucide-react";

import { DepartmentCalendar } from "@/components/department-calendar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogDescription, DialogHeader, DialogPortal, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import type { TeamWorkspaceState } from "@/lib/team/use-team-workspace";

export function CalendarLauncher({ workspace }: { workspace: TeamWorkspaceState }) {
  const [open, setOpen] = useState(false);
  const [visited, setVisited] = useState(false);
  const date = new Intl.DateTimeFormat("ko-KR", {
    month: "long", day: "numeric", weekday: "short", timeZone: "Asia/Seoul",
  }).format(new Date(`${workspace.today}T12:00:00+09:00`));

  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (next) setVisited(true); }}>
      <DialogTrigger aria-label="일정 확인하기" className="group flex items-center gap-3 rounded-2xl border border-teal-200 bg-white px-4 py-2.5 text-left shadow-sm transition-colors hover:border-teal-400 hover:bg-teal-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-700"><CalendarDays className="size-5" /></span>
        <span><span className="block text-[10px] leading-4 text-slate-500">{date} · 우리 팀 달력</span><span className="block text-sm font-semibold text-teal-900">일정 확인하기</span></span>
        <ArrowUpRight className="ml-2 size-4 text-teal-500 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
      </DialogTrigger>
      <DialogPortal keepMounted={visited}>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-40 bg-slate-900/25 backdrop-blur-sm data-closed:hidden" />
        <DialogPrimitive.Popup className="fixed left-1/2 top-1/2 z-40 flex h-[90dvh] w-[96vw] max-w-[1500px] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-[#f5f7f5] shadow-2xl outline-none data-closed:hidden" data-testid="team-calendar-dialog">
          <div className="flex shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 py-4 sm:px-6">
            <DialogHeader className="min-w-0 flex-1">
              <DialogTitle className="text-base font-semibold text-slate-900">우리 팀 공유 달력</DialogTitle>
              <DialogDescription className="text-xs text-slate-500">업무·회의·휴가를 확인하고, 팀원의 일정을 함께 계획해요.</DialogDescription>
            </DialogHeader>
            <DialogClose render={<Button type="button" variant="ghost" size="sm" />} aria-label="달력 닫기"><X className="size-4" /><span className="hidden sm:inline">닫기</span></DialogClose>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2 sm:p-5">
            <DepartmentCalendar
              members={workspace.members}
              currentMember={workspace.error ? null : workspace.currentMember}
              onRegister={() => { setOpen(false); workspace.setProfileOpen(true); }}
            />
          </div>
        </DialogPrimitive.Popup>
      </DialogPortal>
    </Dialog>
  );
}
