import "server-only";
import { getHostSession } from "@/lib/admin/host-session";
import { currentStaff } from "@/lib/staff/auth";

// Which AI provider or model answered is operational detail for administrators. Everyone else
// (chat users, API clients, the local workspace user) gets answers without it.

/** A signed-in staff admin (past the first-sign-in password change) or an owner/admin of the /admin console. */
export async function canSeeProviders(): Promise<boolean> {
  try {
    const staff = await currentStaff();
    if (staff && staff.role === "admin" && !staff.mustChangePassword) return true;
  } catch { /* no staff session */ }
  try {
    const host = await getHostSession();
    if (host && (host.role === "owner" || host.role === "admin")) return true;
  } catch { /* no admin session */ }
  return false;
}

/** The pipeline metadata a caller may see: provider and attempt count only for administrators. */
export function publicMeta<T extends { provider?: unknown; attempts?: unknown }>(meta: T, admin: boolean): Omit<T, "provider" | "attempts"> | T {
  if (admin) return meta;
  const { provider: _provider, attempts: _attempts, ...rest } = meta;
  return rest;
}
