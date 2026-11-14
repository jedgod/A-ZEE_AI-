import { z } from "zod";
import { jsonBody, userRoute } from "@/lib/users/route";
import { allow } from "@/lib/users/auth";
import { fetchSparklines } from "@/lib/finance/history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const body = z.object({ items: z.array(z.object({ symbol: z.string().min(1).max(20), assetClass: z.enum(["crypto", "stocks_etfs", "forex", "commodities"]) }).strict()).min(1).max(20) }).strict();

/** Small trend lines for a list of monitors: about 48 points each, 24 hours (1 week for forex, whose source is daily). */
export const POST = (request: Request) => userRoute(request, true, async user => {
  if (!await allow("finance-sparklines", user.id, 12)) return Response.json({ error: "RATE_LIMITED" }, { status: 429, headers });
  const input = body.safeParse(await jsonBody(request, 4_000));
  if (!input.success) return Response.json({ error: "INVALID_REQUEST" }, { status: 400, headers });
  return { results: await fetchSparklines(input.data.items) };
});
