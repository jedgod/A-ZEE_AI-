import { z } from "zod";
import { body } from "@/lib/sidebar-route";
import { createJob } from "@/lib/research/jobs";
import { NO_STORE, searchRoute } from "@/lib/search/route";

export const runtime = "nodejs";

/** POST /api/v1/search/deep-research { question }: starts a durable research job (202). Poll /api/v1/research/jobs/:id. */
export function POST(request: Request) {
  return searchRoute(request, true, async ({ owner, actor }) => {
    const { question } = z.object({ question: z.string() }).strict().parse(await body(request));
    const job = await createJob(owner, actor, question);
    return Response.json({ data: job }, { status: 202, headers: { ...NO_STORE, Location: `/api/v1/research/jobs/${job.id}` } });
  });
}
