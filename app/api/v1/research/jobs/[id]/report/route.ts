import { getReport, reportMarkdown } from "@/lib/research/jobs";
import { NO_STORE, searchRoute } from "@/lib/search/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/research/jobs/:id/report[?format=md]: the referenced report (JSON, or a Markdown download). */
export function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return searchRoute(request, false, async ({ owner }) => {
    const report = await getReport(owner, (await context.params).id);
    if (new URL(request.url).searchParams.get("format") !== "md") return Response.json({ data: report }, { headers: NO_STORE });
    const name = report.title.replace(/[^\w\- ]+/g, "").trim().slice(0, 60).replace(/\s+/g, "-") || "research-report";
    return new Response(reportMarkdown(report), { headers: { ...NO_STORE, "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": `attachment; filename="${name}.md"` } });
  });
}
