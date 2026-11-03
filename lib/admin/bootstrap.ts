import "server-only";
import { z } from "zod";
import { tx, deny } from "./core";
import { issueSession } from "./host-session";

const schema = z.object({
  email: z.string().email(),
  tenantName: z.string().min(1).max(150).default("Local workspace"),
  role: z.enum(["owner", "admin", "reviewer", "operator", "viewer"]).default("owner"),
  platform: z.boolean().default(true),
}).strict();

export async function bootstrapAdminRuntime(raw: unknown) {
  if (process.env.NODE_ENV === "production") {
    deny(403, "BOOTSTRAP_DISABLED");
  }

  const input = schema.parse(raw);

  const actor = await tx(async db => {
    const user = await db.query(
      "INSERT INTO admin_identities(id, email, platform_admin) " +
        "VALUES (gen_random_uuid(), $1, $2) " +
        "ON CONFLICT (email) DO UPDATE SET platform_admin = excluded.platform_admin " +
        "RETURNING id",
      [input.email, input.platform]
    );

    const tenant = await db.query(
      "INSERT INTO admin_tenants(id, name, status) " +
        "VALUES (gen_random_uuid(), $1, 'active') " +
        "ON CONFLICT (name) DO UPDATE SET status = 'active' " +
        "RETURNING id",
      [input.tenantName]
    );

    const userId = user.rows[0].id;
    const tenantId = tenant.rows[0].id;

    await db.query(
      "INSERT INTO admin_memberships(tenant_id, user_id, role, status) " +
        "VALUES ($1, $2, $3, 'active') " +
        "ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = excluded.role, status = 'active'",
      [tenantId, userId, input.role]
    );

    return { userId, tenantId, role: input.role };
  });
  const session = await issueSession(actor.userId, actor.tenantId, actor.role, input.platform, 120);
  return { ...actor, token: session.token };
}
