import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { pool } from "@/lib/admin/db";
import { getHostSession } from "@/lib/admin/host-session";
import { opsRole, type OpsRole } from "@/lib/support/policy";
import { dummyHash, hashPassword, passwordProblem, verifyPassword } from "./password";

export const SESSION_HOURS = 8;
const MAX_FAILURES = 5;
const LOCK_MINUTES = 15;

export type Staff = {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  membershipRole: string;
  role: OpsRole;
  mustChangePassword: boolean;
};

export class SignInError extends Error {
  constructor(public code: "INVALID_CREDENTIALS" | "LOCKED" | "NO_ACTIVE_MEMBERSHIP") { super(code); }
}

const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

/** The tenant that receives complaints from the app (set by `npm run staff:create`). */
export async function supportTenantId(): Promise<string | null> {
  const result = await pool.query("SELECT value FROM ops_settings WHERE key = 'support_tenant_id'");
  return result.rows[0]?.value ?? null;
}

/**
 * Verifies email + password and opens a session in admin_sessions (the same sessions /admin
 * uses). Failed attempts lock the account for 15 minutes after 5 tries. Unknown emails take
 * the same time as wrong passwords, so responses don't reveal which emails exist.
 */
export async function signIn(email: string, password: string): Promise<{ token: string; staff: Staff }> {
  const normalized = email.trim().toLowerCase();
  const found = await pool.query(
    `SELECT i.id, i.email, c.password_hash, c.failed_attempts, c.locked_until > now() AS locked
     FROM admin_identities i JOIN admin_credentials c ON c.user_id = i.id
     WHERE lower(i.email) = $1`,
    [normalized],
  );
  const row = found.rows[0];
  if (!row) {
    await verifyPassword(password, await dummyHash());
    throw new SignInError("INVALID_CREDENTIALS");
  }
  if (row.locked) throw new SignInError("LOCKED");

  if (!await verifyPassword(password, row.password_hash)) {
    await pool.query(
      `UPDATE admin_credentials SET failed_attempts = failed_attempts + 1,
         locked_until = CASE WHEN failed_attempts + 1 >= $2 THEN now() + make_interval(mins => $3) ELSE locked_until END
       WHERE user_id = $1`,
      [row.id, MAX_FAILURES, LOCK_MINUTES],
    );
    throw new SignInError(row.failed_attempts + 1 >= MAX_FAILURES ? "LOCKED" : "INVALID_CREDENTIALS");
  }

  // Prefer the support desk tenant; otherwise the member's first active tenant.
  const support = await supportTenantId();
  const membership = await pool.query(
    `SELECT m.tenant_id, m.role, i.platform_admin FROM admin_memberships m
     JOIN admin_tenants t ON t.id = m.tenant_id JOIN admin_identities i ON i.id = m.user_id
     WHERE m.user_id = $1 AND m.status = 'active' AND t.status = 'active' AND t.deleted_at IS NULL
     ORDER BY (m.tenant_id::text = $2) DESC, m.created_at LIMIT 1`,
    [row.id, support ?? ""],
  );
  const member = membership.rows[0];
  if (!member) throw new SignInError("NO_ACTIVE_MEMBERSHIP");

  const token = randomBytes(32).toString("hex");
  await pool.query("UPDATE admin_credentials SET failed_attempts = 0, locked_until = NULL WHERE user_id = $1", [row.id]);
  await pool.query(
    `INSERT INTO admin_sessions (id, token_hash, user_id, tenant_id, role, platform, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, now() + make_interval(hours => $7))`,
    [randomUUID(), tokenHash(token), row.id, member.tenant_id, member.role, member.platform_admin, SESSION_HOURS],
  );
  const staff = await currentStaffFor(row.id, member.tenant_id);
  return { token, staff: staff! };
}

async function currentStaffFor(userId: string, tenantId: string): Promise<Staff | null> {
  const result = await pool.query(
    `SELECT i.id, i.email, coalesce(i.display_name, split_part(i.email, '@', 1)) AS name, m.role,
            coalesce(c.must_change, false) AS must_change
     FROM admin_identities i JOIN admin_memberships m ON m.user_id = i.id AND m.tenant_id = $2
     LEFT JOIN admin_credentials c ON c.user_id = i.id
     WHERE i.id = $1 AND m.status = 'active'`,
    [userId, tenantId],
  );
  const r = result.rows[0];
  return r ? { id: r.id, tenantId, email: r.email, name: r.name, membershipRole: r.role, role: opsRole(r.role), mustChangePassword: r.must_change } : null;
}

/** The signed-in staff member for this request, or null. Roles are read from the database each time. */
export async function currentStaff(): Promise<Staff | null> {
  if (!process.env.DATABASE_URL) return null;
  const session = await getHostSession();
  return session ? currentStaffFor(session.userId, session.tenantId) : null;
}

export async function changePassword(userId: string, current: string, next: string): Promise<string | null> {
  const problem = passwordProblem(next);
  if (problem) return problem;
  const row = (await pool.query("SELECT password_hash FROM admin_credentials WHERE user_id = $1", [userId])).rows[0];
  if (!row || !await verifyPassword(current, row.password_hash)) return "Your current password is incorrect.";
  if (current === next) return "Choose a different password from the current one.";
  await pool.query(
    "UPDATE admin_credentials SET password_hash = $2, must_change = false, failed_attempts = 0, locked_until = NULL, updated_at = now() WHERE user_id = $1",
    [userId, await hashPassword(next)],
  );
  return null;
}
