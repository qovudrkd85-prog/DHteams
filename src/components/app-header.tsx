"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";

export function AppHeader({ children }: { children?: React.ReactNode }) {
  const router = useRouter();
  const [email, setEmail] = useState<string>("");

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    createClient()
      .auth.getUser()
      .then(({ data }) => setEmail(data.user?.email ?? ""));
  }, []);

  async function signOut() {
    if (isSupabaseConfigured) await createClient().auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-background px-4">
      <Link href="/" className="text-base font-semibold tracking-tight">
        Teams
      </Link>
      <div className="min-w-0 flex-1">{children}</div>
      {email ? <span className="hidden text-xs text-muted-foreground sm:inline">{email}</span> : null}
      <Button variant="ghost" size="sm" onClick={signOut}>
        로그아웃
      </Button>
    </header>
  );
}
