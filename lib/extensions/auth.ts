// ============================================================
// 15_EXTENSIONS / HOST AUTHENTICATION BOUNDARY
// ============================================================
import "server-only";
import type { Actor } from "./contracts";
import { requireActor as requireSessionActor } from "@/lib/admin/security";

export async function requireActor(): Promise<Actor> {
  const actor = await requireSessionActor();
  return { userId: actor.userId, tenantId: actor.tenantId,
    permissions: new Set(["owner", "admin"].includes(actor.role) ? ["extensions:admin"] : []) };
}

export function requireAdmin(actor: Actor) {
  if (!actor.permissions.has("extensions:admin")) {
    throw new Error("Forbidden");
  }
}

export function requireSameOrigin(request: Request) {
  const allowed = process.env.APP_ORIGIN;
  if (!allowed || request.headers.get("origin") !== allowed) {
    throw new Error("Invalid origin");
  }
}

// Add your host rate limiter and CSRF/session protections.
// Fail-closed stub intentionally prevents accidental unauthenticated use.
