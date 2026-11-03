import { isProvider, startConnect } from "@/lib/connectors/service";
import { connectorRoute, NO_STORE } from "@/lib/connectors/route";

export const runtime = "nodejs";

/** POST /api/connectors/:provider/connect -> { url }: the provider's consent page (single-use state, PKCE). */
export function POST(request: Request, context: { params: Promise<{ provider: string }> }) {
  return connectorRoute(request, true, async owner => {
    const { provider } = await context.params;
    if (!isProvider(provider)) return Response.json({ error: "UNKNOWN_PROVIDER" }, { status: 404, headers: NO_STORE });
    return Response.json({ data: await startConnect(owner, provider) }, { headers: NO_STORE });
  });
}
