import { AztradeUnavailable, jwksFor } from "@/lib/aztrade/identity";

export const runtime = "nodejs";

/** GET: the public signing keys (the current one plus any previous keys still honoured during a rotation). Public by design. */
export async function GET() {
  try { return Response.json(jwksFor(), { headers: { "Cache-Control": "public, max-age=60" } }); }
  catch (error) {
    if (error instanceof AztradeUnavailable) return Response.json({ error: "AZTRADE_UNAVAILABLE" }, { status: 503, headers: { "Cache-Control": "no-store" } });
    return Response.json({ error: "KEY_UNAVAILABLE" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
