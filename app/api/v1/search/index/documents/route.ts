import { indexRoute, noContent, ok } from "@/lib/search-index/route";
import { body } from "@/lib/sidebar-route";
import { ingest, listDocuments } from "@/lib/search-index/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/search/index/documents[?collectionId=] */
export function GET(request: Request) {
  return indexRoute(request, false, async owner => ok(await listDocuments(owner, new URL(request.url).searchParams.get("collectionId"))));
}

/** POST /api/v1/search/index/documents: { source: "text", title, content } | { source: "github", repo, path, ref? } | { source: "google_drive", fileId }, plus collectionId. */
export function POST(request: Request) {
  return indexRoute(request, true, async owner => {
    const result = await ingest(owner, await body(request, 1_100_000));
    return ok(result, result.outcome === "created" ? 201 : 200);
  });
}
