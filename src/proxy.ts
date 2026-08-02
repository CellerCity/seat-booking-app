import { NextResponse, type NextRequest } from "next/server";

/**
 * Passes the request path down to server components, which otherwise cannot
 * read it. The admin layout needs it to tell the login page apart from the
 * pages it guards, so signing in doesn't redirect to itself forever.
 */
export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set("x-pathname", request.nextUrl.pathname);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/admin/:path*"],
};
