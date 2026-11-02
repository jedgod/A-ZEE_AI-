// ============================================================
// 15_EXTENSIONS / EXECUTION AUDIT
// ============================================================
import "server-only";
import { randomUUID } from "node:crypto";
import { execute } from "./database";
import { z } from "zod";

const auditSchema = z.object({
  tenantId: z.string().min(1).max(200),
  actorId: z.string().min(1).max(200),
  extensionId: z.string().min(1).max(100),
  event: z.enum(["configuration", "execution"]),
  status: z.enum(["success", "failure"]),
  durationMs: z.number().finite().nonnegative().optional(),
}).strict();

export async function audit(input: {
  tenantId: string; actorId: string; extensionId: string;
  event: "configuration" | "execution";
  status: "success" | "failure";
  durationMs?: number;
}) {
  input = auditSchema.parse(input);
  await execute(
    "INSERT INTO extension_audit_events " +
    "(id, tenant_id, actor_id, extension_id, event, status, " +
    "duration_ms, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [randomUUID(), input.tenantId, input.actorId, input.extensionId,
     input.event, input.status, Math.round(input.durationMs ?? 0),
     new Date().toISOString(),
     new Date(Date.now() + 30 * 86400000).toISOString()]
  );
}

// Deliberately accepts structured operational fields, not arbitrary payloads.
export const logExtensionEvent = audit;

// No content, credentials, or private reasoning is stored.
// Restrict writes/reads to server roles and enforce retention.
// This database audit is not tamper-proof; security-critical
// events should also flow to an independently protected sink.
