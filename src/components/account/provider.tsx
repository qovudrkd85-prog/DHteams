"use client";

import { createContext, Fragment, useCallback, useContext, useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import type { Account, ProfileInput, SessionPayload } from "@/lib/account/types";
import { LoginForm } from "./login-form";
import { AccountSettingsDialog } from "./settings-dialog";

type AccountContextValue = {
  account: Account | null;
  loading: boolean;
  error: string | null;
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
  updateProfile: (input: ProfileInput) => Promise<void>;
  changePassword: (currentPassword: string, password: string) => Promise<void>;
};

const AccountContext = createContext<AccountContextValue | null>(null);
const connectionError = "서버에 연결하지 못했습니다. 연결을 확인하고 다시 시도해 주세요.";

async function readResponse(response: Response): Promise<Partial<SessionPayload>> {
  try {
    return await response.json() as Partial<SessionPayload>;
  } catch {
    throw new Error("서버 응답을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
}

export function AccountProvider({ children }: { children: React.ReactNode }) {
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const version = useRef(0);
  const mutating = useRef(false);
  const channel = useRef<BroadcastChannel | null>(null);
  const invalidate = useCallback(() => { ++version.current; }, []);

  const expireSession = useCallback(() => {
    ++version.current;
    setAccount(null);
    setSettingsOpen(false);
    setLoading(false);
    setError("로그인이 만료되었습니다. 다시 로그인해 주세요.");
  }, []);

  const refresh = useCallback(() => {
    if (mutating.current) return Promise.resolve();
    const request = ++version.current;
    return fetch("/api/session", { cache: "no-store" }).then(async (response) => {
      const data = await readResponse(response);
      if (request !== version.current) return;
      if (typeof data.configured === "boolean") setConfigured(data.configured);
      if (!response.ok && response.status !== 401) {
        setError(data.error || connectionError);
        if (data.configured === false) setAccount(null);
        return;
      }
      setAccount(data.authenticated && data.account ? data.account : null);
      setError(data.error || null);
    }).catch((cause: unknown) => {
      if (request === version.current) setError(cause instanceof Error ? cause.message : connectionError);
    }).finally(() => {
      if (request === version.current) setLoading(false);
    });
  }, []);

  useEffect(() => {
    void refresh();
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    const timer = window.setInterval(onVisible, 30000);
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("teams:session-expired", expireSession);
    if (typeof BroadcastChannel !== "undefined") {
      channel.current = new BroadcastChannel("teams-session");
      channel.current.onmessage = () => void refresh();
    }
    return () => {
      invalidate();
      window.clearInterval(timer);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("teams:session-expired", expireSession);
      channel.current?.close();
      channel.current = null;
    };
  }, [refresh, expireSession, invalidate]);

  const mutateAccount = useCallback(async (path: string, method: string, body?: object) => {
    if (mutating.current) throw new Error("이전 요청이 끝난 후 다시 시도해 주세요.");
    mutating.current = true;
    const request = ++version.current;
    try {
      const response = await fetch(path, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        cache: "no-store",
      });
      const data = await readResponse(response);
      if (!response.ok) {
        if (response.status === 401 && (method === "DELETE" || path !== "/api/session")) expireSession();
        if (data.configured === false) setConfigured(false);
        throw new Error(data.error || "요청을 처리하지 못했습니다. 다시 시도해 주세요.");
      }
      if (request !== version.current) throw new Error("로그인 상태가 변경되었습니다. 다시 시도해 주세요.");
      if (method === "POST" && (path === "/api/session" || path === "/api/account/register") && (!data.authenticated || !data.account)) {
        throw new Error("로그인 정보를 확인하지 못했습니다. 다시 로그인해 주세요.");
      }
      if (data.account) {
        setAccount(data.account);
        setConfigured(true);
      }
      if (method === "DELETE") {
        setAccount(null);
        setSettingsOpen(false);
      }
      setError(null);
      channel.current?.postMessage("changed");
    } catch (cause) {
      if (cause instanceof TypeError) throw new Error(connectionError);
      throw cause;
    } finally {
      mutating.current = false;
    }
  }, [expireSession]);

  const signOut = useCallback(() => mutateAccount("/api/session", "DELETE"), [mutateAccount]);
  const updateProfile = useCallback((input: ProfileInput) => mutateAccount("/api/account/profile", "PATCH", input), [mutateAccount]);
  const changePassword = useCallback((currentPassword: string, password: string) => mutateAccount("/api/account/password", "POST", { currentPassword, password }), [mutateAccount]);
  const value: AccountContextValue = { account, loading, error, settingsOpen, setSettingsOpen, refresh, signOut, updateProfile, changePassword };

  return (
    <AccountContext.Provider value={value}>
      {loading ? (
        <main className="flex min-h-dvh items-center justify-center gap-2 bg-[#f5f7f1] text-sm text-teal-800" aria-live="polite">
          <LoaderCircle className="size-4 animate-spin" /> 우리 팀 공간을 여는 중…
        </main>
      ) : account ? (
        <Fragment key={account.id}>
          {error && <div role="alert" className="bg-amber-50 px-4 py-2 text-center text-xs leading-6 text-amber-900">{error}<button type="button" className="ml-3 underline underline-offset-4" onClick={() => void refresh()}>다시 확인</button></div>}
          {account.member.profile_completed ? children : <main className="flex min-h-dvh items-center justify-center bg-[#f5f7f1] p-6 text-sm text-teal-800">내 프로필을 설정하고 우리 사무실에 합류해요.</main>}
          <AccountSettingsDialog />
        </Fragment>
      ) : (
        <LoginForm
          configured={configured}
          sessionError={error}
          onRetry={refresh}
          onLogin={(username, password) => mutateAccount("/api/session", "POST", { username, password })}
          onRegister={(username, password, passwordConfirm) => mutateAccount("/api/account/register", "POST", { username, password, passwordConfirm })}
        />
      )}
    </AccountContext.Provider>
  );
}

export function useAccount(): AccountContextValue {
  const account = useContext(AccountContext);
  if (!account) throw new Error("useAccount는 AccountProvider 안에서 사용해야 합니다.");
  return account;
}
