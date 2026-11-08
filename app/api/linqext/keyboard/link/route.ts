import { readJson } from "@/lib/http";
import { createLink } from "@/lib/linqext/keyboard-auth";
import { userFailure } from "@/lib/users/auth";

export const runtime = "nodejs";

/** POST (signed-in app): mints this device's keyboard link, a scoped 15-minute access token and a rotating refresh token. */
export async function POST(request: Request) {
  try {
    await readJson(request, 100).catch(() => undefined);
    return Response.json({ data: await createLink(request) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return userFailure(error); }
}
