import { z } from "zod";
import { readJson } from "@/lib/http";
import { ADMIN_SESSION_COOKIE, revokeCurrentSession } from "@/lib/admin/host-session";
import { currentStaff, SESSION_HOURS, signIn, SignInError } from "@/lib/staff/auth";
import { errorResponse, NO_STORE, rateLimit, requireSameOrigin } from "@/lib/staff/route";

export const runtime = "nodejs";

const credentials = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(200),
}).strict();

const cookie = (value: string, maxAge: number) =>
  `${ADMIN_SESSION_COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${process.env.NODE_ENV === "production" && (process.env.APP_ORIGIN ?? "").startsWith("https:") ? "; Secure" : ""}`;

/** Who is signed in (for the account menu and the operations workspace). */
export async function GET() {
  try {
    const staff = await currentStaff();
    return Response.json({ data: staff && { name: staff.name, email: staff.email, role: staff.role, mustChangePassword: staff.mustChangePassword } }, { headers: NO_STORE });
  } catch (error) { return errorResponse(error); }
}

/** Email + password sign-in for staff and administrators. */
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const input = credentials.parse(await readJson(request, 4_000));
    // Per-email and global ceilings slow password guessing in addition to the account lockout.
    if (!await rateLimit("staff-login-email", input.email.toLowerCase(), 10) || !await rateLimit("staff-login", "all", 120)) {
      return Response.json({ error: "RATE_LIMITED" }, { status: 429, headers: { ...NO_STORE, "Retry-After": "60" } });
    }
    const { token, staff } = await signIn(input.email, input.password);
    return Response.json(
      { data: { name: staff.name, role: staff.role, mustChangePassword: staff.mustChangePassword } },
      { headers: { ...NO_STORE, "Set-Cookie": cookie(token, SESSION_HOURS * 3600) } },
    );
  } catch (error) {
    if (error instanceof SignInError) {
      const status = error.code === "LOCKED" ? 423 : error.code === "NO_ACTIVE_MEMBERSHIP" ? 403 : 401;
      return Response.json({ error: error.code }, { status, headers: NO_STORE });
    }
    return errorResponse(error);
  }
}

/** Sign out: revoke the session server-side and clear the cookie. */
export async function DELETE(request: Request) {
  try {
    requireSameOrigin(request);
    try { await revokeCurrentSession(); } catch { /* already signed out */ }
    return new Response(null, { status: 204, headers: { ...NO_STORE, "Set-Cookie": cookie("", 0) } });
  } catch (error) { return errorResponse(error); }
}
