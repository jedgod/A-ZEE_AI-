import { indexRoute, noContent, ok } from "@/lib/search-index/route";
import { body } from "@/lib/sidebar-route";
import { createCollection, listCollections } from "@/lib/search-index/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/search/index/collections */
export function GET(request: Request) {
  return indexRoute(request, false, async owner => ok(await listCollections(owner)));
}

/** POST /api/v1/search/index/collections { name } */
export function POST(request: Request) {
  return indexRoute(request, true, async owner => ok(await createCollection(owner, await body(request, 2_000)), 201));
}
