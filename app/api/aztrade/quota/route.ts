import { z } from "zod";
import { pool } from "@/lib/admin/db";
import { allow } from "@/lib/users/auth";
import { aztradeConfig, AztradeUnavailable, serviceAuthorized } from "@/lib/aztrade/identity";
import { dailyLimit, refundQuota, reserveQuota } from "@/lib/aztrade/quota";

export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store" };

const body = z.object({
  userId: z.string().min(1).max(128),
  feature: z.enum(["backtest", "research"]),
  requestId: z.string().uuid(),
  action: z.enum(["reserve", "refund"]),
}).strict();

/**
 * Service-to-service: the AZTrade backend reserves (or refunds) one daily quota slot for a user before it runs a
 * backtest. The limit comes from A-Zee's live subscription, never from the caller. Off in production unless an
 * operator has placed it behind a private network, exactly like /api/aztrade/introspect.
 */
export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production" && process.env.AZTRADE_INTROSPECT_ROUTE !== "private-network") return new Response(null, { status: 404, headers });
  let config;
  try { config = aztradeConfig(); } catch (e) { return Response.json({ error: "AZTRADE_UNAVAILABLE" }, { status: e instanceof AztradeUnavailable ? 503 : 500, headers }); }
  if (!serviceAuthorized(request, config)) return Response.json({ error: "UNAUTHORIZED" }, { status: 401, headers });

  let input;
  try { input = body.parse(await request.json()); } catch { return Response.json({ error: "INVALID_REQUEST" }, { status: 400, headers }); }
  if (!await allow("aztrade-quota", "service", 6000)) return Response.json({ error: "RATE_LIMITED" }, { status: 429, headers });
  try {
    const user = (await pool.query(`SELECT id FROM users WHERE id = $1 AND email_verified_at IS NOT NULL`, [input.userId])).rows[0];
    if (!user) return Response.json({ error: "IDENTITY_REFUSED" }, { status: 403, headers });
    if (input.action === "refund") return Response.json({ refunded: await refundQuota(input) }, { headers });
    const limit = await dailyLimit(input.userId, input.feature);
    const result = await reserveQuota({ ...input, limit });
    return Response.json(result, { status: result.allowed ? 200 : 429, headers });
  } catch (error) {
    console.error("aztrade quota error:", (error as Error).message);
    return Response.json({ error: "QUOTA_UNAVAILABLE" }, { status: 503, headers });   // fail closed: the caller refuses the work
  }
}
