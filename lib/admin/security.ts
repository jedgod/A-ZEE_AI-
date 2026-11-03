// ============================================================
// 15_ADMIN / SESSION SECURITY & AUTHORIZATION
// ============================================================
import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { pool } from "./db";
import { fail } from "./errors";
import { getHostSession } from "./host-session";
import type { Permission, Role } from "./contracts";

export const roleSchema = z.enum([
  "owner",
  "admin",
  "reviewer",
  "operator",
  "viewer",
]);

export type Actor = {
  userId: string;
  tenantId: string;
  role: Role;
  platformAdmin: boolean;
};

const grants: Record<Role, readonly Permission[]> = {
  owner: [
    "read",
    "users.write",
    "roles.write",
    "policies.write",
    "registry.write",
    "billing.write",
    "incidents.write",
    "approvals.write",
    "approvals.review",
  ],
  admin: [
    "read",
    "users.write",
    "policies.write",
    "registry.write",
    "billing.write",
    "incidents.write",
    "approvals.write",
  ],
  reviewer: ["read", "approvals.review"],
  operator: ["read", "incidents.write", "approvals.write"],
  viewer: ["read"],
};

export async function requireActor(): Promise<Actor> {
  const session = await getHostSession();
  if (!session) fail(401, "AUTHENTICATION_REQUIRED");
  return {
    userId: session.userId,
    tenantId: session.tenantId,
    role: roleSchema.parse(session.role),
    platformAdmin: session.platform,
  };
}

/** The permission matrix enforced by authorize(); shown read-only in /admin/roles. */
export const permissionsFor = (role: Role): readonly Permission[] => grants[role];
export const ROLE_ORDER: readonly Role[] = ["owner", "admin", "reviewer", "operator", "viewer"];
export const can = (actor: Actor, permission: Permission) => grants[actor.role].includes(permission);

export function authorize(actor: Actor, permission: Permission | string) {
  if (!grants[actor.role].includes(permission as Permission)) {
    fail(403, "FORBIDDEN");
  }
}

export function platform(actor: Actor) {
  if (!actor.platformAdmin) fail(403, "PLATFORM_ADMIN_REQUIRED");
}

export function sameOrigin(request: Request) {
  const allowed = process.env.APP_ORIGIN;
  if (!allowed || request.headers.get("origin") !== allowed) {
    fail(403, "INVALID_ORIGIN");
  }
}

export async function rateLimit(actor: Actor, write: boolean) {
  const minute = Math.floor(Date.now() / 60000);
  const key = createHash("sha256")
    .update(`${actor.userId}:${actor.tenantId}:${write ? "w" : "r"}`)
    .digest("hex");

  const result = await pool.query(
    `INSERT INTO admin_rate_limits (key, bucket, hits)
     VALUES ($1, $2, 1)
     ON CONFLICT (key, bucket)
     DO UPDATE SET hits = admin_rate_limits.hits + 1
     RETURNING hits`,
    [key, minute]
  );

  if (result.rows[0].hits > (write ? 30 : 120)) {
    fail(429, "RATE_LIMITED");
  }
}

export async function readBody(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    fail(415, "JSON_REQUIRED");
  }
  if (!request.body) fail(400, "BODY_REQUIRED");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;

  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > 32768) {
        await reader.cancel();
        fail(413, "BODY_TOO_LARGE");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }

  return JSON.parse(new TextDecoder().decode(body));
}
