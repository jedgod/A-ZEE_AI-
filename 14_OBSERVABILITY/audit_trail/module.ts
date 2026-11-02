// ============================================================
// 14_OBSERVABILITY / AUDIT_TRAIL
// File: lib/operations/audit_trail.ts — SERVER ONLY
// ============================================================

import "server-only";
import { z } from "zod";
import {
  type Auth, type ArtifactRepository, type RecordRepository,
  requireAuth, artifactSchema, expiresIn
} from "../../lib/operations/contracts";

export interface AuditSink {
  append(input: {
    actor: Auth; action: string; resourceId: string;
    outcome: "allowed" | "denied"; occurredAt: string;
  }): Promise<{ id: string }>;
}

export async function runAuditTrail(
  actor: Auth, raw: unknown, sink: AuditSink
) {
  requireAuth(actor);
  const input = z.object({
    action: z.enum(["artifact_read", "policy_change", "tool_approval"]),
    resourceId: z.string().uuid(),
    outcome: z.enum(["allowed", "denied"]),
  }).strict().parse(raw);
  return sink.append({
    actor, ...input, occurredAt: new Date().toISOString(),
  });
}

// Record actions from authorization enforcement, not client claims.
// Use a restricted append-only sink and independent integrity storage.
// Retention/access policies depend on your compliance requirements.
