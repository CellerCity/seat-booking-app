import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseServerClient } from "@/lib/auth/coordinator";

/** Exchanges the magic-link code for a session, then hands off to the guard. */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(`${origin}/admin/login?error=missing_code`);
  }

  const supabase = await getSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(`${origin}/admin/login?error=invalid_link`);
  }

  // The admin layout decides whether this email is actually a coordinator.
  return NextResponse.redirect(`${origin}/admin`);
}
