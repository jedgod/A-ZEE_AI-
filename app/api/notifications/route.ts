import { listNotifications, markRead } from "@/lib/users/features";
import { jsonBody, userRoute } from "@/lib/users/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET: latest notifications. PATCH { id } marks one read; PATCH { all: true } marks all read. */
export const GET = (request: Request) => userRoute(request, false, user => listNotifications(user.id));
export const PATCH = (request: Request) => userRoute(request, true, async user => { await markRead(user.id, await jsonBody(request)); return { ok: true }; });
