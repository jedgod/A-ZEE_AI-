import { indexRoute, noContent, ok } from "@/lib/search-index/route";
import { search } from "@/lib/search-index/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/search/index/query?q=&collectionId=&limit=: ranked excerpts with provenance. */
export function GET(request: Request) {
  return indexRoute(request, false, async owner => {
    const p = new URL(request.url).searchParams;
    return ok(await search(owner, { q: p.get("q") ?? "", collectionId: p.get("collectionId") || null, limit: p.get("limit") ?? undefined }));
  });
}
