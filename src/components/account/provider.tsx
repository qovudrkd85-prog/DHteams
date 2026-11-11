"use client";

import { createContext, Fragment, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import type { Account, ProfileInput, SessionPayload } from "@/lib/account/types";
import { setScreenTeam } from "@/lib/supabase/client";
import type { TeamMember } from "@/lib/team/workspace";
import { LoginForm } from "./login-form";
import { AccountSettingsDialog } from "./settings-dialog";
import { TeamGate } from "./team-gate";

type AccountContextValue = {
  account: Account | null;
  loading: boolean;
  error: string | null;
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
  updateProfile: (input: ProfileInput) => Promise<void>;
  updateStatus: (statusMessage: string) => Promise<TeamMember>;
  changePassword: (currentPassword: string, password: string) => Promise<void>;
  teamAction: (input: TeamActionInput) => Promise<void>;
};

export type TeamActionInput =
  | { action: "create"; name: string }
  | { action: "join"; code: string }
  | { action: "leave" }
  | { action: "regenerate" };

const AccountContext = createContext<AccountContextValue | null>(null);
const connectionError = "서버에 연결하지 못했습니다. 연결을 확인하고 다시 시도해 주세요.";

type AccountResponse = Partial<SessionPayload> & { member?: TeamMember };

async function readResponse(response: Response): Promise<AccountResponse> {
  try {
    return await response.json() as AccountResponse;
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
    const onTeamCheck = () => void refresh();
    const timer = window.setInterval(onVisible, 30000);
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("teams:session-expired", expireSession);
    window.addEventListener("teams:team-check", onTeamCheck);
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
      window.removeEventListener("teams:team-check", onTeamCheck);
      channel.current?.close();
      channel.current = null;
    };
  }, [refresh, expireSession, invalidate]);

  // Layout effect: runs before the remounted workspace starts loading data for the new team.
  const screenTeam = account?.team?.id ?? null;
  useLayoutEffect(() => { setScreenTeam(screenTeam); }, [screenTeam]);

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
      if (path === "/api/account/status") {
        if (!data.member?.user_id) throw new Error("저장한 상태 메시지를 확인하지 못했습니다. 다시 시도해 주세요.");
        setAccount((previous) => previous && previous.id === data.member?.user_id ? { ...previous, member: data.member } : previous);
      }
      if (method === "DELETE") {
        setAccount(null);
        setSettingsOpen(false);
      }
      setError(null);
      channel.current?.postMessage("changed");
      return data;
    } catch (cause) {
      if (cause instanceof TypeError) throw new Error(connectionError);
      throw cause;
    } finally {
      mutating.current = false;
    }
  }, [expireSession]);

  const signOut = useCallback(async () => { await mutateAccount("/api/session", "DELETE"); }, [mutateAccount]);
  const updateProfile = useCallback(async (input: ProfileInput) => { await mutateAccount("/api/account/profile", "PATCH", input); }, [mutateAccount]);
  const updateStatus = useCallback(async (statusMessage: string) => {
    const data = await mutateAccount("/api/account/status", "PATCH", { statusMessage });
    if (!data.member) throw new Error("저장한 상태 메시지를 확인하지 못했습니다.");
    return data.member;
  }, [mutateAccount]);
  const changePassword = useCallback(async (currentPassword: string, password: string) => { await mutateAccount("/api/account/password", "POST", { currentPassword, password }); }, [mutateAccount]);
  const teamAction = useCallback(async (input: TeamActionInput) => {
    const data = await mutateAccount("/api/team", "POST", input);
    if (!data.account) throw new Error("팀 정보를 확인하지 못했습니다. 새로고침해 주세요.");
  }, [mutateAccount]);
  const value: AccountContextValue = { account, loading, error, settingsOpen, setSettingsOpen, refresh, signOut, updateProfile, updateStatus, changePassword, teamAction };

  return (
    <AccountContext.Provider value={value}>
      {loading ? (
        <main className="flex min-h-dvh items-center justify-center gap-2 bg-[#f5f7f1] text-sm text-teal-800" aria-live="polite">
          <LoaderCircle className="size-4 animate-spin" /> 우리 팀 공간을 여는 중…
        </main>
      ) : account ? (
        // Team switch remounts the workspace so no data from the previous team stays in memory.
        <Fragment key={`${account.id}:${account.team?.id ?? "none"}`}>
          {error && <div role="alert" className="bg-amber-50 px-4 py-2 text-center text-xs leading-6 text-amber-900">{error}<button type="button" className="ml-3 underline underline-offset-4" onClick={() => void refresh()}>다시 확인</button></div>}
          {account.member.profile_completed ? (account.team ? children : <TeamGate />) : <main className="flex min-h-dvh items-center justify-center bg-[#f5f7f1] p-6 text-sm text-teal-800">내 프로필을 설정하고 우리 사무실에 합류해요.</main>}
          <AccountSettingsDialog />
        </Fragment>
      ) : (
        <LoginForm
          configured={configured}
          sessionError={error}
          onRetry={refresh}
          onLogin={async (username, password) => { await mutateAccount("/api/session", "POST", { username, password }); }}
          onRegister={async (username, password, passwordConfirm) => { await mutateAccount("/api/account/register", "POST", { username, password, passwordConfirm }); }}
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
