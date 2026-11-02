// ============================================================
// 14_OBSERVABILITY / MODEL_PERFORMANCE
// File: lib/operations/model_performance.ts — SERVER ONLY
// ============================================================

import "server-only";
import { z } from "zod";
import {
  type Auth, type ArtifactRepository, type RecordRepository,
  requireAuth, artifactSchema, expiresIn
} from "../../lib/operations/contracts";

export async function runModelPerformance(
  auth: Auth, raw: unknown, allowedModels: ReadonlySet<string>,
  repository: RecordRepository
) {
  requireAuth(auth);
  const input = z.object({
    requestId: z.string().uuid(),
    modelId: z.string().min(1).max(200),
    durationMs: z.number().finite().min(0).max(3600000),
    inputTokens: z.number().int().min(0),
    outputTokens: z.number().int().min(0),
    outcome: z.enum(["success", "failure"]),
  }).strict().parse(raw);
  if (!allowedModels.has(input.modelId)) throw new Error("Unknown model");
  return repository.insert({
    auth, module: "model_performance", requestId: input.requestId,
    payload: input, expiresAt: expiresIn(90),
  });
}

// Inputs originate from provider usage and monotonic server timers.
// Do not treat latency or task success as a universal quality score.
