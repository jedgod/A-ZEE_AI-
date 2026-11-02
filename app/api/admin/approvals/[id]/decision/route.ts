// ============================================================
// 15_ADMIN / APPROVAL REVIEW
// ============================================================
import { z } from "zod";
import { endpoint, json } from "@/lib/admin/errors";
import { rateLimit, readBody, requireActor, sameOrigin } from "@/lib/admin/security";
import { reviewApproval } from "@/lib/admin/service";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

const decisionSchema = z.object({
  revision: z.coerce.number().int().positive(),
  decision: z.enum(["approved", "rejected"]),
}).strict();

export function POST(request: Request, context: Context) {
  return endpoint(async () => {
    sameOrigin(request);
    const id = z.string().uuid().parse((await context.params).id);
    const actor = await requireActor();
    await rateLimit(actor, true);
    const body = decisionSchema.parse(await readBody(request));

    return json(await reviewApproval(actor, id, body.revision, body.decision));
  });
}
