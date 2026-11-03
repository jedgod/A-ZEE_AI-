import "server-only";
import { randomUUID } from "node:crypto";
import type { Actor } from "@/00_META/shared";
import type { AuthContext } from "@/lib/execution/contracts";
import type { Auth } from "@/lib/operations/contracts";

/** One request's identity, shaped for each stage that needs it. */
export type RequestActor = {
  meta: Actor;          // 00_META preflight
  execution: AuthContext; // 07_TOOLS permission checks
  auth: Auth;           // 13_FEEDBACK / 14_OBSERVABILITY ownership
  local: boolean;
  channel: "web" | "platform"; // web chat (plan limits apply) or IDE/API token
};

export const ANON_COOKIE = "az_uid";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
// 07_TOOLS search + calculator, plus what 15_EXTENSIONS hooks may be granted (lib/extensions/permissions).
// Guests get the calculator only: it runs no code and reaches no external service.
const SIGNED_IN_PERMISSIONS = new Set(["tools:search", "tools:calculator", "extensions:read_context", "extensions:read_output", "extensions:write_metadata"]);
const GUEST_PERMISSIONS = new Set(["tools:calculator"]);

/**
 * "Local workspace" rule: a request is the machine's own signed-in user when it reaches the
 * server on a loopback host with no proxy forwarding, and APP_ORIGIN (if set) is loopback too.
 * A deployed server (public APP_ORIGIN or behind a proxy) treats browsers as guests.
 * Set LOCAL_SINGLE_USER=false to disable the rule entirely.
 */
export function isLocalRequest(request: Request): boolean {
  return isLocalHeaders(request.headers, new URL(request.url).hostname);
}

/** Same rule for server components, which see headers but not a Request. */
export function isLocalHeaders(headers: Pick<Headers, "get" | "has">, fallbackHost = ""): boolean {
  if (process.env.LOCAL_SINGLE_USER === "false") return false;
  if (headers.has("forwarded")) return false;
  // Next.js itself sets x-forwarded-for to the socket's remote address, so its presence alone
  // proves nothing: every hop listed must be a loopback address.
  const hops = headers.get("x-forwarded-for")?.split(",").map(h => h.trim()).filter(Boolean) ?? [];
  if (!hops.every(isLoopbackAddress)) return false;
  const host = headers.get("host")?.replace(/:\d+$/, "") ?? fallbackHost;
  if (!LOOPBACK.has(host)) return false;
  const origin = process.env.APP_ORIGIN;
  if (origin) {
    try { if (!LOOPBACK.has(new URL(origin).hostname)) return false; } catch { return false; }
  }
  return true;
}

function isLoopbackAddress(address: string): boolean {
  const ip = address.replace(/^::ffff:/i, "");
  return ip === "::1" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip);
}

/** Anonymous browser identity (not authentication): used only to own feedback and telemetry. */
export function readAnonId(request: Request): string | null {
  const match = request.headers.get("cookie")?.match(new RegExp(`(?:^|;\\s*)${ANON_COOKIE}=([^;]+)`));
  return match && UUID.test(match[1]) ? match[1] : null;
}

export function anonCookie(id: string): string {
  return `${ANON_COOKIE}=${id}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Strict`;
}

export function webActor(request: Request): { actor: RequestActor; newAnonId: string | null } {
  const existing = readAnonId(request);
  const id = existing ?? randomUUID();
  const local = isLocalRequest(request);
  const tenantId = local ? "local" : "public";
  return {
    newAnonId: existing ? null : id,
    actor: {
      local,
      channel: "web",
      meta: local
        ? { id, tenantId, role: "user", authenticated: true }
        : { id, tenantId: null, role: "guest", authenticated: false },
      execution: { userId: id, tenantId, permissions: local ? SIGNED_IN_PERMISSIONS : GUEST_PERMISSIONS },
      auth: { userId: id, tenantId },
    },
  };
}

/** IDE / platform-token callers (lib/platform/auth) are authenticated tenant members. */
export function platformActor(key: { user_id: string; tenant_id: string }): RequestActor {
  return {
    local: false,
    channel: "platform",
    meta: { id: key.user_id, tenantId: key.tenant_id, role: "user", authenticated: true },
    execution: { userId: key.user_id, tenantId: key.tenant_id, permissions: SIGNED_IN_PERMISSIONS },
    auth: { userId: key.user_id, tenantId: key.tenant_id },
  };
}
