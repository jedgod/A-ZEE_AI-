import { sessionUser } from "@/lib/users/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/auth/me: the signed-in user (verified or not), or { user: null } for guests. Never an error. */
export async function GET(request: Request) {
  const user = await sessionUser(request, { allowUnverified: true });
  return Response.json({ data: { user, verified: user?.verified ?? false } }, { headers: { "Cache-Control": "no-store" } });
}
