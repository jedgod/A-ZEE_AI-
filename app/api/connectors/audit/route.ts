import { recentAudit } from "@/lib/connectors/service";
import { connectorRoute, NO_STORE } from "@/lib/connectors/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/connectors/audit: recent connector activity for this account. */
export function GET(request: Request) {
  return connectorRoute(request, false, async owner => Response.json({ data: await recentAudit(owner) }, { headers: NO_STORE }));
}
