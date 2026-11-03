import { isLocalRequest } from "@/lib/pipeline/actor";
import { canViewInsights, loadInsights, parseDays } from "@/lib/pipeline/insights";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/insights?days=1|7|30[&download=1]: the /insights aggregates as JSON (metadata only:
 * counts, timings, ratings; never prompts or answers). `download=1` serves it as a file.
 */
export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  if (!await canViewInsights(isLocalRequest(request))) return Response.json({ error: "FORBIDDEN" }, { status: 403, headers });
  const params = new URL(request.url).searchParams;
  const days = parseDays(params.get("days") ?? 1);
  if (!days) return Response.json({ error: "INVALID_PERIOD", allowed: [1, 7, 30] }, { status: 422, headers });
  try {
    const data = await loadInsights(days * 24);
    if (!data) return Response.json({ error: "INSIGHTS_UNAVAILABLE" }, { status: 503, headers });
    const body = { data: { periodDays: days, generatedAt: new Date().toISOString(), ...data } };
    if (params.get("download") !== "1") return Response.json(body, { headers });
    const file = `az-insights-${days}d-${body.data.generatedAt.slice(0, 10)}.json`;
    return new Response(JSON.stringify(body, null, 2), {
      headers: { ...headers, "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="${file}"` },
    });
  } catch {
    return Response.json({ error: "INSIGHTS_UNAVAILABLE" }, { status: 503, headers });
  }
}
