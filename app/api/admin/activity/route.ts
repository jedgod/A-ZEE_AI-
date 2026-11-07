import { endpoint, json } from "@/lib/admin/errors";
import { loadActivity, parseKinds } from "@/lib/admin/live";
import { rateLimit, requireActor } from "@/lib/admin/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/admin/activity?kinds=admin,pipeline,feedback&limit=30&before=<iso>: newest-first merged feed. */
export function GET(request: Request) {
  return endpoint(async () => {
    const actor = await requireActor();
    await rateLimit(actor, false);
    const q = new URL(request.url).searchParams;
    const limit = Number(q.get("limit") ?? 30);
    return json({ data: await loadActivity(actor, { kinds: parseKinds(q.get("kinds")), limit: Number.isFinite(limit) ? limit : 30, before: q.get("before") }) });
  });
}
