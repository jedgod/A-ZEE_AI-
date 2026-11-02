import "server-only";
import { cookies } from "next/headers";
import { createHash, randomBytes } from "node:crypto";
import { pool, deny } from "./core";

export type AdminSession = {
  userId: string;
  tenantId: string;
  role: "owner" | "admin" | "reviewer" | "operator" | "viewer";
  platform: boolean;
};

export type HostSession = AdminSession & {
  sessionId?: string;
};

function hash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function getHostSession(): Promise<AdminSession | null> {
  const token = (await cookies()).get("az_session")?.value;
  if (!token || !/^[a-f0-9]{64}$/i.test(token)) return null;

  const result = await pool.query(
    "SELECT s.user_id, s.tenant_id, s.role, s.platform " +
      "FROM admin_sessions s " +
      "JOIN admin_memberships m ON m.user_id = s.user_id AND m.tenant_id = s.tenant_id " +
      "JOIN admin_tenants t ON t.id = s.tenant_id " +
      "WHERE s.token_hash = $1 " +
      "AND s.revoked_at IS NULL " +
      "AND s.expires_at > now() " +
      "AND m.status = 'active' " +
      "AND t.status = 'active' " +
      "AND t.deleted_at IS NULL " +
      "LIMIT 1",
    [hash(token)]
  );

  const row = result.rows[0];
  if (!row) return null;

  return {
    userId: row.user_id,
    tenantId: row.tenant_id,
    role: row.role,
    platform: !!row.platform,
  };
}

export async function revokeCurrentSession() {
  const token = (await cookies()).get("az_session")?.value;
  if (!token) deny(401, "SESSION_REQUIRED");

  await pool.query(
    "UPDATE admin_sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL",
    [hash(token)]
  );

  (await cookies()).set("az_session", "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

export async function issueSession(
  userId: string,
  tenantId: string,
  role: AdminSession["role"],
  platform = false,
  ttlMinutes = 120
) {
  if (process.env.NODE_ENV === "production") {
    deny(403, "BOOTSTRAP_DISABLED");
  }

  const token = randomBytes(32).toString("hex");
  await pool.query(
    "INSERT INTO admin_sessions(id, token_hash, user_id, tenant_id, role, platform, expires_at) " +
      "VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, now() + ($6::int * interval '1 minute'))",
    [hash(token), userId, tenantId, role, platform, ttlMinutes]
  );

  return { token, ttlMinutes };
}

export async function issueDevSession(input: {
  userId: string;
  tenantId: string;
  role: AdminSession["role"];
  platform?: boolean;
  ttlMinutes?: number;
}) {
  return issueSession(
    input.userId,
    input.tenantId,
    input.role,
    input.platform ?? false,
    input.ttlMinutes ?? 120
  );
}

export async function setSessionCookie(token: string, ttlMinutes: number) {
  const cookieStore = await cookies();
  cookieStore.set("az_session", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ttlMinutes * 60,
  });
}
