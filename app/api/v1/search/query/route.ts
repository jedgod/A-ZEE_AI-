import { z } from "zod";
import { body } from "@/lib/sidebar-route";
import { smartSearch } from "@/lib/search/engine";
import { NO_STORE, searchRoute } from "@/lib/search/route";

export const runtime = "nodejs";
export const maxDuration = 60;

/** POST /api/v1/search/query { query, recency? }: cited, verified answer from live web sources. */
export function POST(request: Request) {
  return searchRoute(request, true, async ({ owner, actor }) => {
    const input = z.object({ query: z.string(), recency: z.enum(["any", "week", "month", "year"]).optional() }).strict().parse(await body(request));
    return Response.json({ data: await smartSearch(owner, actor, input.query, { recency: input.recency }) }, { headers: NO_STORE });
  });
}
