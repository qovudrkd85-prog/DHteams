"use client";

import { useState } from "react";
import { LoaderCircle, LogOut, Plus, Ticket } from "lucide-react";
import { toast } from "sonner";
import { useAccount } from "@/components/account/provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type GateMode = "join" | "create";

// Shown after profile setup when the account has no team yet.
export function TeamGate() {
  const { account, teamAction, signOut } = useAccount();
  const [mode, setMode] = useState<GateMode>("join");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const trimmedName = name.trim();
    const cleanCode = code.replace(/[\s-]/g, "").toUpperCase();
    if (mode === "create" && (!trimmedName || Array.from(trimmedName).length > 40)) { setError("팀 이름은 1~40자로 입력해 주세요."); return; }
    if (mode === "join" && !/^[A-HJKMNP-Z2-9]{8}$/.test(cleanCode)) { setError("초대코드 8자리를 확인해 주세요."); return; }
    setBusy(true);
    setError(null);
    try {
      await teamAction(mode === "create" ? { action: "create", name: trimmedName } : { action: "join", code: cleanCode });
      toast.success(mode === "create" ? `${trimmedName} 팀을 만들었습니다. 설정 > 팀에서 초대코드를 확인하세요.` : "팀에 참가했습니다.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "팀 요청을 처리하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setBusy(true);
    try { await signOut(); } catch (cause) { setError(cause instanceof Error ? cause.message : "로그아웃하지 못했습니다."); } finally { setBusy(false); }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#f5f7f1] p-6">
      <form onSubmit={submit} className="w-full max-w-sm space-y-5 rounded-2xl bg-white p-6 shadow-sm" aria-labelledby="team-gate-title">
        <div className="space-y-1">
          <h1 id="team-gate-title" className="text-lg font-semibold text-teal-900">우리 팀 공간 들어가기</h1>
          <p className="text-xs leading-5 text-slate-500">{account?.member.name}님, 팀원에게 받은 초대코드로 참가하거나 새 팀을 만들어 주세요. 과업·사무실·팀 일정은 같은 팀끼리만 보입니다.</p>
        </div>
        <div className="flex rounded-lg bg-slate-100 p-1" aria-label="팀 참가 방법">
          {(["join", "create"] as const).map((item) => (
            <button type="button" key={item} disabled={busy} aria-pressed={mode === item} onClick={() => { setMode(item); setError(null); }} className={cn("flex-1 rounded-md py-2 text-sm text-slate-500", mode === item && "bg-white text-teal-800 shadow-sm")}>
              {item === "join" ? "초대코드로 참가" : "새 팀 만들기"}
            </button>
          ))}
        </div>
        <fieldset disabled={busy} className="space-y-2">
          {mode === "join" ? (
            <><Label htmlFor="team-code">초대코드</Label><Input id="team-code" autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={12} value={code} onChange={(event) => setCode(event.target.value)} placeholder="예) K7QM-3XPA" className="font-mono tracking-widest uppercase" /></>
          ) : (
            <><Label htmlFor="team-name">팀 이름</Label><Input id="team-name" maxLength={40} value={name} onChange={(event) => setName(event.target.value)} placeholder="예) 설계1팀" /></>
          )}
        </fieldset>
        {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-xs leading-6 text-red-700">{error}</p>}
        <div className="flex items-center justify-between gap-2">
          <Button type="button" variant="ghost" disabled={busy} onClick={() => void logout()}><LogOut className="size-3.5" />로그아웃</Button>
          <Button type="submit" disabled={busy || (mode === "join" ? !code.trim() : !name.trim())} className="bg-teal-800 text-white hover:bg-teal-900">
            {busy ? <LoaderCircle className="size-4 animate-spin" /> : mode === "join" ? <Ticket className="size-4" /> : <Plus className="size-4" />}
            {mode === "join" ? "참가하기" : "팀 만들기"}
          </Button>
        </div>
      </form>
    </main>
  );
}
