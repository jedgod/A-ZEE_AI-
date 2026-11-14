import { z } from "zod";
import { readJson } from "@/lib/http";
import { allow, requireUser, strictOrigin, userFailure } from "@/lib/users/auth";
import { ASSET_CLASSES } from "@/lib/finance/provider";
import { fetchQuoteBatch } from "@/lib/finance/batch";

export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store" };
const body = z.object({ items: z.array(z.object({ symbol: z.string().min(1).max(20), assetClass: z.enum(ASSET_CLASSES) }).strict()).min(1).max(25) }).strict();

/** Delayed, informational quotes for a watchlist or practice portfolio. Not a licensed feed, and never used for trading signals. */
export async function POST(request: Request) {
  try {
    strictOrigin(request);
    const user = await requireUser(request, true);
    if (!await allow("finance-quotes", user.id, 12)) return Response.json({ error: "RATE_LIMITED" }, { status: 429, headers });
    const input = body.safeParse(await readJson(request, 4_000));
    if (!input.success) return Response.json({ error: "INVALID_REQUEST" }, { status: 400, headers });
    return Response.json({ results: await fetchQuoteBatch(input.data.items), label: "Informational · Delayed" }, { headers });
  } catch (e) {
    return userFailure(e);
  }
}
