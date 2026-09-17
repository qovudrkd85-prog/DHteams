"use client";

import { useState } from "react";
import { ArrowRight, CalendarDays, Eye, EyeOff, LoaderCircle, Sprout, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { normalizeUsername, validatePassword, validateUsername } from "@/lib/account/types";
import { cn } from "@/lib/utils";

type Props = {
  configured: boolean | null;
  sessionError: string | null;
  onRetry: () => Promise<void>;
  onLogin: (username: string, password: string) => Promise<void>;
  onRegister: (username: string, password: string, passwordConfirm: string) => Promise<void>;
};

function WelcomeOffice() {
  return (
    <svg viewBox="0 0 460 260" className="mx-auto w-full max-w-md" aria-hidden="true">
      <rect x="10" y="20" width="440" height="220" rx="32" fill="#e3ecdc" />
      <path d="M10 88h440M100 20v220M280 20v220" stroke="#d5e2cf" strokeWidth="2" />
      <rect x="318" y="51" width="93" height="75" rx="10" fill="#b4cab6" />
      <rect x="325" y="57" width="79" height="62" rx="5" fill="#faf9ef" />
      <rect x="338" y="69" width="20" height="17" rx="2" fill="#dcbf83" />
      <rect x="368" y="71" width="22" height="17" rx="2" fill="#a4c4b3" />
      <path d="M338 99h51" stroke="#b7c8b3" strokeWidth="4" strokeLinecap="round" />
      {[{ x: 117, y: 113, color: "#6d9180", hair: "#4b403b" }, { x: 245, y: 160, color: "#809db7", hair: "#80614a" }].map((person) => (
        <g key={person.x} transform={`translate(${person.x} ${person.y})`}>
          <ellipse cy="56" rx="34" ry="12" fill="#52765320" />
          <rect x="-24" y="16" width="48" height="47" rx="14" fill="#91a99a" />
          <rect x="-55" y="-42" width="110" height="62" rx="7" fill="#c9a57e" />
          <rect x="-55" y="-46" width="110" height="60" rx="7" fill="#e5c9a6" />
          <rect x="-25" y="-37" width="49" height="29" rx="4" fill="#53716a" />
          <rect x="-20" y="-32" width="39" height="19" rx="2" fill="#d0e4d6" />
          <path d="M-13-26h17M-13-20h25" stroke="#8eb5a5" strokeWidth="2" />
          <rect x="-17" y="-2" width="34" height="7" rx="2" fill="#fbf7e8" />
          <circle cx="38" cy="-14" r="7" fill="#fffbed" /><circle cx="38" cy="-14" r="4" fill="#997a5c" />
          <path d="M-16 35q16-9 32 0v23h-32z" fill={person.color} />
          <path d="M-17 40l-8-20M17 40l8-20" stroke={person.color} strokeWidth="10" strokeLinecap="round" />
          <circle cx="-25" cy="18" r="4" fill="#ecc5a4" /><circle cx="25" cy="18" r="4" fill="#ecc5a4" />
          <ellipse cy="22" rx="19" ry="22" fill={person.hair} />
          <ellipse cy="25" rx="16" ry="18" fill="#ecc5a4" />
          <path d="M-18 22q-5-27 19-23 20 2 17 24l-8-14-9 6-9-5z" fill={person.hair} />
          <circle cx="-6" cy="25" r="2" fill="#54463f" /><circle cx="6" cy="25" r="2" fill="#54463f" />
          <path d="M-4 33q4 4 8 0" fill="none" stroke="#a2705e" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="24" cy="6" r="6" fill="#629876" stroke="#f8faf1" strokeWidth="2" />
        </g>
      ))}
      <g transform="translate(368 193)">
        <path d="M-17 0h34l-5 27h-24z" fill="#cea27d" />
        <path d="M0 0v-39" stroke="#688760" strokeWidth="3" />
        <ellipse cx="-11" cy="-22" rx="10" ry="22" fill="#8eaa7c" transform="rotate(-40 -11 -22)" />
        <ellipse cx="12" cy="-31" rx="10" ry="24" fill="#688c68" transform="rotate(35 12 -31)" />
      </g>
    </svg>
  );
}

export function LoginForm({ configured, sessionError, onRetry, onLogin, onRegister }: Props) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const registering = mode === "register";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const invalid = validateUsername(username) || validatePassword(password)
      || (registering && password !== passwordConfirm ? "비밀번호가 서로 다릅니다. 다시 확인해 주세요." : null);
    if (invalid) { setError(invalid); return; }
    setBusy(true);
    setError(null);
    try {
      if (registering) await onRegister(normalizeUsername(username), password, passwordConfirm);
      else await onLogin(normalizeUsername(username), password);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "로그인하지 못했습니다. 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-dvh flex-1 items-center justify-center bg-[#f5f7f1] px-4 py-8 sm:p-10">
      <div className="grid w-full max-w-5xl overflow-hidden rounded-[28px] border border-[#dce4d7] bg-white shadow-[0_20px_80px_#344c3c0a] lg:grid-cols-[1.05fr_1fr]">
        <section className="flex flex-col justify-between bg-[#edf2e7] p-7 sm:p-10">
          <div>
            <p className="flex items-center gap-2 text-sm font-semibold text-teal-800"><Sprout className="size-5" /> Teams</p>
            <p className="mt-8 text-[11px] font-semibold tracking-[0.2em] text-[#638064]">OUR LITTLE WORKSPACE</p>
            <h1 className="mt-3 text-3xl font-bold leading-tight tracking-tight text-[#304b3c]">우리 팀의 하루가<br />시작되는 곳</h1>
            <p className="mt-4 text-sm leading-7 text-[#73816f]">내 캐릭터로 출근하고, 함께 일정을 채워요.<br />작은 사무실에서 시작하는 우리 팀의 계획.</p>
          </div>
          <div className="mt-7 hidden sm:block"><WelcomeOffice /></div>
          <div className="mt-7 flex flex-wrap gap-4 text-xs text-[#5c775e]"><span className="flex items-center gap-1.5"><Users className="size-3.5" /> 나의 자리와 출퇴근</span><span className="flex items-center gap-1.5"><CalendarDays className="size-3.5" /> 함께 보는 업무 일정</span></div>
        </section>
        <section className="flex flex-col justify-center p-7 sm:p-10">
          <div className="mb-7 flex rounded-xl bg-slate-100 p-1" aria-label="계정 메뉴">
            {(["login", "register"] as const).map((tab) => <button key={tab} type="button" disabled={busy} aria-pressed={mode === tab} onClick={() => { setMode(tab); setError(null); setPassword(""); setPasswordConfirm(""); setShowPassword(false); }} className={cn("flex-1 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-500 transition-colors", mode === tab && "bg-white text-teal-800 shadow-sm")}>{tab === "login" ? "로그인" : "회원가입"}</button>)}
          </div>
          <h2 className="text-xl font-semibold text-slate-900">{registering ? "우리 팀에 합류하기" : "다시 만나 반가워요"}</h2>
          <p className="mt-2 text-sm leading-6 text-slate-500">{registering ? "아이디와 비밀번호를 만들고, 내 이름과 직책을 설정해요." : "내 아이디로 로그인해 오늘의 업무를 시작하세요."}</p>
          {configured !== true && <div role="alert" className="mt-5 rounded-xl bg-amber-50 p-4 text-xs leading-6 text-amber-900"><p className="font-semibold">{configured === false ? "계정 연결을 준비하고 있어요" : "로그인 연결을 확인해 주세요"}</p><p>{sessionError || "관리자가 계정 설정을 마치면 회원가입과 로그인을 사용할 수 있어요."}</p><Button type="button" size="sm" variant="outline" className="mt-2 bg-white" disabled={retrying} onClick={async () => { setRetrying(true); try { await onRetry(); } finally { setRetrying(false); } }}>{retrying ? "확인 중…" : "다시 확인"}</Button></div>}
          <form onSubmit={submit} className="mt-6 space-y-4">
            <fieldset disabled={busy || configured !== true} className="space-y-4">
              <div className="space-y-2"><Label htmlFor="account-username">아이디</Label><Input id="account-username" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} required minLength={3} maxLength={24} value={username} onChange={(event) => setUsername(event.target.value)} placeholder="예) minsu_01" aria-describedby="username-help" className="h-11" /><p id="username-help" className="text-[11px] leading-5 text-slate-400">영문·숫자·밑줄(_) 3~24자 · 대소문자 구분 없이 사용</p></div>
              <div className="space-y-2"><Label htmlFor="account-password">비밀번호</Label><div className="relative"><Input id="account-password" name="password" type={showPassword ? "text" : "password"} autoComplete={registering ? "new-password" : "current-password"} required minLength={8} maxLength={72} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="8자 이상 입력" className="h-11 pr-11" /><button type="button" className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-md text-slate-400 hover:text-teal-700" aria-label={showPassword ? "비밀번호 숨기기" : "비밀번호 보기"} aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button></div></div>
              {registering && <div className="space-y-2"><Label htmlFor="account-password-confirm">비밀번호 확인</Label><Input id="account-password-confirm" name="passwordConfirm" type={showPassword ? "text" : "password"} autoComplete="new-password" required minLength={8} maxLength={72} value={passwordConfirm} onChange={(event) => setPasswordConfirm(event.target.value)} placeholder="비밀번호를 한 번 더 입력" className="h-11" /></div>}
            </fieldset>
            {(error || (configured === true && sessionError)) && <p role="alert" className="rounded-lg bg-red-50 p-3 text-xs leading-6 text-red-700">{error || sessionError}</p>}
            <Button type="submit" disabled={busy || configured !== true || !username.trim() || !password || (registering && !passwordConfirm)} className="h-11 w-full bg-teal-800 text-white hover:bg-teal-900">{busy ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}{busy ? "확인 중…" : registering ? "회원가입하고 내 설정하기" : "우리 사무실 들어가기"}</Button>
          </form>
          <p className="mt-6 text-center text-[11px] leading-5 text-slate-400">출퇴근과 일정에는 로그인한 내 프로필이 표시됩니다.</p>
        </section>
      </div>
    </main>
  );
}
