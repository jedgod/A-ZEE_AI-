import { statuses } from "@/lib/connectors/service";
import { connectorRoute, NO_STORE } from "@/lib/connectors/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/connectors: each provider's configuration and connection status (never tokens). */
export function GET(request: Request) {
  return connectorRoute(request, false, async owner => Response.json({ data: await statuses(owner) }, { headers: NO_STORE }));
}
