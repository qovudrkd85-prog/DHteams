import type { TeamMember } from "@/lib/team/workspace";

export interface AccountIdentity {
  id: string;
  username: string;
  member: TeamMember;
}

export type Account = AccountIdentity;

export interface SessionPayload {
  configured: boolean;
  authenticated: boolean;
  account: AccountIdentity | null;
  error?: string;
}

export interface ProfileInput {
  name: string;
  role: string;
  avatar: string;
  color: string;
}

export const ACCOUNT_EMAIL_DOMAIN = "members.dhteams.invalid";

export function normalizeUsername(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function validateUsername(value: unknown): string | null {
  return /^[a-z0-9][a-z0-9_]{2,23}$/.test(normalizeUsername(value))
    ? null
    : "아이디는 영문·숫자로 시작하는 3~24자의 영문, 숫자, 밑줄(_)로 입력해 주세요.";
}

export function validatePassword(value: unknown): string | null {
  if (typeof value !== "string" || value.length < 8) return "비밀번호는 8자 이상 입력해 주세요.";
  if (new TextEncoder().encode(value).length > 72) return "비밀번호는 72바이트 이내로 입력해 주세요. 한글은 글자당 3바이트입니다.";
  return null;
}

export function usernameEmail(value: string): string {
  return `${normalizeUsername(value)}@${ACCOUNT_EMAIL_DOMAIN}`;
}
