// ============================================================
// 13_FEEDBACK / ERROR_LOGS
// File: lib/operations/error_logs.ts — SERVER ONLY
// ============================================================

import "server-only";
import { z } from "zod";
import {
  type Auth, type ArtifactRepository, type RecordRepository,
  requireAuth, artifactSchema, expiresIn
} from "../../lib/operations/contracts";

export async function runErrorLogs(
  auth: Auth, raw: unknown, repository: RecordRepository
) {
  requireAuth(auth);
  const input = z.object({
    requestId: z.string().uuid(),
    category: z.enum(["timeout", "provider", "validation", "internal"]),
    correlationId: z.string().uuid(),
  }).strict().parse(raw);
  return repository.insert({
    auth, module: "error_logs", requestId: input.requestId,
    payload: { category: input.category, correlationId: input.correlationId },
    expiresAt: expiresIn(30),
  });
}

// Categories must come from typed server errors.
// Keep restricted diagnostic traces in a separate redacted system.
