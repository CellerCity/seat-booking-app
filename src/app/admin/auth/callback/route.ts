import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { getSupabaseServerClient } from "@/lib/auth/coordinator";

/**
 * Turns a magic link into a session, then hands off to the guard.
 *
 * Two shapes arrive here, and both must work:
 *
 *   ?code=...        the browser sign-in form. createBrowserClient uses PKCE,
 *                    so Supabase sends the user back with an exchangeable code.
 *   ?token_hash=...  an email link, and anything minted by the admin API
 *                    (see scripts/dev-login-link.ts). There is no PKCE verifier
 *                    for these, so the hash is verified directly instead.
 *
 * Supporting the second form also means a sign-in link can point straight at
 * this route, which avoids Supabase's redirect allowlist entirely — the usual
 * reason a link appears to do nothing is that the allowlist rejected the
 * callback path and Supabase quietly substituted the bare Site URL, dropping
 * the token on a page with nothing to handle it.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = (searchParams.get("type") ?? "magiclink") as EmailOtpType;

  if (!code && !tokenHash) {
    return NextResponse.redirect(`${origin}/admin/login?error=missing_code`);
  }

  const supabase = await getSupabaseServerClient();

  const { error } = tokenHash
    ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
    : await supabase.auth.exchangeCodeForSession(code!);

  if (error) {
    return NextResponse.redirect(`${origin}/admin/login?error=invalid_link`);
  }

  // The admin layout decides whether this email is actually a coordinator.
  return NextResponse.redirect(`${origin}/admin`);
}
