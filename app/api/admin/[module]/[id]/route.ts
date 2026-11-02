// ============================================================
// 15_ADMIN / ITEM CRUD — GET, PATCH, DELETE
// ============================================================
import { z } from "zod";
import { moduleSchema, updateSchema } from "@/lib/admin/contracts";
import { AdminService } from "@/lib/admin/service";
import { requireActor, sameOrigin, rateLimit, readBody } from "@/lib/admin/security";
import { endpoint, json } from "@/lib/admin/errors";

export const runtime = "nodejs";

type Context = { params: Promise<{ module: string; id: string }> };

async function target(context: Context) {
  const params = await context.params;
  return {
    module: moduleSchema.parse(params.module),
    id: z.string().uuid().parse(params.id),
  };
}

export function GET(_request: Request, context: Context) {
  return endpoint(async () => {
    const { module, id } = await target(context);
    const actor = await requireActor();
    await rateLimit(actor, false);
    return json(await new AdminService(module).get(actor, id));
  });
}

export function PATCH(request: Request, context: Context) {
  return endpoint(async () => {
    sameOrigin(request);
    const { module, id } = await target(context);
    const actor = await requireActor();
    await rateLimit(actor, true);
    const body = updateSchema.parse(await readBody(request));
    return json(await new AdminService(module).update(actor, id, body.revision, body.payload));
  });
}

export function DELETE(request: Request, context: Context) {
  return endpoint(async () => {
    sameOrigin(request);
    const { module, id } = await target(context);
    const actor = await requireActor();
    await rateLimit(actor, true);
    const revision = z.coerce.number().int().positive().parse(
      new URL(request.url).searchParams.get("revision")
    );
    await new AdminService(module).remove(actor, id, revision);
    return new Response(null, {
      status: 204,
      headers: { "Cache-Control": "no-store" },
    });
  });
}
