import { clearedCookie, userFailure } from "@/lib/users/auth";
import { signOutEverywhere } from "@/lib/users/security";

export const runtime = "nodejs";

/** POST /api/auth/logout-all: signs this account out on every device. */
export async function POST(request: Request) {
  try {
    await signOutEverywhere(request);
    return Response.json({ data: { ok: true } }, { headers: { "Cache-Control": "no-store", "Set-Cookie": clearedCookie() } });
  } catch (error) { return userFailure(error); }
}
