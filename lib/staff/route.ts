import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { pool } from "@/lib/admin/db";
import { OpsError } from "@/lib/support/complaints";
import { currentStaff, type Staff } from "./auth";

export const NO_STORE = { "Cache-Control": "no-store" };

/** Mutations must come from this app's own pages (CSRF defense alongside SameSite cookies). */
export function requireSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== (process.env.APP_ORIGIN || "http://localhost:3000")) throw new OpsError(403, "INVALID_ORIGIN");
}

export async function requireStaff(request?: Request, roles?: Staff["role"][], options: { allowPasswordChange?: boolean } = {}): Promise<Staff> {
  if (request && request.method !== "GET") requireSameOrigin(request);
  const staff = await currentStaff();
  if (!staff) throw new OpsError(401, "SIGN_IN_REQUIRED");
  // A one-time password only unlocks choosing a real one.
  if (staff.mustChangePassword && !options.allowPasswordChange) throw new OpsError(403, "PASSWORD_CHANGE_REQUIRED");
  if (roles && !roles.includes(staff.role)) throw new OpsError(403, "ROLE_NOT_ALLOWED");
  return staff;
}

/** Fixed-window limiter on the shared admin_rate_limits table. */
export async function rateLimit(scope: string, id: string, perMinute: number): Promise<boolean> {
  if (!process.env.DATABASE_URL) return true;
  const key = createHash("sha256").update(`${scope}:${id}`).digest("hex");
  const result = await pool.query(
    `INSERT INTO admin_rate_limits (key, bucket, hits) VALUES ($1, $2, 1)
     ON CONFLICT (key, bucket) DO UPDATE SET hits = admin_rate_limits.hits + 1 RETURNING hits`,
    [key, Math.floor(Date.now() / 60000)],
  );
  return result.rows[0].hits <= perMinute;
}

export function errorResponse(error: unknown): Response {
  if (error instanceof Response) return error;
  if (error instanceof OpsError) {
    return Response.json({ error: error.code, ...(error.detail ? { message: error.detail } : {}) }, { status: error.status, headers: NO_STORE });
  }
  if (error instanceof z.ZodError || error instanceof SyntaxError) {
    return Response.json({ error: "INVALID_INPUT", issues: error instanceof z.ZodError ? error.issues.map(i => ({ path: i.path.join("."), message: i.message })) : undefined }, { status: 422, headers: NO_STORE });
  }
  // Postgres CHECK/FK violations are rule violations, not server faults.
  const code = (error as { code?: string })?.code;
  if (code === "23514" || code === "23503") return Response.json({ error: "RULE_VIOLATION" }, { status: 422, headers: NO_STORE });
  if (code === "23505") return Response.json({ error: "ALREADY_EXISTS" }, { status: 409, headers: NO_STORE });
  console.error("operations route failed:", (error as Error)?.message);
  return Response.json({ error: "SERVICE_UNAVAILABLE" }, { status: 503, headers: NO_STORE });
}

export const uuid = z.string().uuid();
