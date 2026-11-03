import { indexRoute, noContent, ok } from "@/lib/search-index/route";
import { status } from "@/lib/search-index/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/search/index: engine and readiness (vector search reports whether pgvector exists). */
export function GET(request: Request) {
  return indexRoute(request, false, async () => ok(await status()));
}
