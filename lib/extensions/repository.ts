// ============================================================
// 15_EXTENSIONS / TENANT INSTALLATIONS
// ============================================================
import "server-only";
import { z } from "zod";
import { query, execute } from "./database";
import { permissionSchema } from "./manifest";

const rowSchema = z.object({
  extension_id: z.string(),
  approved_version: z.string(),
  enabled: z.number().int().min(0).max(1),
  granted_permissions: z.string(),
});

export async function installations(tenantId: string) {
  const rows = await query<unknown>(
    "SELECT extension_id, approved_version, enabled, granted_permissions " +
    "FROM extension_installations WHERE tenant_id = ?",
    [tenantId]
  );
  return rows.map(raw => {
    const row = rowSchema.parse(raw);
    return {
      id: row.extension_id,
      version: row.approved_version,
      enabled: row.enabled === 1,
      grants: z.array(permissionSchema)
        .parse(JSON.parse(row.granted_permissions)),
    };
  });
}

export async function saveInstallation(input: {
  tenantId: string; id: string; version: string;
  enabled: boolean; grants: string[]; actorId: string;
}) {
  await execute(
    "INSERT INTO extension_installations " +
    "(tenant_id, extension_id, approved_version, enabled, " +
    "granted_permissions, approved_by, updated_at) " +
    "VALUES (?, ?, ?, ?, ?, ?, ?) " +
    "ON CONFLICT (tenant_id, extension_id) DO UPDATE SET " +
    "approved_version = excluded.approved_version, " +
    "enabled = excluded.enabled, " +
    "granted_permissions = excluded.granted_permissions, " +
    "approved_by = excluded.approved_by, updated_at = excluded.updated_at",
    [input.tenantId, input.id, input.version, input.enabled ? 1 : 0,
     JSON.stringify(input.grants), input.actorId, new Date().toISOString()]
  );
}
