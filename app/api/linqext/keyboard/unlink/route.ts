import { unlink } from "@/lib/linqext/keyboard-auth";
import { userFailure } from "@/lib/users/auth";

export const runtime = "nodejs";

/** POST: revokes the calling keyboard's link (with its access token) or the calling app session's links. */
export async function POST(request: Request) {
  try {
    await unlink(request);
    return Response.json({ data: { ok: true } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return userFailure(error); }
}
