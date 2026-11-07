import { endpoint, json } from "@/lib/admin/errors";
import { loadProviders } from "@/lib/admin/providers";
import { rateLimit, requireActor } from "@/lib/admin/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/admin/providers?days=1|7: configured AI providers and their performance. Owners and admins only. */
export function GET(request: Request) {
  return endpoint(async () => {
    const actor = await requireActor();
    await rateLimit(actor, false);
    const days = new URL(request.url).searchParams.get("days") === "7" ? 7 : 1;
    return json({ data: await loadProviders(actor, days) });
  });
}
