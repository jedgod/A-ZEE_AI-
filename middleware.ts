import { NextResponse, type NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/admin") || pathname.startsWith("/api/admin")) {
    if (!request.cookies.has("az_session") && !pathname.endsWith("/session/bootstrap")) {
      if (pathname.startsWith("/api/admin")) {
        return NextResponse.json({ error: "SESSION_REQUIRED" }, { status: 401 });
      }
      // Staff sign in at /login (same sessions as /operations), then come back here.
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.search = `?next=${encodeURIComponent(pathname)}`;
      return NextResponse.redirect(url);
    }
  }

  // Operations workspace: a cheap cookie presence check here; every route and page still
  // validates the session and role against the database.
  if (pathname.startsWith("/operations") || pathname.startsWith("/api/operations")) {
    if (!request.cookies.has("az_session")) {
      if (pathname.startsWith("/api/")) return NextResponse.json({ error: "SIGN_IN_REQUIRED" }, { status: 401 });
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.search = `?next=${encodeURIComponent(pathname)}`;
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin", "/admin/:path*", "/api/admin", "/api/admin/:path*", "/operations", "/operations/:path*", "/api/operations/:path*"],
};
