"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ChevronLeft, LoaderCircle, Plus, Ticket } from "lucide-react";
import { toast } from "sonner";
import { useAccount } from "@/components/account/provider";
import { TeamForm, type TeamFormMode } from "@/components/account/team-gate";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// The single entry for teams in the header: my teams, then join / create.
export function TeamSwitcher() {
  const { account, teamAction } = useAccount();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<TeamFormMode | null>(null);
  const [busy, setBusy] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!busy && root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) setOpen(false); };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, busy]);

  if (!account?.team) return null;
  const current = account.team;
  const teams = account.teams?.length ? account.teams : [{ id: current.id, name: current.name, is_owner: current.is_owner }];

  async function switchTo(teamId: string, name: string) {
    if (teamId === current.id) { setOpen(false); return; }
    setBusy(true);
    setSwitching(teamId);
    try {
      await teamAction({ action: "switch", teamId });
      setOpen(false);
      toast.success(`${name} 팀으로 바꿨습니다.`);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "팀을 바꾸지 못했습니다.");
    } finally {
      setBusy(false);
      setSwitching(null);
    }
  }

  return (
    <div ref={root} className="relative min-w-0">
      <Button type="button" variant="ghost" size="sm" aria-haspopup="menu" aria-expanded={open} aria-label={`팀 바꾸기, 지금 팀: ${current.name}`}
        onClick={() => { setOpen((value) => !value); setForm(null); }} className="max-w-40 gap-1 px-2 text-teal-900 sm:max-w-56">
        <span className="truncate font-medium">{current.name}</span>
        <ChevronDown className="size-3.5 shrink-0" />
      </Button>
      {open && (
        <div role="menu" aria-label="팀 바꾸기" className="absolute left-0 top-full z-30 mt-1 w-[min(18rem,calc(100vw-1.5rem))] rounded-xl border bg-background p-1.5 shadow-lg">
          {form ? (
            <div className="space-y-3 p-2">
              <p className="text-sm font-semibold text-teal-900">{form === "join" ? "초대코드로 참가" : "새 팀 만들기"}</p>
              <TeamForm key={form} mode={form} idPrefix="team-menu" onBusyChange={setBusy} onDone={() => { setOpen(false); setForm(null); }}
                leading={<Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setForm(null)}><ChevronLeft className="size-3.5" />뒤로</Button>} />
            </div>
          ) : (
            <>
              <p className="px-2 pb-1 pt-1.5 text-[11px] text-slate-500">내 팀 {teams.length}개</p>
              <div className="max-h-[50vh] overflow-y-auto">
                {teams.map((team) => (
                  <button type="button" role="menuitemradio" aria-checked={team.id === current.id} key={team.id} disabled={busy}
                    onClick={() => void switchTo(team.id, team.name)}
                    className={cn("flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-slate-100 disabled:opacity-60", team.id === current.id && "font-semibold text-teal-900")}>
                    <span className="flex size-4 shrink-0 items-center justify-center">
                      {switching === team.id ? <LoaderCircle className="size-3.5 animate-spin" /> : team.id === current.id && <Check className="size-3.5" />}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{team.name}</span>
                    {team.is_owner && <span className="shrink-0 rounded bg-teal-50 px-1.5 py-0.5 text-[10px] text-teal-800">팀장</span>}
                  </button>
                ))}
              </div>
              <div role="separator" className="my-1 border-t" />
              <button type="button" role="menuitem" disabled={busy} onClick={() => setForm("join")} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-slate-100"><Ticket className="size-4 text-slate-500" />초대코드로 참가</button>
              <button type="button" role="menuitem" disabled={busy} onClick={() => setForm("create")} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-slate-100"><Plus className="size-4 text-slate-500" />새 팀 만들기</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
