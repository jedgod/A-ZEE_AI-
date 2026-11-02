// ============================================================
// 13_FEEDBACK / IMPROVEMENT_QUEUE
// File: lib/operations/improvement_queue.ts — SERVER ONLY
// ============================================================

import "server-only";
import { z } from "zod";
import {
  type Auth, type ArtifactRepository, type RecordRepository,
  requireAuth, artifactSchema, expiresIn
} from "../../lib/operations/contracts";

export interface ImprovementRepository {
  enqueueReviewedCandidate(input: {
    auth: Auth; feedbackId: string;
    status: "pending_review";
  }): Promise<{ id: string }>;
}

export async function runImprovementQueue(
  auth: Auth, raw: unknown, repository: ImprovementRepository
) {
  requireAuth(auth);
  const input = z.object({
    feedbackId: z.string().uuid(),
  }).strict().parse(raw);
  return repository.enqueueReviewedCandidate({
    auth, feedbackId: input.feedbackId, status: "pending_review",
  });
}

// Restrict to authorized reviewers; verify feedback ownership.
// Deduplicate by feedback ID. Require evaluation + approval
// before changing production prompts, policies, or model routing.
