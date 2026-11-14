import { z } from "zod";
import { jsonBody, userRoute } from "@/lib/users/route";
import { allow } from "@/lib/users/auth";
import { fetchHistory, RANGES } from "@/lib/finance/history";
import { FinanceError } from "@/lib/finance/provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const body = z.object({ symbol: z.string().min(1).max(20), assetClass: z.enum(["crypto", "stocks_etfs", "forex", "commodities"]), range: z.enum(RANGES), candles: z.boolean().optional() }).strict();

/** Price history for the chart: { symbol, assetClass, range: "1D"|"1W"|"1M"|"3M"|"1Y", candles? }. Delayed and informational. */
export const POST = (request: Request) => userRoute(request, true, async user => {
  if (!await allow("finance-history", user.id, 40)) return Response.json({ error: "RATE_LIMITED" }, { status: 429, headers });
  const input = body.safeParse(await jsonBody(request, 1_000));
  if (!input.success) return Response.json({ error: "INVALID_REQUEST" }, { status: 400, headers });
  try { return await fetchHistory(input.data.symbol, input.data.assetClass, input.data.range, { candles: input.data.candles }); }
  catch (e) { if (e instanceof FinanceError) return Response.json({ error: e.code }, { status: e.status, headers }); throw e; }
});
