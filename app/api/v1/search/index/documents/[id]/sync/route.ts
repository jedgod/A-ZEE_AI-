import { indexRoute, noContent, ok } from "@/lib/search-index/route";
import { syncDocument } from "@/lib/search-index/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type P = { params: Promise<{ id: string }> };

/** POST /api/v1/search/index/documents/:id/sync: re-fetch a connector document (read-only). */
export function POST(request: Request, { params }: P) {
  return indexRoute(request, true, async owner => ok(await syncDocument(owner, (await params).id)));
}
