// ============================================================
// 13_FEEDBACK / CORRECTION_CAPTURE
// File: lib/operations/correction_capture.ts — SERVER ONLY
// ============================================================

import "server-only";
import { z } from "zod";
import {
  type Auth, type ArtifactRepository, type RecordRepository,
  requireAuth, artifactSchema, expiresIn
} from "../../lib/operations/contracts";

export async function runCorrectionCapture(
  auth: Auth, raw: unknown, repository: RecordRepository
) {
  requireAuth(auth);
  const input = z.object({
    requestId: z.string().uuid(),
    correction: z.string().trim().min(1).max(5000),
  }).strict().parse(raw);
  return repository.insert({
    auth, module: "correction_capture", requestId: input.requestId,
    payload: { correction: input.correction, reviewStatus: "pending" },
    expiresAt: expiresIn(90),
  });
}

// Apply data minimization and sensitive-data screening before storage.
// Training reuse requires separate consent and reviewed data policy.
