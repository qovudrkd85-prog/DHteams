"use client";

import Link from "next/link";
import { useState } from "react";
import { LogOut, Settings } from "lucide-react";
import { toast } from "sonner";
import { useAccount } from "@/components/account/provider";
import { TeamSwitcher } from "@/components/account/team-switcher";
import { Button } from "@/components/ui/button";

export function AppHeader({ children }: { children?: React.ReactNode }) {
  const { account, setSettingsOpen, signOut } = useAccount();
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await signOut();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "로그아웃하지 못했습니다. 다시 시도해 주세요.");
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <header className="sticky top-0 z-20 flex min-h-14 flex-wrap items-center gap-x-3 gap-y-2 border-b bg-background px-3 py-2 sm:px-4">
      <Link href="/" className="shrink-0 text-base font-semibold tracking-tight">
        Teams
      </Link>
      <TeamSwitcher />
      <div className="min-w-0 flex-1 overflow-hidden">{children}</div>
      {account && <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        <div className="mr-1 hidden min-w-0 text-right sm:block">
          <p className="max-w-36 truncate text-xs font-semibold text-slate-700">{account.member.name}</p>
          <p className="max-w-36 truncate text-[10px] text-slate-500">{account.member.role || "팀원"}</p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={() => setSettingsOpen(true)} disabled={signingOut}><Settings className="size-3.5" /><span>내 설정</span></Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => void handleSignOut()} disabled={signingOut} aria-label="로그아웃"><LogOut className="size-3.5" /><span className="hidden sm:inline">{signingOut ? "로그아웃 중…" : "로그아웃"}</span></Button>
      </div>}
    </header>
  );
}
