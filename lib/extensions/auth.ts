// ============================================================
// 15_EXTENSIONS / HOST AUTHENTICATION BOUNDARY
// ============================================================
import "server-only";
import type { Actor } from "./contracts";

export async function requireActor(): Promise<Actor> {
  // Replace with your session provider (Auth.js, Clerk, or equivalent).
  // Resolve tenant membership and permissions on the server.
  // Never trust user/tenant/permissions headers from a browser.
  throw new Error("Authentication adapter must be implemented");
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
