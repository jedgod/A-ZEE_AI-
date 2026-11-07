import { deviceCookie, evaluateUser, recordSignal } from "@/lib/abuse/signals";
import { jsonBody } from "@/lib/users/route";
import { requireUser, userFailure } from "@/lib/users/auth";
import { z } from "zod";

export const runtime = "nodejs";

const body = z.object({ fingerprint: z.string().max(64).optional() }).strict();

/**
 * POST { fingerprint? }: the signed-in workspace reports its device once per session. The device
 * cookie is issued here (HttpOnly), never taken from the client. Always answers the same way.
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser(request, true);
    const { fingerprint } = body.parse(await jsonBody(request, 500));
    const device = deviceCookie(request);
    await recordSignal(request, user.id, "free_usage", fingerprint, device.id);
    await evaluateUser(user.id);
    const headers = new Headers({ "Cache-Control": "no-store" });
    if (device.setCookie) headers.append("Set-Cookie", device.setCookie);
    return Response.json({ data: { ok: true } }, { headers });
  } catch (error) { return userFailure(error); }
}
