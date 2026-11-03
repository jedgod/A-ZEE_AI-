import { cancelJob, getJob } from "@/lib/research/jobs";
import { NO_STORE, searchRoute } from "@/lib/search/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

/** GET /api/v1/research/jobs/:id: status, phase, plan and per-step progress (resumes an interrupted job). */
export function GET(request: Request, context: Context) {
  return searchRoute(request, false, async ({ owner, actor }) => Response.json({ data: await getJob(owner, (await context.params).id, actor) }, { headers: NO_STORE }));
}

/** DELETE /api/v1/research/jobs/:id: cancel a running job. */
export function DELETE(request: Request, context: Context) {
  return searchRoute(request, true, async ({ owner }) => Response.json({ data: await cancelJob(owner, (await context.params).id) }, { headers: NO_STORE }));
}
