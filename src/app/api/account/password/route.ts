import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { usernameEmail, validatePassword } from "@/lib/account/types";
import { AccountError, accountFailure, createAuthContext, readJson, requireSameOrigin } from "@/lib/server-auth";

export async function POST(request: NextRequest) {
  const denied = requireSameOrigin(request);
  if (denied) return denied;
  let auth: ReturnType<typeof createAuthContext> | undefined;
  let verifier: ReturnType<typeof createClient> | undefined;
  try {
    auth = createAuthContext(request);
    const account = await auth.getAccount();
    const body = await readJson(request);
    const validation = validatePassword(body.currentPassword) ?? validatePassword(body.password);
    if (validation) throw new AccountError(validation);
    if (body.currentPassword === body.password) throw new AccountError("현재 비밀번호와 다른 새 비밀번호를 입력해 주세요.");
    // Verify independently even if the project's current-password requirement is off.
    // This temporary login never changes the browser's session cookies.
    verifier = createClient(auth.config.url, auth.config.key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }) },
    });
    const { data: proof, error: proofError } = await verifier.auth.signInWithPassword({ email: usernameEmail(account.username), password: body.currentPassword as string });
    if (proofError || proof.user?.id !== account.id) {
      if (proofError?.status === 429) throw new AccountError("확인 시도가 많습니다. 잠시 후 다시 시도해 주세요.", 429);
      if (proofError && (proofError.status === 0 || (proofError.status ?? 0) >= 500)) throw new AccountError("로그인 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.", 503);
      throw new AccountError("현재 비밀번호가 올바르지 않습니다.");
    }
    const { error } = await auth.supabase.auth.updateUser({ password: body.password as string, current_password: body.currentPassword as string });
    if (error) {
      if (error.status === 429) throw new AccountError("변경 시도가 많습니다. 잠시 후 다시 시도해 주세요.", 429);
      if (error.status === 0 || (error.status ?? 0) >= 500) throw new AccountError("비밀번호 변경 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.", 503);
      if (error.code === "weak_password") throw new AccountError("더 안전한 비밀번호를 사용해 주세요.");
      throw new AccountError("비밀번호를 변경하지 못했습니다. 현재 비밀번호를 확인한 뒤 다시 시도해 주세요.");
    }
    return auth.applyCookies(NextResponse.json({ ok: true }));
  } catch (error) {
    const response = accountFailure(error);
    return auth ? auth.applyCookies(response) : response;
  } finally {
    if (verifier) await verifier.auth.signOut({ scope: "local" }).catch(() => undefined);
  }
}
