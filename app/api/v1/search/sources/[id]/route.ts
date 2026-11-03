import { sourceById } from "@/lib/search/engine";
import { NO_STORE, searchRoute } from "@/lib/search/route";

export const runtime = "nodejs";

/** GET /api/v1/search/sources/:id: a retrieved source (title, URL, dates, relevance, excerpt). */
export function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return searchRoute(request, false, async ({ owner }) => {
    const source = await sourceById(owner, (await context.params).id);
    return source ? Response.json({ data: source }, { headers: NO_STORE }) : Response.json({ error: "NOT_FOUND" }, { status: 404, headers: NO_STORE });
  });
}
