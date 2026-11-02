// ============================================================
// SHARED / PROMPT & TOOL CONTRACTS
// File: lib/execution/contracts.ts
// ============================================================

export type Message = {
  role: "system" | "developer" | "user" | "assistant";
  content: string;
};

export type AuthContext = {
  userId: string;
  tenantId: string;
  permissions: ReadonlySet<string>;
};

export function requirePermission(
  auth: AuthContext, permission: string
) {
  if (!auth.userId || !auth.tenantId ||
      !auth.permissions.has(permission)) {
    throw new Error("Forbidden");
  }
}

// AuthContext MUST come from authenticated server state.
// Never construct it from model output or request JSON.
// Provider adapters must map supported message roles explicitly.
// Audit operational metadata, not secrets or private reasoning.
