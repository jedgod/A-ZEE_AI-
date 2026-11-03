import { authorize, PlatformError } from "@/lib/platform/auth";
import { MAX_MESSAGE_CHARACTERS } from "@/lib/chat/contracts";
export const runtime = "nodejs";

// Lets IDE clients verify their URL and token without spending an AI request.
export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  try {
    const actor = await authorize(request);
    return Response.json({
      data: {
        ok: true,
        keyId: actor.id,
        tenantId: actor.tenant_id,
        scopes: actor.scopes,
        expiresAt: new Date(actor.expires_at).toISOString(),
        modes: ["chat", "code", "research"],
        maxMessageCharacters: MAX_MESSAGE_CHARACTERS,
      },
    }, { headers });
  } catch (error) {
    const status = error instanceof PlatformError ? error.status : 503;
    const code = error instanceof PlatformError ? error.code : "SERVICE_UNAVAILABLE";
    return Response.json({ error: code }, { status, headers: { ...headers, ...(status === 429 ? { "Retry-After": "60" } : {}) } });
  }
}
