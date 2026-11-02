// ============================================================
// 15_ADMIN / REGISTRY ITEM
// ============================================================
import { z } from "zod";
import { updateSchema } from "@/lib/admin/contracts";
import { endpoint, json } from "@/lib/admin/errors";
import { AdminService } from "@/lib/admin/service";
import { rateLimit, readBody, requireActor, sameOrigin } from "@/lib/admin/security";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export function GET(_request: Request, context: Context) {
  return endpoint(async () => {
    const id = z.string().uuid().parse((await context.params).id);
    const actor = await requireActor();
    await rateLimit(actor, false);
    return json(await new AdminService("registry").get(actor, id));
  });
}

export function PATCH(request: Request, context: Context) {
  return endpoint(async () => {
    sameOrigin(request);
    const id = z.string().uuid().parse((await context.params).id);
    const actor = await requireActor();
    await rateLimit(actor, true);
    const body = updateSchema.parse(await readBody(request));
    return json(await new AdminService("registry").update(actor, id, body.revision, body.payload));
  });
}

export function DELETE(request: Request, context: Context) {
  return endpoint(async () => {
    sameOrigin(request);
    const id = z.string().uuid().parse((await context.params).id);
    const actor = await requireActor();
    await rateLimit(actor, true);
    const revision = z.coerce.number().int().positive().parse(
      new URL(request.url).searchParams.get("revision")
    );
    await new AdminService("registry").remove(actor, id, revision);
    return new Response(null, {
      status: 204,
      headers: { "Cache-Control": "no-store" },
    });
  });
}
