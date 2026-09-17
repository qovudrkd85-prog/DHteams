import { NextResponse, type NextRequest } from "next/server";

import { normalizeUsername, usernameEmail, validatePassword, validateUsername } from "@/lib/account/types";
import { AccountError, accountFailure, createAuthContext, readJson, requireSameOrigin, sessionPayload } from "@/lib/server-auth";

export async function POST(request: NextRequest) {
  const denied = requireSameOrigin(request);
  if (denied) return denied;
  let auth: ReturnType<typeof createAuthContext> | undefined;
  try {
    const body = await readJson(request);
    const username = normalizeUsername(body.username);
    const validation = validateUsername(username) ?? validatePassword(body.password);
    if (validation) throw new AccountError(validation);
    if (body.password !== body.passwordConfirm) throw new AccountError("비밀번호 확인이 일치하지 않습니다.");
    auth = createAuthContext(request);
    // Both checks precede account creation: no unconfirmed or profile-less signup.
    const { data: ready, error: readinessError } = await auth.supabase.rpc("account_registration_ready");
    if (readinessError || ready !== true) throw new AccountError("회원가입 준비가 필요합니다. 관리자가 계정 SQL(schema-accounts.sql)을 적용해 주세요.", 503);
    const settingsResponse = await fetch(`${auth.config.url}/auth/v1/settings`, { headers: { apikey: auth.config.key }, cache: "no-store", redirect: "error" });
    if (!settingsResponse.ok) throw new AccountError("회원가입 설정을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.", 503);
    const settings = await settingsResponse.json() as { external?: { email?: boolean }; disable_signup?: boolean; mailer_autoconfirm?: boolean };
    if (settings.external?.email !== true || settings.disable_signup !== false || settings.mailer_autoconfirm !== true) {
      throw new AccountError("관리자가 Supabase 이메일 로그인과 회원가입을 켜고 이메일 확인(Confirm email)을 꺼야 아이디로 가입할 수 있습니다.", 503);
    }
    const { data, error } = await auth.supabase.auth.signUp({ email: usernameEmail(username), password: body.password as string, options: { data: { username } } });
    if (error) {
      if (["user_already_exists", "email_exists"].includes(error.code ?? "")) throw new AccountError("이미 사용 중인 아이디입니다.", 409);
      if (error.status === 429) throw new AccountError("회원가입 시도가 많습니다. 잠시 후 다시 시도해 주세요.", 429);
      if (error.code === "weak_password") throw new AccountError("더 안전한 비밀번호를 사용해 주세요.");
      throw new AccountError("회원가입을 완료하지 못했습니다. 서버 계정 설정을 확인해 주세요.", 503);
    }
    if (data.user?.identities?.length === 0) throw new AccountError("이미 사용 중인 아이디입니다.", 409);
    if (!data.session || !data.user) throw new AccountError("계정 로그인 설정이 변경되었습니다. 관리자에게 이메일 확인 설정을 문의해 주세요.", 503);
    return auth.applyCookies(NextResponse.json(sessionPayload(await auth.getAccount()), { status: 201 }));
  } catch (error) {
    const response = accountFailure(error);
    return auth ? auth.applyCookies(response) : response;
  }
}
