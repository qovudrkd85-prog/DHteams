"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * 팀 공유 비밀번호 화면 잠금.
 * 링크를 우연히 연 사람을 막는 용도이며, 브라우저에서 우회 가능한 수준이다.
 * 데이터 자체를 지키려면 서버 측 인증이 필요하다.
 */
const PASSWORD_HASH = "91c5b87ed0cf9d76ca0cfcfe4398b24993917c602dd186e6785cb043b6638ef5";
const STORAGE_KEY = "teams-unlocked";

async function sha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function PasswordGate({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setUnlocked(localStorage.getItem(STORAGE_KEY) === PASSWORD_HASH);
    setReady(true);
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const hash = await sha256(value);
    if (hash === PASSWORD_HASH) {
      localStorage.setItem(STORAGE_KEY, hash);
      setUnlocked(true);
      setError("");
    } else {
      setError("비밀번호가 맞지 않습니다.");
      setValue("");
    }
  }

  // 첫 렌더에서는 아무것도 판단하지 않는다 (서버/브라우저 화면 불일치 방지)
  if (!ready) return null;

  if (unlocked) return <>{children}</>;

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Teams</CardTitle>
          <CardDescription>팀 공유 비밀번호를 입력하세요.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="team-password">비밀번호</Label>
              <Input
                id="team-password"
                type="password"
                autoFocus
                autoComplete="current-password"
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
              {error ? <p className="text-xs text-destructive">{error}</p> : null}
            </div>
            <Button type="submit" className="w-full" disabled={!value}>
              들어가기
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
