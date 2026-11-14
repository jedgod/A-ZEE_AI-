import { z } from "zod";
import { readJson } from "@/lib/http";
import { allow, requireUser, strictOrigin, userFailure } from "@/lib/users/auth";
import { ASSET_CLASSES, fetchMultiAssetQuote, FinanceError } from "@/lib/finance/provider";

export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store" };
const body = z.object({ symbol: z.string().min(1).max(20), assetClass: z.enum(ASSET_CLASSES).default("stocks_etfs") }).strict();

/** Informational quote for a signed-in user (web cookie or mobile bearer). Not connected to AZTrade. */
export async function POST(request: Request) {
  try {
    strictOrigin(request);
    const user = await requireUser(request, true);
    if (!await allow("finance-quote", user.id, 30)) return Response.json({ error: "RATE_LIMITED" }, { status: 429, headers });
    const input = body.safeParse(await readJson(request, 2_000));
    if (!input.success) return Response.json({ error: "INVALID_REQUEST" }, { status: 400, headers });
    return Response.json({ quote: await fetchMultiAssetQuote(input.data.symbol, input.data.assetClass) }, { headers });
  } catch (e) {
    if (e instanceof FinanceError) return Response.json({ error: e.code }, { status: e.status, headers });
    return userFailure(e);
  }
}
