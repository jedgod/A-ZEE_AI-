// ============================================================
// 12_DELIVERY / FINAL_ANSWER
// File: lib/operations/final_answer.ts — SERVER ONLY
// ============================================================

import "server-only";
import { z } from "zod";
import {
  type Auth, type ArtifactRepository, type RecordRepository,
  requireAuth, artifactSchema, expiresIn
} from "../../lib/operations/contracts";

export async function runFinalAnswer(
  auth: Auth, artifactId: string, repository: ArtifactRepository
) {
  requireAuth(auth);
  z.string().uuid().parse(artifactId);
  return artifactSchema.parse(
    await repository.readApproved(auth, artifactId)
  );
}

// Repository checks ownership, policy approval, validation version,
// expiry, and any required human approval before returning text.
