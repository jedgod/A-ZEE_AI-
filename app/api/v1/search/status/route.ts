import { searchConfigured, SEARCH_PROVIDER } from "@/lib/search/tavily";
import { NO_STORE, searchRoute } from "@/lib/search/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/search/status: whether live web search is configured (never reveals the key). */
export function GET(request: Request) {
  return searchRoute(request, false, async () => Response.json({ data: { configured: searchConfigured(), provider: SEARCH_PROVIDER } }, { headers: NO_STORE }));
}
