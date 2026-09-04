"use client";

import Link from "next/link";

export function AppHeader({ children }: { children?: React.ReactNode }) {
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-background px-4">
      <Link href="/" className="text-base font-semibold tracking-tight">
        Teams
      </Link>
      <div className="min-w-0 flex-1">{children}</div>
    </header>
  );
}
