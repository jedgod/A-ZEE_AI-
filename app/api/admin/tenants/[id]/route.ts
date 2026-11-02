// ============================================================
// 15_ADMIN / TENANT ITEM
// ============================================================
import { z } from "zod";
import { pool } from "@/lib/admin/db";
import { endpoint, fail, json } from "@/lib/admin/errors";
import { platform, rateLimit, readBody, requireActor, sameOrigin } from "@/lib/admin/security";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export function GET(_request: Request, context: Context) {
  return endpoint(async () => {
    const id = z.string().uuid().parse((await context.params).id);
    const actor = await requireActor();
    platform(actor);
    await rateLimit(actor, false);

    const result = await pool.query(
      `SELECT id, name, status, owner_user_id, created_at, updated_at
       FROM admin_tenants
       WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );

    if (!result.rowCount) fail(404, "NOT_FOUND");
    return json(result.rows[0]);
  });
}

export function PATCH(request: Request, context: Context) {
  return endpoint(async () => {
    sameOrigin(request);
    const id = z.string().uuid().parse((await context.params).id);
    const actor = await requireActor();
    platform(actor);
    await rateLimit(actor, true);

    const body = z.object({
      name: z.string().trim().min(1).max(150).optional(),
      status: z.enum(["active", "review", "suspended"]).optional(),
      ownerUserId: z.string().uuid().optional(),
    }).strict().parse(await readBody(request));

    const result = await pool.query(
      `UPDATE admin_tenants
       SET name = COALESCE($2, name), status = COALESCE($3, status), owner_user_id = COALESCE($4, owner_user_id), updated_at = NOW()
       WHERE id = $1
       RETURNING id, name, status, owner_user_id, created_at, updated_at`,
      [id, body.name ?? null, body.status ?? null, body.ownerUserId ?? null]
    );

    if (!result.rowCount) fail(404, "NOT_FOUND");
    return json(result.rows[0]);
  });
}

export function DELETE(request: Request, context: Context) {
  return endpoint(async () => {
    sameOrigin(request);
    const id = z.string().uuid().parse((await context.params).id);
    const actor = await requireActor();
    platform(actor);
    await rateLimit(actor, true);

    const result = await pool.query(
      `UPDATE admin_tenants
       SET status = 'suspended', updated_at = NOW()
       WHERE id = $1 AND status <> 'suspended'
       RETURNING id`,
      [id]
    );

    if (!result.rowCount) fail(404, "NOT_FOUND");
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  });
}
