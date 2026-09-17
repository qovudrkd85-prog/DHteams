"use client";

import { useState } from "react";
import { Check, KeyRound, LoaderCircle, LogOut } from "lucide-react";
import { toast } from "sonner";
import { useAccount } from "@/components/account/provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { validatePassword, type Account, type ProfileInput } from "@/lib/account/types";
import { MEMBER_AVATARS, MEMBER_COLORS } from "@/lib/team/workspace";
import { cn } from "@/lib/utils";

export function AccountSettingsDialog() {
  const { account, settingsOpen } = useAccount();
  if (!account || (!settingsOpen && account.member.profile_completed)) return null;
  return <SettingsForm key={account.id} account={account} />;
}

function SettingsForm({ account }: { account: Account }) {
  const { setSettingsOpen, updateProfile, changePassword, signOut } = useAccount();
  const required = !account.member.profile_completed;
  const [form, setForm] = useState<ProfileInput>(() => ({
    name: required ? "" : account.member.name,
    role: account.member.role,
    avatar: account.member.avatar || MEMBER_AVATARS[0],
    color: account.member.color || MEMBER_COLORS[0],
  }));
  const [tab, setTab] = useState<"profile" | "password">("profile");
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function saveProfile(event: React.FormEvent) {
    event.preventDefault();
    const input = { ...form, name: form.name.trim(), role: form.role.trim() };
    if (!input.name || input.name.length > 40) { setError("이름은 1~40자로 입력해 주세요."); return; }
    if (!input.role || input.role.length > 60) { setError("직책은 1~60자로 입력해 주세요."); return; }
    setBusy(true);
    setError(null);
    try {
      await updateProfile(input);
      setSettingsOpen(false);
      toast.success(required ? `${input.name}님, 우리 사무실에 오신 것을 환영해요!` : "내 프로필을 저장했습니다.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "프로필을 저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function savePassword(event: React.FormEvent) {
    event.preventDefault();
    const invalid = !currentPassword ? "현재 비밀번호를 입력해 주세요." : validatePassword(password)
      || (password !== passwordConfirm ? "새 비밀번호가 서로 다릅니다. 다시 확인해 주세요." : null)
      || (password === currentPassword ? "현재 비밀번호와 다른 새 비밀번호를 입력해 주세요." : null);
    if (invalid) { setError(invalid); return; }
    setBusy(true);
    setError(null);
    try {
      await changePassword(currentPassword, password);
      setCurrentPassword("");
      setPassword("");
      setPasswordConfirm("");
      setSettingsOpen(false);
      toast.success("비밀번호를 변경했습니다. 다음 로그인부터 새 비밀번호를 사용해 주세요.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "비밀번호를 변경하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function leave() {
    setBusy(true);
    setError(null);
    try { await signOut(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "로그아웃하지 못했습니다."); }
    finally { setBusy(false); }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !required && !busy) setSettingsOpen(false); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto p-5 sm:max-w-md" showCloseButton={!required && !busy}>
        <DialogHeader>
          <DialogTitle>내 설정</DialogTitle>
          <DialogDescription>{required ? "처음 오셨네요! 팀원에게 표시할 이름과 직책을 설정해 주세요." : "내 이름과 직책, 캐릭터를 바꾸고 계정을 관리해요."}</DialogDescription>
        </DialogHeader>
        <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">아이디 <span className="ml-2 font-semibold text-slate-700">{account.username}</span></div>
        {!required && <div className="flex rounded-lg bg-slate-100 p-1" aria-label="내 설정 메뉴">
          {(["profile", "password"] as const).map((item) => <button type="button" key={item} disabled={busy} aria-pressed={tab === item} onClick={() => { setTab(item); setError(null); setCurrentPassword(""); setPassword(""); setPasswordConfirm(""); }} className={cn("flex-1 rounded-md py-2 text-sm text-slate-500", tab === item && "bg-white text-teal-800 shadow-sm")}>{item === "profile" ? "프로필" : "비밀번호 변경"}</button>)}
        </div>}
        {tab === "profile" ? <form onSubmit={saveProfile}>
          <fieldset disabled={busy} className="space-y-4 pb-5">
            <div className="flex items-center gap-3 rounded-xl bg-[#f1f6f1] p-3"><span className="flex size-14 shrink-0 items-center justify-center rounded-2xl border-2 bg-white text-3xl" style={{ borderColor: form.color }}>{form.avatar}</span><div className="min-w-0"><p className="truncate text-sm font-semibold">{form.name.trim() || "나의 캐릭터"}</p><p className="mt-1 truncate text-xs text-slate-500">{form.role.trim() || "함께 일하는 우리 팀"}</p></div></div>
            <div className="space-y-2"><Label htmlFor="profile-name">이름</Label><Input id="profile-name" name="name" autoComplete="name" required maxLength={40} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="예) 김민수" /></div>
            <div className="space-y-2"><Label htmlFor="profile-role">직책</Label><Input id="profile-role" name="role" autoComplete="organization-title" required maxLength={60} value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })} placeholder="예) 설계팀 · 대리" /></div>
            <fieldset><legend className="mb-2 text-sm font-medium">캐릭터</legend><div className="flex flex-wrap gap-2">{MEMBER_AVATARS.map((avatar) => <button type="button" key={avatar} aria-label={`캐릭터 ${avatar}`} aria-pressed={form.avatar === avatar} onClick={() => setForm({ ...form, avatar })} className={cn("size-10 rounded-xl border-2 text-2xl", form.avatar === avatar ? "border-teal-600 bg-teal-50" : "border-transparent bg-slate-50 hover:bg-slate-100")}>{avatar}</button>)}</div></fieldset>
            <fieldset><legend className="mb-2 text-sm font-medium">나의 색상</legend><div className="flex flex-wrap gap-2">{MEMBER_COLORS.map((color, index) => <button type="button" key={color} aria-label={`프로필 색상 ${index + 1}`} aria-pressed={form.color === color} onClick={() => setForm({ ...form, color })} className="flex size-8 items-center justify-center rounded-full text-white" style={{ backgroundColor: color }}>{form.color === color && <Check className="size-4" />}</button>)}</div></fieldset>
            <p className="text-[11px] leading-5 text-slate-500">내 프로필은 우리 사무실의 자리와 출퇴근, 내가 등록한 일정에 표시됩니다.</p>
          </fieldset>
          {error && <p role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-xs leading-6 text-red-700">{error}</p>}
          <DialogFooter className="-mx-5 -mb-5">
            {required ? <Button type="button" variant="ghost" disabled={busy} onClick={() => void leave()}><LogOut className="size-3.5" />로그아웃</Button> : <Button type="button" variant="outline" disabled={busy} onClick={() => setSettingsOpen(false)}>취소</Button>}
            <Button type="submit" disabled={busy || !form.name.trim() || !form.role.trim()} className="bg-teal-800 text-white hover:bg-teal-900">{busy && <LoaderCircle className="size-4 animate-spin" />}{busy ? "저장 중…" : required ? "설정하고 시작하기" : "프로필 저장"}</Button>
          </DialogFooter>
        </form> : <form onSubmit={savePassword}>
          <fieldset disabled={busy} className="space-y-4 pb-5">
            <input type="text" name="username" autoComplete="username" value={account.username} readOnly hidden />
            <div className="space-y-2"><Label htmlFor="settings-current-password">현재 비밀번호</Label><Input id="settings-current-password" type="password" autoComplete="current-password" required maxLength={72} value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="settings-new-password">새 비밀번호</Label><Input id="settings-new-password" type="password" autoComplete="new-password" required minLength={8} maxLength={72} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="8자 이상 입력" /></div>
            <div className="space-y-2"><Label htmlFor="settings-confirm-password">새 비밀번호 확인</Label><Input id="settings-confirm-password" type="password" autoComplete="new-password" required minLength={8} maxLength={72} value={passwordConfirm} onChange={(event) => setPasswordConfirm(event.target.value)} /></div>
          </fieldset>
          {error && <p role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-xs leading-6 text-red-700">{error}</p>}
          <DialogFooter className="-mx-5 -mb-5"><Button type="button" variant="outline" disabled={busy} onClick={() => setSettingsOpen(false)}>취소</Button><Button type="submit" disabled={busy || !currentPassword || !password || !passwordConfirm} className="bg-teal-800 text-white hover:bg-teal-900">{busy ? <LoaderCircle className="size-4 animate-spin" /> : <KeyRound className="size-4" />}{busy ? "변경 중…" : "비밀번호 저장"}</Button></DialogFooter>
        </form>}
      </DialogContent>
    </Dialog>
  );
}
