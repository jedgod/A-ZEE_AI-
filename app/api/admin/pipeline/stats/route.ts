import { endpoint, json } from "@/lib/admin/errors";
import { loadStageLive } from "@/lib/admin/live";
import { rateLimit, requireActor } from "@/lib/admin/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/admin/pipeline/stats: last-24h activity per pipeline stage (metadata only). */
export function GET() {
  return endpoint(async () => {
    const actor = await requireActor();
    await rateLimit(actor, false);
    return json({ data: await loadStageLive(actor) });
  });
}
