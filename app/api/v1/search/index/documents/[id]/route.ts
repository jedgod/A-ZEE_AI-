import { indexRoute, noContent, ok } from "@/lib/search-index/route";
import { body } from "@/lib/sidebar-route";
import { deleteDocument, getDocument, updateDocument } from "@/lib/search-index/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type P = { params: Promise<{ id: string }> };

/** GET /api/v1/search/index/documents/:id: metadata and the indexed text. */
export function GET(request: Request, { params }: P) {
  return indexRoute(request, false, async owner => ok(await getDocument(owner, (await params).id)));
}

/** PUT /api/v1/search/index/documents/:id { title?, content }: text documents only. */
export function PUT(request: Request, { params }: P) {
  return indexRoute(request, true, async owner => ok(await updateDocument(owner, (await params).id, await body(request, 1_100_000))));
}

/** DELETE /api/v1/search/index/documents/:id */
export function DELETE(request: Request, { params }: P) {
  return indexRoute(request, true, async owner => { await deleteDocument(owner, (await params).id); return noContent(); });
}
