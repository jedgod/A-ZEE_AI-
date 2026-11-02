// ============================================================
// 15_ADMIN / POLICIES COLLECTION
// ============================================================
import { listSchema } from "@/lib/admin/contracts";
import { endpoint, json } from "@/lib/admin/errors";
import { AdminService } from "@/lib/admin/service";
import { rateLimit, readBody, requireActor, sameOrigin } from "@/lib/admin/security";

export const runtime = "nodejs";

export function GET(request: Request) {
  return endpoint(async () => {
    const actor = await requireActor();
    await rateLimit(actor, false);

    const search = new URL(request.url).searchParams;
    const pagination = listSchema.parse({
      limit: search.get("limit") ?? undefined,
      offset: search.get("offset") ?? undefined,
    });

    const rows = await new AdminService("policies").list(
      actor,
      pagination.limit,
      pagination.offset,
    );

    return json({ items: rows, ...pagination });
  });
}

export function POST(request: Request) {
  return endpoint(async () => {
    sameOrigin(request);
    const actor = await requireActor();
    await rateLimit(actor, true);

    const result = await new AdminService("policies").create(
      actor,
      await readBody(request),
    );

    return json(result, 201);
  });
}
