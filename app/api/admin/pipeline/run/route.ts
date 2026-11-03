import { z } from "zod";
import { endpoint, fail, json } from "@/lib/admin/errors";
import { dryRun } from "@/lib/admin/pipeline";
import { findModule } from "@/lib/admin/pipeline-catalog";
import { rateLimit, readBody, requireActor, sameOrigin } from "@/lib/admin/security";

export const runtime = "nodejs";

const bodySchema = z.object({ slug: z.string().max(80), input: z.string().min(1).max(20_000) }).strict();

/**
 * POST /api/admin/pipeline/run: dry run of one deterministic stage module (/admin/pipeline).
 * Owners and admins only. No AI or network call; input and output are not stored or logged.
 */
export function POST(request: Request) {
  return endpoint(async () => {
    sameOrigin(request);
    const actor = await requireActor();
    if (actor.role !== "owner" && actor.role !== "admin") fail(403, "FORBIDDEN");
    await rateLimit(actor, true);
    const body = bodySchema.parse(await readBody(request));
    const entry = findModule(body.slug);
    if (!entry?.dryRun) fail(404, "NO_DRY_RUN");
    try {
      return json({ module: entry.slug, result: await dryRun(entry.dryRun.kind, body.input) });
    } catch (error) {
      if (error instanceof SyntaxError) fail(422, "INVALID_JSON");
      if (error instanceof z.ZodError) fail(422, "INVALID_INPUT", error.issues.slice(0, 5).map(i => `${i.path.join(".") || "input"}: ${i.message}`));
      fail(422, "MODULE_REJECTED_INPUT", (error as Error).message?.slice(0, 200));
    }
  });
}
