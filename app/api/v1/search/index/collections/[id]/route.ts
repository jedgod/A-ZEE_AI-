import { indexRoute, noContent, ok } from "@/lib/search-index/route";
import { deleteCollection } from "@/lib/search-index/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type P = { params: Promise<{ id: string }> };

/** DELETE /api/v1/search/index/collections/:id (its documents are removed from the index). */
export function DELETE(request: Request, { params }: P) {
  return indexRoute(request, true, async owner => { await deleteCollection(owner, (await params).id); return noContent(); });
}
