import { body } from "@/lib/sidebar-route";
import { compare } from "@/lib/search/engine";
import { NO_STORE, searchRoute } from "@/lib/search/route";

export const runtime = "nodejs";
export const maxDuration = 120;

/** POST /api/v1/search/compare { a, b, focus? }: aspect-by-aspect comparison, every cell quote-verified. */
export function POST(request: Request) {
  return searchRoute(request, true, async ({ owner, actor }) => Response.json({ data: await compare(owner, actor, await body(request)) }, { headers: NO_STORE }));
}
