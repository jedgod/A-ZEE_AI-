// Requires trusted direct DB access. Never expose as a public route.
import { randomBytes, randomUUID, createHash } from "node:crypto";
import pg from "pg";

const [userId, tenantId] = process.argv.slice(2);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (!uuid.test(userId ?? "") || !uuid.test(tenantId ?? "")) {
  throw new Error("Usage: node scripts/issue-platform-token.mjs USER_UUID TENANT_UUID");
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  const member = await pool.query(
    `SELECT 1 FROM admin_memberships m
     JOIN admin_tenants t ON t.id = m.tenant_id
     WHERE m.user_id = $1 AND m.tenant_id = $2
       AND m.status = 'active'
       AND t.status = 'active'
       AND t.deleted_at IS NULL`,
    [userId, tenantId]
  );
  if (!member.rowCount) throw new Error("Active membership required");

  const token = "az_" + randomBytes(32).toString("hex");
  const id = randomUUID();
  await pool.query(
    `INSERT INTO platform_api_keys(id, token_hash, user_id, tenant_id, scopes, expires_at)
     VALUES($1, $2, $3, $4, $5, now() + interval '30 days')`,
    [id, createHash("sha256").update(token).digest("hex"), userId, tenantId, ["chat:write"]]
  );
  console.log("Key ID:", id);
  console.log("Store securely. Token shown only once:", token);
} finally {
  await pool.end();
}
