import { disconnect, isProvider } from "@/lib/connectors/service";
import { connectorRoute, NO_STORE } from "@/lib/connectors/route";

export const runtime = "nodejs";

/** DELETE /api/connectors/:provider: revoke (best effort) and delete the stored tokens. */
export function DELETE(request: Request, context: { params: Promise<{ provider: string }> }) {
  return connectorRoute(request, true, async owner => {
    const { provider } = await context.params;
    if (!isProvider(provider)) return Response.json({ error: "UNKNOWN_PROVIDER" }, { status: 404, headers: NO_STORE });
    await disconnect(owner, provider);
    return new Response(null, { status: 204, headers: NO_STORE });
  });
}
