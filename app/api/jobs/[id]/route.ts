import { handle, NO_STORE, sidebarOwner } from "@/lib/sidebar-route";
import { getJob } from "@/lib/video-jobs";
import { refreshJob } from "@/lib/video-provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/jobs/:id -> { job }: the signed-in account's own job, for the app to poll until it completes. */
export function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const owner = await sidebarOwner(request);
    const job = await getJob(owner, (await context.params).id);
    if (!job) return Response.json({ error: "NOT_FOUND" }, { status: 404, headers: NO_STORE });
    return Response.json({ job: await refreshJob(owner, job) }, { headers: NO_STORE });
  });
}
