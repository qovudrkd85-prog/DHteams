"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, ChevronLeft, LoaderCircle, Plus, Ticket } from "lucide-react";
import { toast } from "sonner";
import { useAccount } from "@/components/account/provider";
import { TeamForm, type TeamFormMode } from "@/components/account/team-gate";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const PHONE_WIDTH = 640;

// The single entry for teams in the header: my teams, then join / create.
// Disclosure pattern (button + panel), not an ARIA menu: the panel also holds a small form.
export function TeamSwitcher() {
  const { account, teamAction } = useAccount();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<TeamFormMode | null>(null);
  const [busy, setBusy] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  // Phones: the panel spans the screen under the button instead of hanging off its left edge.
  const [phoneTop, setPhoneTop] = useState<number | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const currentItem = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  const close = (returnFocus: boolean) => {
    setOpen(false);
    setForm(null);
    if (returnFocus) trigger.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!busy && root.current && !root.current.contains(event.target as Node)) { setOpen(false); setForm(null); }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || busy) return;
      setOpen(false);
      setForm(null);
      trigger.current?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, busy]);

  useEffect(() => { if (open && !form) currentItem.current?.focus(); }, [open, form]);

  if (!account?.team) return null;
  const current = account.team;
  const teams = account.teams?.length ? account.teams : [{ id: current.id, name: current.name, is_owner: current.is_owner }];

  function toggle() {
    if (open) { close(false); return; }
    const rect = trigger.current?.getBoundingClientRect();
    setPhoneTop(rect && window.innerWidth < PHONE_WIDTH ? Math.round(rect.bottom + 4) : null);
    setForm(null);
    setOpen(true);
  }

  async function switchTo(teamId: string, name: string) {
    if (busy) return;
    if (teamId === current.id) { close(true); return; }
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

  const item = "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-slate-100 aria-disabled:opacity-60";
  return (
    <div ref={root} className="relative min-w-0"
      onBlur={(event) => { if (open && !busy && !event.currentTarget.contains(event.relatedTarget as Node | null) && event.relatedTarget) close(false); }}>
      <Button ref={trigger} type="button" variant="ghost" size="sm" aria-expanded={open} aria-controls={panelId} aria-label={`팀 바꾸기, 지금 팀: ${current.name}`}
        onClick={toggle} className="max-w-40 gap-1 px-2 text-teal-900 sm:max-w-56">
        <span className="truncate font-medium">{current.name}</span>
        <ChevronDown className="size-3.5 shrink-0" />
      </Button>
      {open && (
        <div id={panelId} role="group" aria-label="팀 바꾸기" style={phoneTop === null ? undefined : { top: phoneTop }}
          className={cn("z-30 rounded-xl border bg-background p-1.5 shadow-lg",
            phoneTop === null ? "absolute left-0 top-full mt-1 w-72" : "fixed inset-x-3")}>
          {form ? (
            <div className="space-y-3 p-2">
              <p className="text-sm font-semibold text-teal-900">{form === "join" ? "초대코드로 참가" : "새 팀 만들기"}</p>
              <TeamForm key={form} mode={form} idPrefix="team-menu" onBusyChange={setBusy} onDone={() => close(false)}
                leading={<Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setForm(null)}><ChevronLeft className="size-3.5" />뒤로</Button>} />
            </div>
          ) : (
            <>
              <p className="px-2 pb-1 pt-1.5 text-[11px] text-slate-500">내 팀 {teams.length}개</p>
              <ul className="max-h-[50vh] overflow-y-auto" aria-label="내 팀">
                {teams.map((team) => (
                  <li key={team.id}>
                    <button type="button" ref={team.id === current.id ? currentItem : undefined} aria-current={team.id === current.id ? "true" : undefined}
                      aria-disabled={busy || undefined} onClick={() => void switchTo(team.id, team.name)}
                      className={cn(item, team.id === current.id && "font-semibold text-teal-900")}>
                      <span className="flex size-4 shrink-0 items-center justify-center">
                        {switching === team.id ? <LoaderCircle className="size-3.5 animate-spin" /> : team.id === current.id && <Check className="size-3.5" />}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{team.name}</span>
                      {team.is_owner && <span className="shrink-0 rounded bg-teal-50 px-1.5 py-0.5 text-[10px] text-teal-800">팀장</span>}
                    </button>
                  </li>
                ))}
              </ul>
              <div className="my-1 border-t" />
              <button type="button" aria-disabled={busy || undefined} onClick={() => { if (!busy) setForm("join"); }} className={item}><Ticket className="size-4 text-slate-500" />초대코드로 참가</button>
              <button type="button" aria-disabled={busy || undefined} onClick={() => { if (!busy) setForm("create"); }} className={item}><Plus className="size-4 text-slate-500" />새 팀 만들기</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
