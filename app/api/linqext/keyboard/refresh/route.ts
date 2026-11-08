import { readJson } from "@/lib/http";
import { refreshLink } from "@/lib/linqext/keyboard-auth";
import { userFailure } from "@/lib/users/auth";

export const runtime = "nodejs";

/** POST { refreshToken }: the keyboard rotates its credentials. A replayed refresh token revokes the link. */
export async function POST(request: Request) {
  try {
    return Response.json({ data: await refreshLink(request, await readJson(request, 400)) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return userFailure(error); }
}
