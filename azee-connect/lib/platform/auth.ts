import "server-only";
import { createHash } from "node:crypto";
import { Pool } from "pg";

const shared = globalThis as unknown as { platformPool?: Pool };
export const db = shared.platformPool ?? new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  connectionTimeoutMillis: 5000,
});
shared.platformPool = db;

export class PlatformError extends Error {
  constructor(public status: number, public code: string) {
    super(code);
  }
}

export async function authorize(request: Request, scope: string) {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!/^az_[a-f0-9]{64}$/.test(token)) {
    throw new PlatformError(401, "INVALID_TOKEN");
  }
  const hash = createHash("sha256").update(token).digest("hex");
  const result = await db.query(
    `SELECT k.id, k.user_id, k.tenant_id, k.scopes
     FROM platform_api_keys k
     JOIN admin_memberships m ON m.user_id = k.user_id AND m.tenant_id = k.tenant_id
     JOIN admin_tenants t ON t.id = k.tenant_id
     WHERE k.token_hash = $1
       AND k.revoked_at IS NULL
       AND k.expires_at > now()
       AND m.status = 'active'
       AND t.status = 'active'
       AND t.deleted_at IS NULL`,
    [hash]
  );
  const actor = result.rows[0];
  if (!actor) throw new PlatformError(401, "INVALID_TOKEN");
  if (!actor.scopes.includes(scope)) {
    throw new PlatformError(403, "INSUFFICIENT_SCOPE");
  }
  const rate = await db.query(
    `INSERT INTO platform_api_limits(key_id, bucket, hits)
     VALUES($1, $2, 1)
     ON CONFLICT(key_id, bucket)
     DO UPDATE SET hits = platform_api_limits.hits + 1
     RETURNING hits`,
    [actor.id, Math.floor(Date.now() / 60000)]
  );
  if (rate.rows[0].hits > 20) throw new PlatformError(429, "RATE_LIMITED");
  return actor;
}
