// ============================================================
// 15_ADMIN / PLATFORM TENANT COLLECTION
// ============================================================
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { pool, transaction } from "@/lib/admin/db";
import { requireActor, platform, sameOrigin, rateLimit, readBody } from "@/lib/admin/security";
import { endpoint, json } from "@/lib/admin/errors";

export const runtime = "nodejs";

export function GET(request: Request) {
  return endpoint(async () => {
    const actor = await requireActor();
    platform(actor);
    await rateLimit(actor, false);

    const offset = z.coerce.number().int().min(0).max(10000).parse(
      new URL(request.url).searchParams.get("offset") ?? 0
    );

    const result = await pool.query(
      `SELECT id, name, status, revision
       FROM admin_tenants
       WHERE deleted_at IS NULL
       ORDER BY created_at, id
       LIMIT 100 OFFSET $1`,
      [offset]
    );

    return json(result.rows);
  });
}

export function POST(request: Request) {
  return endpoint(async () => {
    sameOrigin(request);
    const actor = await requireActor();
    platform(actor);
    await rateLimit(actor, true);

    const input = z.object({
      name: z.string().trim().min(1).max(150),
      ownerUserId: z.string().uuid(),
    }).strict().parse(await readBody(request));

    return json(await transaction(async (db) => {
      const id = randomUUID();
      await db.query(
        `INSERT INTO admin_tenants (id, name, owner_user_id) VALUES ($1, $2, $3)`,
        [id, input.name, input.ownerUserId]
      );
      await db.query(
        `INSERT INTO admin_memberships (tenant_id, user_id, role, status)
         VALUES ($1, $2, 'owner', 'active')`,
        [id, input.ownerUserId]
      );
      await db.query(
        `INSERT INTO admin_audit (id, tenant_id, actor_id, action, resource_id)
         VALUES ($1, $2, $3, 'tenant.create', $2)`,
        [randomUUID(), id, actor.userId]
      );
      return { id, name: input.name, revision: 1 };
    }), 201);
  });
}
