import { z } from "zod";
import { jsonBody, userRoute } from "@/lib/users/route";
import { MonitorError, removeDeviceToken, saveDeviceToken } from "@/lib/finance/monitor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({ expoPushToken: z.string().min(10).max(200), platform: z.enum(["android", "ios"]).default("android") }).strict();
const bad = (code: string, status = 400) => Response.json({ error: code }, { status, headers: { "Cache-Control": "no-store" } });

/** The app registers its Expo push token here so alerts can reach a locked phone. DELETE forgets it (for sign-out). */
export const POST = (request: Request) => userRoute(request, true, async user => {
  const input = body.safeParse(await jsonBody(request, 1_000));
  if (!input.success) return bad("INVALID_REQUEST");
  try { await saveDeviceToken(user.id, input.data.expoPushToken, input.data.platform); return { registered: true }; }
  catch (e) { if (e instanceof MonitorError) return bad(e.code, e.status); throw e; }
});
export const DELETE = (request: Request) => userRoute(request, true, async user => {
  const input = body.pick({ expoPushToken: true }).safeParse(await jsonBody(request, 1_000));
  if (!input.success) return bad("INVALID_REQUEST");
  await removeDeviceToken(user.id, input.data.expoPushToken);
  return { removed: true };
});
