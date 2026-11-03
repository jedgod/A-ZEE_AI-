import { listJobs } from "@/lib/research/jobs";
import { NO_STORE, searchRoute } from "@/lib/search/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/research/jobs: this account's research jobs, newest first. */
export function GET(request: Request) {
  return searchRoute(request, false, async ({ owner }) => Response.json({ data: await listJobs(owner) }, { headers: NO_STORE }));
}
