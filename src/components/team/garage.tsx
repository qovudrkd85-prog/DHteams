"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { Waves } from "lucide-react";
import { DepartmentCalendar } from "@/components/department-calendar";
import { TeamPanel } from "@/components/team/panel";
import { HealingOverlay } from "@/components/team/healing/healing-overlay";
import type { TeamWorkspaceState } from "@/lib/team/use-team-workspace";

interface GarageProps {
  workspace: TeamWorkspaceState;
}

/** Personal garage: my status card and my private calendar. */
export function Garage({ workspace }: GarageProps) {
  return (
    <section className="space-y-5" aria-label="내 정비실" data-testid="garage">
      <TeamPanel workspace={workspace} />
      <div className="rounded-2xl border border-slate-200 bg-white p-2 shadow-sm sm:p-5" data-testid="garage-calendar">
        <DepartmentCalendar
          members={workspace.members}
          currentMember={workspace.error ? null : workspace.currentMember}
          onRegister={() => workspace.setProfileOpen(true)}
          fixedScope="private"
        />
      </div>
    </section>
  );
}

/** Side card that opens the healing time view. */
export function HealingCard() {
  const [open, setOpen] = useState(false);
  return (
    <section className="rounded-2xl bg-gradient-to-br from-sky-700 to-teal-700 p-5 text-white shadow-sm" aria-label="힐링 타임">
      <h2 className="flex items-center gap-2 font-semibold"><Waves className="size-4" /> 힐링 타임</h2>
      <p className="mt-2 text-xs leading-5 text-sky-50">잠깐 쉬어 가요. 바닷가·낚시터·옥상 같은 곳에서 숨 돌리기.</p>
      <button
        type="button"
        className="mt-4 w-full rounded-xl bg-white/95 py-2 text-sm font-semibold text-teal-800 hover:bg-white"
        data-testid="healing-open"
        onClick={() => setOpen(true)}
      >
        힐링 타임 나가기
      </button>
      {/* Portal: the sticky aside is its own stacking context, so z-index alone stays under the header. */}
      {open && createPortal(<HealingOverlay onClose={() => setOpen(false)} />, document.body)}
    </section>
  );
}
