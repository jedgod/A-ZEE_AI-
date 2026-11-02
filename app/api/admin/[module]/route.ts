// ============================================================
// 15_ADMIN / COLLECTION CRUD — GET, POST
// ============================================================
import { moduleSchema, listSchema } from "@/lib/admin/contracts";
import { AdminService } from "@/lib/admin/service";
import { requireActor, sameOrigin, rateLimit, readBody } from "@/lib/admin/security";
import { endpoint, json } from "@/lib/admin/errors";

export const runtime = "nodejs";

type Context = { params: Promise<{ module: string }> };

export function GET(request: Request, context: Context) {
  return endpoint(async () => {
    const module = moduleSchema.parse((await context.params).module);
    const actor = await requireActor();
    await rateLimit(actor, false);

    const search = new URL(request.url).searchParams;
    const pagination = listSchema.parse({
      limit: search.get("limit") ?? undefined,
      offset: search.get("offset") ?? undefined,
    });

    const rows = await new AdminService(module).list(
      actor,
      pagination.limit,
      pagination.offset
    );

    return json({ items: rows, ...pagination });
  });
}

export function POST(request: Request, context: Context) {
  return endpoint(async () => {
    sameOrigin(request);
    const module = moduleSchema.parse((await context.params).module);
    const actor = await requireActor();
    await rateLimit(actor, true);

    const result = await new AdminService(module).create(
      actor,
      await readBody(request)
    );

    return json(result, 201);
  });
}
