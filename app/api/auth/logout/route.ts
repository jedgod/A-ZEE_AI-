import { clearedCookie, signOut, userFailure } from "@/lib/users/auth";

export const runtime = "nodejs";

/** POST /api/auth/logout: revokes this browser's session and clears the cookie. */
export async function POST(request: Request) {
  try {
    await signOut(request);
    return Response.json({ data: { ok: true } }, { headers: { "Cache-Control": "no-store", "Set-Cookie": clearedCookie() } });
  } catch (error) { return userFailure(error); }
}
