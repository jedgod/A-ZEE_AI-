import { allow } from "@/lib/users/auth";
import { aztradeConfig, AztradeUnavailable, introspect, serviceAuthorized } from "@/lib/aztrade/identity";

export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store" };

/**
 * POST { token } -> { active, ... }. Service-to-service only: the dedicated credential is required, and the answer is
 * recomputed from A-Zee's live session store and billing on every call (nothing cached), so sign-out and downgrades
 * apply to the very next AZTrade request. Keep this on a private network in deployment.
 */
export async function POST(request: Request) {
  // In production this route is off unless an operator has explicitly placed it behind a private, mTLS-terminating
  // layer (or uses the standalone mTLS listener instead). Never reachable from the public internet by default.
  if (process.env.NODE_ENV === "production" && process.env.AZTRADE_INTROSPECT_ROUTE !== "private-network") return new Response(null, { status: 404, headers });
  let config;
  try { config = aztradeConfig(); } catch (e) { return Response.json({ active: false, error: "AZTRADE_UNAVAILABLE" }, { status: e instanceof AztradeUnavailable ? 503 : 500, headers }); }
  if (!serviceAuthorized(request, config)) return Response.json({ active: false }, { status: 401, headers });
  if (!await allow("aztrade-introspect", "service", 6000)) return Response.json({ active: false, error: "RATE_LIMITED" }, { status: 429, headers });
  const body = await request.json().catch(() => null) as { token?: unknown } | null;
  if (typeof body?.token !== "string" || body.token.length > 8192) return Response.json({ active: false }, { status: 400, headers });
  try { return Response.json(await introspect(body.token, config), { headers }); }
  catch { return Response.json({ active: false, error: "INTROSPECTION_UNAVAILABLE" }, { status: 503, headers }); }   // fail closed: AZTrade treats any non-200 as refused
}
