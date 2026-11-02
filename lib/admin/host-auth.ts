import "server-only";
import { z } from "zod";
import { fail } from "./errors";
import { evaluateRuntimeMetadata, normalizeRuntimeRole } from "./runtime-metadata";
import { getHostSession, type HostSession } from "./host-session";

export const hostRoleSchema = z.enum(["owner", "admin", "reviewer", "operator", "viewer"]);

export type HostActor = HostSession;

export async function requireHostActor(): Promise<HostActor> {
  const session = await getHostSession();
  if (!session) fail(401, "SESSION_REQUIRED");
  hostRoleSchema.parse(session.role);

  const preflight = evaluateRuntimeMetadata({
    actor: {
      id: session.userId,
      tenantId: session.tenantId,
      role: normalizeRuntimeRole(session.role),
      authenticated: true,
    },
    request: {
      capability: "conversation",
      classification: "internal",
      requestedOutputTokens: 256,
      inputTokens: 256,
      attachmentBytes: 0,
      production: process.env.NODE_ENV === "production",
    },
  });

  if (!preflight.allowed) {
    fail(403, "ADMIN_METADATA_REJECTED", preflight.reasons);
  }

  return session;
}

export function requirePlatformAdmin(actor: HostActor) {
  if (!actor.platform) fail(403, "PLATFORM_ADMIN_REQUIRED");
}

export function requireTenantScope(actor: HostActor, tenantId: string) {
  if (actor.tenantId !== tenantId) fail(403, "TENANT_SCOPE_REQUIRED");
}

export function requireRoleAtLeast(actor: HostActor, allowed: readonly HostActor["role"][]) {
  if (!allowed.includes(actor.role)) fail(403, "ROLE_FORBIDDEN");
}
